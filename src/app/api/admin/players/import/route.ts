import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractPlayerCode, generateUniquePlayerCode } from '@/utils/playerCode';
import { getImportStrategy, detectConfiguredSport } from '@/utils/importStrategies';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const rawRecords = body.records || body.parsedRows || body.players;
    const { eventId, sport: requestedSport } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    if (!rawRecords || !Array.isArray(rawRecords) || rawRecords.length === 0) {
      return NextResponse.json({ error: 'No player records provided for import' }, { status: 400 });
    }

    const records = rawRecords;

    // 1. Fetch current event from database to detect configured sport
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    if (eventErr) {
      return NextResponse.json({ error: `Event error: ${eventErr.message}` }, { status: 500 });
    }

    // Detect sport: Event configuration is primary source of truth.
    // If request specifies a sport that is configured/enabled for this event, allow that.
    let targetSport = requestedSport;
    if (!targetSport) {
      targetSport = detectConfiguredSport(event);
    }

    // 2. Resolve Sport Import Strategy (Concept: importStrategy = getImportStrategy(event.sport))
    const importStrategy = getImportStrategy(targetSport);

    // 3. Fetch all existing players across the system for player codes & duplicate detection
    const { data: allPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('*');

    if (fetchErr) {
      return NextResponse.json({ error: `Database error: ${fetchErr.message}` }, { status: 500 });
    }

    const existingCodes = new Set<string>();
    const empToExistingCode = new Map<string, string>();
    const existingPlayerTriplets = new Set<string>(); // eventId + empId + sport + category
    const eventTeamPlayerToExisting = new Map<string, any>(); // eventId + teamName + playerName

    allPlayers?.forEach((p: any) => {
      const code = extractPlayerCode(p);
      if (code) {
        existingCodes.add(code.toUpperCase());
        const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
        if (cleanEmp && !empToExistingCode.has(cleanEmp)) {
          empToExistingCode.set(cleanEmp, code);
        }
      }
      const tripKey = `${p.event_id}_${String(p.employee_id).trim().toUpperCase()}_${String(p.sport).trim().toLowerCase()}_${String(p.category || 'NA').trim().toLowerCase()}`;
      existingPlayerTriplets.add(tripKey);

      const teamName = (p.team_name || p.push_subscription?._metadata?.team_name || '').trim().toLowerCase();
      const pName = String(p.name || '').trim().toLowerCase();
      if (teamName && pName && p.event_id) {
        eventTeamPlayerToExisting.set(`${p.event_id}_${teamName}_${pName}`, p);
      }
    });

    // 4. Validate and parse records using the sport-specific strategy
    const validation = importStrategy.parseAndValidate(records, allPlayers || [], event?.configuration);

    if (validation.errors.length > 0) {
      return NextResponse.json({
        error: `Validation failed: ${validation.errors[0]?.reason}`,
        details: validation.errors
      }, { status: 400 });
    }

    const toInsert: any[] = [];
    const updatedExisting: any[] = [];
    const batchEmpCodes = new Map<string, string>();

    for (const r of validation.validRecords) {
      let cleanEmpId = r.empId;
      const cleanName = r.name;
      const cleanSport = r.sport || importStrategy.sportName;
      const cleanCategory = r.category || 'NA';
      const cleanContact = r.contact || null;
      const cleanGender = r.gender || null;
      const cleanEmail = r.email || null;
      const cleanTeamName = r.teamName || null;

      // Check if existing player in this event matches team + name
      const existingInTeam = cleanTeamName
        ? eventTeamPlayerToExisting.get(`${eventId}_${cleanTeamName.toLowerCase()}_${cleanName.toLowerCase()}`)
        : null;

      if (existingInTeam && existingInTeam.employee_id) {
        cleanEmpId = String(existingInTeam.employee_id).trim().toUpperCase();
      }

      // Determine Player Code:
      // 1) From existing player matching team + name in this event
      // 2) From existing player in database by employee ID
      // 3) From previous record of same employee in this batch
      // 4) Newly generated unique Player Code
      let playerCode =
        (existingInTeam ? extractPlayerCode(existingInTeam) : null) ||
        empToExistingCode.get(cleanEmpId) ||
        batchEmpCodes.get(cleanEmpId);

      if (!playerCode) {
        playerCode = generateUniquePlayerCode(existingCodes);
        batchEmpCodes.set(cleanEmpId, playerCode);
      }

      // Check if player with this employee_id exists in DB but had no player_code
      const existingWithoutCode = allPlayers?.filter(
        (p: any) =>
          String(p.employee_id).trim().toUpperCase() === cleanEmpId &&
          !extractPlayerCode(p)
      );

      if (existingWithoutCode && existingWithoutCode.length > 0) {
        for (const p of existingWithoutCode) {
          const existingMeta = p.push_subscription?._metadata || {};
          const existingSource = (p as any).source || existingMeta.source;
          const updatedMeta = {
            ...existingMeta,
            player_code: playerCode,
            source: existingSource || 'IMPORT',
            ...(cleanTeamName ? { team_name: cleanTeamName } : {})
          };
          const updatedPush = { ...(p.push_subscription || {}), _metadata: updatedMeta };

          const { error: upErr } = await supabase
            .from('players')
            .update({
              player_code: playerCode,
              push_subscription: updatedPush
            })
            .eq('id', p.id);

          if (upErr && (upErr.code === 'PGRST204' || upErr.code === '42703' || upErr.message?.includes('column'))) {
            await supabase
              .from('players')
              .update({ push_subscription: updatedPush })
              .eq('id', p.id);
          }
          updatedExisting.push({ id: p.id, employee_id: cleanEmpId, player_code: playerCode });
        }
        empToExistingCode.set(cleanEmpId, playerCode);
      }

      // Check if duplicate for (event_id, employee_id, sport, category) or (event_id, team_name, name)
      const tripKey = `${eventId}_${cleanEmpId}_${cleanSport.toLowerCase()}_${cleanCategory.toLowerCase()}`;
      if (
        existingPlayerTriplets.has(tripKey) ||
        (cleanTeamName && eventTeamPlayerToExisting.has(`${eventId}_${cleanTeamName.toLowerCase()}_${cleanName.toLowerCase()}`))
      ) {
        // Already registered for this exact event, sport, and category; do not create duplicate
        continue;
      }
      existingPlayerTriplets.add(tripKey);
      if (cleanTeamName) {
        eventTeamPlayerToExisting.set(`${eventId}_${cleanTeamName.toLowerCase()}_${cleanName.toLowerCase()}`, { employee_id: cleanEmpId, player_code: playerCode });
      }

      const metadata: Record<string, any> = {
        player_code: playerCode,
        source: 'IMPORT',
        gender: cleanGender,
        email: cleanEmail
      };
      if (cleanTeamName) {
        metadata.team_name = cleanTeamName;
      }
      if (r.captainName) {
        metadata.captain_name = r.captainName;
      }
      if (r.isCaptain) {
        metadata.is_captain = true;
      }

      toInsert.push({
        event_id: eventId,
        employee_id: cleanEmpId,
        name: cleanName,
        sport: cleanSport,
        category: cleanCategory,
        contact_info: cleanContact,
        gender: cleanGender,
        source: 'IMPORT',
        status: 'REGISTERED',
        current_round: 1,
        player_code: playerCode,
        push_subscription: {
          _metadata: metadata
        }
      });
    }

    let insertedData: any[] = [];

    if (toInsert.length > 0) {
      const { data: insData, error: insErr } = await supabase
        .from('players')
        .insert(toInsert)
        .select();

      if (!insErr && insData) {
        insertedData = insData;
      } else if (
        insErr &&
        (insErr.code === 'PGRST204' || insErr.code === '42703' || insErr.message?.includes('column'))
      ) {
        // Fallback for schema cache
        const fallbackPayload = toInsert.map((item) => ({
          event_id: item.event_id,
          employee_id: item.employee_id,
          name: item.name,
          sport: item.sport,
          category: item.category,
          contact_info: item.contact_info,
          status: item.status,
          current_round: item.current_round,
          push_subscription: item.push_subscription
        }));

        const { data: fbData, error: fbErr } = await supabase
          .from('players')
          .insert(fallbackPayload)
          .select();

        if (fbErr) {
          return NextResponse.json({ error: `Insert failed: ${fbErr.message}` }, { status: 500 });
        }
        insertedData = fbData || [];
      } else if (insErr) {
        return NextResponse.json({ error: `Insert failed: ${insErr.message}` }, { status: 500 });
      }
    }

    // 5. For team-based sports (Cricket), manage relational teams table and players.team_id
    if (importStrategy.isTeamBased && validation.teamsDetected.length > 0) {
      try {
        const { data: currentEventPlayers } = await supabase
          .from('players')
          .select('id, name, employee_id, push_subscription, team_id')
          .eq('event_id', eventId);

        for (const tName of validation.teamsDetected) {
          const declaredCaptainName = validation.teamCaptains?.[tName] || null;

          // Find captain player in current event
          let captainPlayerId: string | null = null;
          if (declaredCaptainName && currentEventPlayers) {
            const normCap = declaredCaptainName.toLowerCase().replace(/\d+$/, '').replace(/[^a-z0-9]/g, '');
            const capPlayer = currentEventPlayers.find(
              (p: any) =>
                (p.team_name === tName || p.push_subscription?._metadata?.team_name === tName) &&
                p.name.toLowerCase().replace(/\d+$/, '').replace(/[^a-z0-9]/g, '') === normCap
            );
            if (capPlayer) {
              captainPlayerId = capPlayer.id;
            }
          }

          // Match or insert team in teams table (sport-aware, unique per event_id, sport, name)
          const { data: existingTeam } = await supabase
            .from('teams')
            .select('id, name, captain_player_id')
            .eq('event_id', eventId)
            .eq('sport', 'Cricket')
            .eq('name', tName)
            .maybeSingle();

          let teamId: string | null = existingTeam?.id || null;

          if (teamId) {
            if (captainPlayerId && existingTeam?.captain_player_id !== captainPlayerId) {
              await supabase
                .from('teams')
                .update({
                  captain_player_id: captainPlayerId,
                  updated_at: new Date().toISOString()
                })
                .eq('id', teamId);
            }
          } else {
            const { data: newTeam } = await supabase
              .from('teams')
              .insert({
                event_id: eventId,
                sport: 'Cricket',
                name: tName,
                category: 'Open Cricket',
                captain_player_id: captainPlayerId
              })
              .select('id')
              .single();

            if (newTeam) {
              teamId = newTeam.id;
            }
          }

          // Link player records with team_id
          if (teamId && currentEventPlayers) {
            const teamPlayerIds = currentEventPlayers
              .filter(
                (p: any) =>
                  (p.team_name === tName || p.push_subscription?._metadata?.team_name === tName) &&
                  p.team_id !== teamId
              )
              .map((p: any) => p.id);

            if (teamPlayerIds.length > 0) {
              await supabase
                .from('players')
                .update({ team_id: teamId })
                .in('id', teamPlayerIds);
            }
          }
        }
      } catch (teamRelErr) {
        console.warn('Relational teams update skipped:', teamRelErr);
      }
    }

    return NextResponse.json({
      success: true,
      sport: importStrategy.sportName,
      isTeamBased: importStrategy.isTeamBased,
      teamsDetected: validation.teamsDetected,
      teamPlayerCounts: validation.teamPlayerCounts,
      teamCaptains: validation.teamCaptains || {},
      teamsCreatedOrUpdated: validation.teamsDetected.length,
      insertedCount: insertedData.length,
      updatedCount: updatedExisting.length,
      skippedCount: validation.skipped.length,
      totalProcessed: records.length,
      summary: {
        sport: importStrategy.sportName,
        isTeamBased: importStrategy.isTeamBased,
        teamsDetected: validation.teamsDetected.length,
        teamNames: validation.teamsDetected,
        teamCaptains: validation.teamCaptains || {},
        teamsCreatedOrUpdated: validation.teamsDetected.length,
        totalRows: records.length,
        newPlayers: insertedData.length,
        existingPlayers: Math.max(validation.existingPlayersCount, validation.validRecords.length - insertedData.length),
        skippedRows: validation.skipped.length,
        duplicateRows: validation.skipped.filter((s) => s.reason.toLowerCase().includes('duplicate')).length
      },
      players: insertedData.map((p) => ({
        id: p.employee_id,
        dbId: p.id,
        playerCode: extractPlayerCode(p) || p.player_code,
        name: p.name,
        sport: p.sport,
        category: p.category,
        teamName: p.push_subscription?._metadata?.team_name || null,
        captainName: p.push_subscription?._metadata?.captain_name || null,
        isCaptain: p.push_subscription?._metadata?.is_captain === true,
        source: 'IMPORT',
        status: p.status
      }))
    });
  } catch (err: any) {
    console.error('Import API error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
