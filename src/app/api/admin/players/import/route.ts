import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractPlayerCode, generateUniquePlayerCode } from '@/utils/playerCode';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { eventId, records } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'No player records provided for import' }, { status: 400 });
    }

    // 1. Fetch all existing players across the system to track player codes & duplicates
    const { data: allPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('*');

    if (fetchErr) {
      return NextResponse.json({ error: `Database error: ${fetchErr.message}` }, { status: 500 });
    }

    const existingCodes = new Set<string>();
    const empToExistingCode = new Map<string, string>();
    const existingPlayerTriplets = new Set<string>(); // eventId + empId + sport + category

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
    });

    const toInsert: any[] = [];
    const updatedExisting: any[] = [];
    const batchEmpCodes = new Map<string, string>();

    for (const r of records) {
      const cleanEmpId = String(r.empId || r.employee_id || '').trim().toUpperCase();
      const cleanName = String(r.name || '').trim();
      const cleanSport = String(r.sport || '').trim();
      const cleanCategory = r.category ? String(r.category).trim() : 'NA';
      const cleanContact = r.contact ? String(r.contact).trim() : null;
      const cleanGender = r.gender ? String(r.gender).trim() : null;

      if (!cleanEmpId || !cleanName || !cleanSport) continue;

      // Determine Player Code:
      // 1) From existing player in database
      // 2) From previous record of same employee in this batch
      // 3) Newly generated unique Player Code
      let playerCode = empToExistingCode.get(cleanEmpId) || batchEmpCodes.get(cleanEmpId);

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
          const updatedMeta = { ...existingMeta, player_code: playerCode, source: existingSource || 'IMPORT' };
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

      // Check if duplicate for (event_id, employee_id, sport, category)
      const tripKey = `${eventId}_${cleanEmpId}_${cleanSport.toLowerCase()}_${cleanCategory.toLowerCase()}`;
      if (existingPlayerTriplets.has(tripKey)) {
        // Already registered for this exact event, sport, and category; do not create duplicate
        continue;
      }
      existingPlayerTriplets.add(tripKey);

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
          _metadata: {
            player_code: playerCode,
            source: 'IMPORT',
            gender: cleanGender
          }
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

    return NextResponse.json({
      success: true,
      insertedCount: insertedData.length,
      updatedCount: updatedExisting.length,
      totalProcessed: records.length,
      players: insertedData.map((p) => ({
        id: p.employee_id,
        dbId: p.id,
        playerCode: extractPlayerCode(p) || p.player_code,
        name: p.name,
        sport: p.sport,
        category: p.category,
        source: 'IMPORT',
        status: p.status
      }))
    });
  } catch (err: any) {
    console.error('Import API error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
