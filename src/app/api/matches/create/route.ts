import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateUniqueMatchCode, extractMatchCode } from '@/utils/matchCode';
import { extractPlayerTeam } from '@/utils/teamUtils';

// In-process locks to prevent concurrent race conditions
const inFlightPlayerLocks = new Set<string>();
const inFlightFixtureLocks = new Set<string>();

function getFixtureKey(
  eventId: string,
  sport: string,
  category: string,
  phase: string,
  playingArea: string,
  scheduledTime: string,
  t1p1: string,
  t1p2: string | null,
  t2p1: string,
  t2p2: string | null
): string {
  const team1 = [t1p1, t1p2 || ''].sort().join(':');
  const team2 = [t2p1, t2p2 || ''].sort().join(':');
  const teams = [team1, team2].sort().join('__VS__');
  return `${eventId}|${sport}|${category || 'NA'}|${phase || 'Round 1'}|${playingArea}|${scheduledTime}|${teams}`;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const {
      eventId,
      sport,
      category = 'NA',
      phase = 'Round 1',
      playingArea,
      scheduledTime,
      reportingTime,
      // For Badminton / individual matches:
      team1_p1_id,
      team1_p2_id = null,
      team2_p1_id,
      team2_p2_id = null,
      // For Cricket / team matches:
      team1_id = null,
      team2_id = null,
      team1_name,
      team2_name
    } = body;

    const isCricket = sport?.toLowerCase() === 'cricket' || Boolean(team1_id && team2_id) || Boolean(team1_name && team2_name);

    if (!eventId || !sport || !playingArea || !scheduledTime) {
      return NextResponse.json({ error: 'Missing required match fields' }, { status: 400 });
    }

    // =========================================================================
    // BRANCH A: CRICKET TEAM-VS-TEAM MATCH CREATION
    // =========================================================================
    if (isCricket) {
      let resolvedTeam1Id = team1_id;
      let resolvedTeam2Id = team2_id;
      let cleanTeam1 = String(team1_name || '').trim();
      let cleanTeam2 = String(team2_name || '').trim();
      let team1CaptainId: string | null = null;
      let team2CaptainId: string | null = null;

      // Check teams table to resolve IDs, names, and captains
      try {
        const { data: dbTeams } = await supabase
          .from('teams')
          .select('id, name, captain_player_id')
          .eq('event_id', eventId);

        if (dbTeams && dbTeams.length > 0) {
          const t1 = dbTeams.find((t: any) =>
            (resolvedTeam1Id && t.id === resolvedTeam1Id) ||
            (cleanTeam1 && t.name.toLowerCase() === cleanTeam1.toLowerCase())
          );
          if (t1) {
            resolvedTeam1Id = t1.id;
            if (!cleanTeam1) cleanTeam1 = t1.name;
            team1CaptainId = t1.captain_player_id;
          }

          const t2 = dbTeams.find((t: any) =>
            (resolvedTeam2Id && t.id === resolvedTeam2Id) ||
            (cleanTeam2 && t.name.toLowerCase() === cleanTeam2.toLowerCase())
          );
          if (t2) {
            resolvedTeam2Id = t2.id;
            if (!cleanTeam2) cleanTeam2 = t2.name;
            team2CaptainId = t2.captain_player_id;
          }
        }
      } catch {}

      if (!cleanTeam1 || !cleanTeam2) {
        return NextResponse.json({ error: 'Both Team 1 and Team 2 must be selected for a Cricket match.' }, { status: 400 });
      }

      if (cleanTeam1.toLowerCase() === cleanTeam2.toLowerCase() || (resolvedTeam1Id && resolvedTeam1Id === resolvedTeam2Id)) {
        return NextResponse.json({ error: 'Team 1 and Team 2 cannot be the same team.' }, { status: 400 });
      }

      // 1. Fetch all players for this event
      const { data: eventPlayers, error: pFetchErr } = await supabase
        .from('players')
        .select('*')
        .eq('event_id', eventId);

      if (pFetchErr) {
        return NextResponse.json({ error: `Database error: ${pFetchErr.message}` }, { status: 500 });
      }

      const team1Players = (eventPlayers || []).filter((p: any) => {
        if (resolvedTeam1Id && p.team_id === resolvedTeam1Id) return true;
        const t = extractPlayerTeam(p);
        return t && t.toLowerCase() === cleanTeam1.toLowerCase();
      });

      const team2Players = (eventPlayers || []).filter((p: any) => {
        if (resolvedTeam2Id && p.team_id === resolvedTeam2Id) return true;
        const t = extractPlayerTeam(p);
        return t && t.toLowerCase() === cleanTeam2.toLowerCase();
      });

      if (team1Players.length === 0) {
        return NextResponse.json({ error: `No registered players found for Team 1: "${cleanTeam1}".` }, { status: 400 });
      }

      if (team2Players.length === 0) {
        return NextResponse.json({ error: `No registered players found for Team 2: "${cleanTeam2}".` }, { status: 400 });
      }

      // Find captains from players if not resolved from teams table
      if (!team1CaptainId) {
        const cap = team1Players.find((p: any) => p.push_subscription?._metadata?.is_captain === true);
        team1CaptainId = cap?.id || team1Players[0]?.id || null;
      }
      if (!team2CaptainId) {
        const cap = team2Players.find((p: any) => p.push_subscription?._metadata?.is_captain === true);
        team2CaptainId = cap?.id || team2Players[0]?.id || null;
      }

      const allPlayerIds = [...team1Players.map((p: any) => p.id), ...team2Players.map((p: any) => p.id)];

      // 2. Conflict checks: Check if any player in either team is currently PLAYING
      const busyPlayers = (eventPlayers || []).filter(
        (p: any) => allPlayerIds.includes(p.id) && p.status === 'PLAYING'
      );

      if (busyPlayers.length > 0) {
        const names = busyPlayers.map((p: any) => p.name).join(', ');
        return NextResponse.json(
          { error: `Player conflict: ${names} is currently playing in a live match (PLAYING) and cannot be scheduled.` },
          { status: 409 }
        );
      }

      // 3. Conflict check: Check if playing area already occupied at scheduledTime
      const { data: existingOnCourt } = await supabase
        .from('matches')
        .select('id, status, playing_area, scheduled_time')
        .eq('event_id', eventId)
        .eq('playing_area', playingArea)
        .eq('scheduled_time', scheduledTime)
        .not('status', 'in', '("CANCELLED","COMPLETED","WALKOVER")');

      if (existingOnCourt && existingOnCourt.length > 0) {
        return NextResponse.json(
          { error: `Court conflict: ${playingArea} is already occupied at this time.` },
          { status: 409 }
        );
      }

      // 4. Generate globally unique 6-character Match Code
      const existingCodes = new Set<string>();
      const { data: currentMatches } = await supabase.from('matches').select('id, score');
      if (currentMatches) {
        currentMatches.forEach((m: any) => {
          const c = extractMatchCode(m);
          if (c) existingCodes.add(c.toUpperCase());
        });
      }
      const matchCode = generateUniqueMatchCode(existingCodes);

      // Score metadata storing team information
      const scoreMetadata = {
        match_code: matchCode,
        team1_id: resolvedTeam1Id,
        team2_id: resolvedTeam2Id,
        team1_name: cleanTeam1,
        team2_name: cleanTeam2,
        is_team_match: true,
        team1_player_ids: team1Players.map((p: any) => p.id),
        team2_player_ids: team2Players.map((p: any) => p.id)
      };

      const matchPayload: any = {
        event_id: eventId,
        sport: 'Cricket',
        category: category || 'Open Cricket',
        phase: phase || 'Round 1',
        playing_area: playingArea,
        scheduled_time: scheduledTime,
        reporting_time: reportingTime || null,
        team1_id: resolvedTeam1Id,
        team2_id: resolvedTeam2Id,
        team1_p1_id: team1CaptainId,
        team2_p1_id: team2CaptainId,
        status: 'NOTIFIED',
        match_code: matchCode,
        score: JSON.stringify(scoreMetadata)
      };

      let newMatch: any = null;
      const directInsert = await supabase
        .from('matches')
        .insert([matchPayload])
        .select()
        .single();

      if (!directInsert.error && directInsert.data) {
        newMatch = directInsert.data;
      } else if (
        directInsert.error &&
        (directInsert.error.code === 'PGRST204' ||
          directInsert.error.code === '42703' ||
          directInsert.error.message?.toLowerCase().includes('team1_id') ||
          directInsert.error.message?.toLowerCase().includes('match_code'))
      ) {
        // Fallback for schema cache / pending migration: insert without team1_id/team2_id/match_code
        const fallbackPayload: any = {
          event_id: eventId,
          sport: 'Cricket',
          category: category || 'Open Cricket',
          phase: phase || 'Round 1',
          playing_area: playingArea,
          scheduled_time: scheduledTime,
          reporting_time: reportingTime || null,
          team1_p1_id: team1CaptainId,
          team2_p1_id: team2CaptainId,
          status: 'NOTIFIED',
          score: JSON.stringify(scoreMetadata)
        };

        const fbInsert = await supabase
          .from('matches')
          .insert([fallbackPayload])
          .select()
          .single();

        if (fbInsert.error) {
          return NextResponse.json({ error: fbInsert.error.message }, { status: 500 });
        }
        newMatch = fbInsert.data;
      } else if (directInsert.error) {
        return NextResponse.json({ error: directInsert.error.message }, { status: 500 });
      }

      newMatch = {
        ...newMatch,
        match_code: matchCode
      };

      // 5. Mark all players across both teams as CALLED
      try {
        await supabase.rpc('call_players_for_match', { p_player_ids: allPlayerIds });
      } catch {
        await supabase.from('players').update({ status: 'CALLED' }).in('id', allPlayerIds);
      }

      // 6. Automatically identify and notify all players belonging to Team 1 and Team 2
      const formattedTime = new Date(scheduledTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const notificationMessage = `Your Cricket match (${cleanTeam1} vs ${cleanTeam2}) at ${playingArea} is scheduled for ${formattedTime}. Please report immediately.`;

      const notificationInserts = allPlayerIds.map((pid: string) => ({
        player_id: pid,
        match_id: newMatch.id,
        type: 'MATCH_CALLED',
        message: notificationMessage,
        read: false
      }));

      const { data: insertedNotifs } = await supabase
        .from('notifications')
        .insert(notificationInserts)
        .select();

      // Realtime broadcast to each player channel
      try {
        for (const pid of allPlayerIds) {
          const payload = (insertedNotifs || []).find((n: any) => n.player_id === pid) || {
            id: `gen-${Date.now()}-${pid}`,
            player_id: pid,
            match_id: newMatch.id,
            type: 'MATCH_CALLED',
            message: notificationMessage,
            sent_at: new Date().toISOString(),
            read: false
          };

          const channel = supabase.channel(`player-notifications-${pid}`);
          await new Promise((resolve) => {
            channel.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                channel
                  .send({
                    type: 'broadcast',
                    event: 'new-notification',
                    payload
                  })
                  .then(() => {
                    supabase.removeChannel(channel);
                    resolve(true);
                  })
                  .catch(() => {
                    supabase.removeChannel(channel);
                    resolve(false);
                  });
              } else {
                supabase.removeChannel(channel);
                resolve(false);
              }
            });
            setTimeout(() => {
              supabase.removeChannel(channel);
              resolve(false);
            }, 800);
          });
        }
      } catch (broadcastErr) {
        console.error('Realtime broadcast error:', broadcastErr);
      }

      return NextResponse.json({
        success: true,
        is_team_match: true,
        team1_name: cleanTeam1,
        team2_name: cleanTeam2,
        match: {
          ...newMatch,
          match_code: matchCode,
          team1_name: cleanTeam1,
          team2_name: cleanTeam2
        },
        team1PlayersCount: team1Players.length,
        team2PlayersCount: team2Players.length,
        totalNotified: allPlayerIds.length,
        notifications: insertedNotifs
      });
    }

    // =========================================================================
    // BRANCH B: BADMINTON / INDIVIDUAL-PLAYER MATCH CREATION (Existing Flow)
    // =========================================================================
    if (!team1_p1_id || !team2_p1_id) {
      return NextResponse.json({ error: 'Missing required match fields (players)' }, { status: 400 });
    }

    const playerIds = [team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id].filter(Boolean) as string[];

    // Ensure no internal player duplicate in the same match
    const uniqueIds = new Set(playerIds);
    if (uniqueIds.size !== playerIds.length) {
      return NextResponse.json(
        { error: 'A player cannot be selected more than once in the same match.' },
        { status: 400 }
      );
    }

    const playerLockKeys = playerIds.map(pid => `${eventId}|${pid}|${scheduledTime}`);
    const fixtureKey = getFixtureKey(
      eventId,
      sport,
      category,
      phase,
      playingArea,
      scheduledTime,
      team1_p1_id,
      team1_p2_id,
      team2_p1_id,
      team2_p2_id
    );

    // 1. Concurrency Check: Check in-flight locks for any of the players
    const conflictingLock = playerLockKeys.find(key => inFlightPlayerLocks.has(key));
    if (conflictingLock) {
      return NextResponse.json(
        { error: 'Player conflict: one or more players already have a match scheduled at this time.' },
        { status: 409 }
      );
    }

    if (inFlightFixtureLocks.has(fixtureKey)) {
      return NextResponse.json({ error: 'This match already exists.' }, { status: 409 });
    }

    // Acquire locks
    for (const key of playerLockKeys) inFlightPlayerLocks.add(key);
    inFlightFixtureLocks.add(fixtureKey);

    try {
      // 1. Defense-in-depth: Check if any selected player is currently PLAYING in a live match
      const { data: playingPlayers } = await supabase
        .from('players')
        .select('id, name, status')
        .in('id', playerIds)
        .eq('status', 'PLAYING');

      if (playingPlayers && playingPlayers.length > 0) {
        const names = playingPlayers.map((p: any) => p.name).join(', ');
        return NextResponse.json(
          { error: `Player conflict: ${names} is currently playing in a live match (PLAYING) and cannot be selected for another match.` },
          { status: 409 }
        );
      }

      // 2. Query database for any active matches at the same scheduled time
      const { data: activeMatchesAtTime } = await supabase
        .from('matches')
        .select('id, status, sport, category, phase, playing_area, scheduled_time, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id')
        .eq('event_id', eventId)
        .eq('scheduled_time', scheduledTime)
        .not('status', 'in', '("CANCELLED","COMPLETED","WALKOVER")');

      if (activeMatchesAtTime && activeMatchesAtTime.length > 0) {
        // 2a. Check for any overlapping player conflict regardless of court
        for (const m of activeMatchesAtTime) {
          const occupiedPlayerIds = [m.team1_p1_id, m.team1_p2_id, m.team2_p1_id, m.team2_p2_id].filter(Boolean);
          const hasPlayerConflict = playerIds.some(pid => occupiedPlayerIds.includes(pid));

          if (hasPlayerConflict) {
            return NextResponse.json(
              { error: 'Player conflict: one or more players already have a match scheduled at this time.' },
              { status: 409 }
            );
          }
        }

        // 2b. Check if court is already booked at this exact time
        const courtOccupied = activeMatchesAtTime.some((m: any) => m.playing_area === playingArea);
        if (courtOccupied) {
          return NextResponse.json(
            { error: `Court conflict: ${playingArea} is already occupied at this time.` },
            { status: 409 }
          );
        }
      }

      // 3. Generate globally unique 6-character Match Code
      const existingCodes = new Set<string>();
      const { data: currentMatches } = await supabase
        .from('matches')
        .select('id, score');
      if (currentMatches) {
        currentMatches.forEach((m: any) => {
          const c = extractMatchCode(m);
          if (c) existingCodes.add(c.toUpperCase());
        });
      }

      const matchCode = generateUniqueMatchCode(existingCodes);

      // 4. Insert match into database
      const matchPayload: any = {
        event_id: eventId,
        sport,
        category: category || 'NA',
        phase: phase || 'Round 1',
        playing_area: playingArea,
        scheduled_time: scheduledTime,
        reporting_time: reportingTime || null,
        team1_p1_id,
        team1_p2_id,
        team2_p1_id,
        team2_p2_id,
        status: 'NOTIFIED',
        match_code: matchCode,
        score: JSON.stringify({ match_code: matchCode })
      };

      let newMatch: any = null;
      let insertError: any = null;

      const directInsert = await supabase
        .from('matches')
        .insert([matchPayload])
        .select()
        .single();

      if (!directInsert.error && directInsert.data) {
        newMatch = directInsert.data;
      } else if (
        directInsert.error &&
        (directInsert.error.code === 'PGRST204' ||
          directInsert.error.code === '42703' ||
          directInsert.error.message?.toLowerCase().includes('match_code'))
      ) {
        // Fallback if match_code column not yet present in PostgREST schema cache
        const fallbackPayload = {
          event_id: eventId,
          sport,
          category: category || 'NA',
          phase: phase || 'Round 1',
          playing_area: playingArea,
          scheduled_time: scheduledTime,
          reporting_time: reportingTime || null,
          team1_p1_id,
          team1_p2_id,
          team2_p1_id,
          team2_p2_id,
          status: 'NOTIFIED',
          score: JSON.stringify({ match_code: matchCode })
        };

        const fbInsert = await supabase
          .from('matches')
          .insert([fallbackPayload])
          .select()
          .single();

        newMatch = fbInsert.data;
        insertError = fbInsert.error;
      } else {
        insertError = directInsert.error;
      }

      if (insertError) {
        const errMsg = insertError.message?.toLowerCase() || '';
        if (errMsg.includes('player conflict') || insertError.code === '23P01') {
          return NextResponse.json(
            { error: 'Player conflict: one or more players already have a match scheduled at this time.' },
            { status: 409 }
          );
        }
        if (insertError.code === '23505' || errMsg.includes('unique') || errMsg.includes('duplicate')) {
          return NextResponse.json({ error: 'This match already exists.' }, { status: 409 });
        }
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      newMatch = {
        ...newMatch,
        match_code: matchCode
      };

      // 5. Mark players as CALLED
      await supabase.rpc('call_players_for_match', { p_player_ids: playerIds });

      // 6. Create notification records in DB for all players in this match
      const formattedTime = new Date(scheduledTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const categoryText = category && category !== 'NA' ? category : (phase || 'Round 1');
      const notificationMessage = `Your ${sport} match (${categoryText}) at ${playingArea} is scheduled for ${formattedTime}. Please report immediately.`;

      const notificationInserts = playerIds.map(pid => ({
        player_id: pid,
        match_id: newMatch.id,
        type: 'MATCH_CALLED',
        message: notificationMessage,
        read: false
      }));

      const { data: insertedNotifs } = await supabase
        .from('notifications')
        .insert(notificationInserts)
        .select();

      // 7. Broadcast notification via Realtime channels to open player pages
      try {
        for (const pid of playerIds) {
          const insertedNotif = (insertedNotifs || []).find((n: any) => n.player_id === pid);
          const payload = insertedNotif || {
            id: `gen-${Date.now()}-${pid}`,
            player_id: pid,
            match_id: newMatch.id,
            type: 'MATCH_CALLED',
            message: notificationMessage,
            sent_at: new Date().toISOString(),
            read: false
          };

          const channel = supabase.channel(`player-notifications-${pid}`);
          await new Promise((resolve) => {
            channel.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                channel
                  .send({
                    type: 'broadcast',
                    event: 'new-notification',
                    payload
                  })
                  .then(() => {
                    supabase.removeChannel(channel);
                    resolve(true);
                  })
                  .catch(() => {
                    supabase.removeChannel(channel);
                    resolve(false);
                  });
              } else {
                supabase.removeChannel(channel);
                resolve(false);
              }
            });
            setTimeout(() => {
              supabase.removeChannel(channel);
              resolve(false);
            }, 800);
          });
        }
      } catch (broadcastErr) {
        console.error('Error broadcasting realtime notifications:', broadcastErr);
      }

      return NextResponse.json({ success: true, match: newMatch, notifications: insertedNotifs });
    } finally {
      // Release locks
      for (const key of playerLockKeys) inFlightPlayerLocks.delete(key);
      inFlightFixtureLocks.delete(fixtureKey);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
