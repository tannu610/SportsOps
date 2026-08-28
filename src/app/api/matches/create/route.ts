import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

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
      team1_p1_id,
      team1_p2_id = null,
      team2_p1_id,
      team2_p2_id = null,
    } = body;

    if (!eventId || !sport || !playingArea || !scheduledTime || !team1_p1_id || !team2_p1_id) {
      return NextResponse.json({ error: 'Missing required match fields' }, { status: 400 });
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
      // 2. Query database for any active matches at the same scheduled time
      const { data: activeMatchesAtTime, error: searchError } = await supabase
        .from('matches')
        .select('id, status, sport, category, phase, playing_area, scheduled_time, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id')
        .eq('event_id', eventId)
        .eq('scheduled_time', scheduledTime)
        .not('status', 'in', '("CANCELLED","COMPLETED","WALKOVER")');

      if (searchError) {
        console.error('Error checking active matches:', searchError);
      }

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
        const courtOccupied = activeMatchesAtTime.some(m => m.playing_area === playingArea);
        if (courtOccupied) {
          return NextResponse.json(
            { error: `Court conflict: ${playingArea} is already occupied at this time.` },
            { status: 409 }
          );
        }
      }

      // 3. Insert match into database
      const { data: newMatch, error: insertError } = await supabase
        .from('matches')
        .insert([{
          event_id: eventId,
          sport,
          category: category || 'NA',
          phase: phase || 'Round 1',
          playing_area: playingArea,
          scheduled_time: scheduledTime,
          team1_p1_id,
          team1_p2_id,
          team2_p1_id,
          team2_p2_id,
          status: 'NOTIFIED'
        }])
        .select()
        .single();

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

      // 4. Mark players as CALLED
      await supabase.rpc('call_players_for_match', { p_player_ids: playerIds });

      return NextResponse.json({ success: true, match: newMatch });
    } finally {
      // Release locks
      for (const key of playerLockKeys) inFlightPlayerLocks.delete(key);
      inFlightFixtureLocks.delete(fixtureKey);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
