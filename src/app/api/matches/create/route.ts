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
      // 1. Defense-in-depth: Check if any selected player is currently PLAYING in a live match
      const { data: playingPlayers, error: playingErr } = await supabase
        .from('players')
        .select('id, name, status')
        .in('id', playerIds)
        .eq('status', 'PLAYING');

      if (playingPlayers && playingPlayers.length > 0) {
        const names = playingPlayers.map(p => p.name).join(', ');
        return NextResponse.json(
          { error: `Player conflict: ${names} is currently playing in a live match (PLAYING) and cannot be selected for another match.` },
          { status: 409 }
        );
      }

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

      // 5. Create notification records in DB for all players in this match
      const formattedTime = new Date(scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const categoryText = category && category !== 'NA' ? category : (phase || 'Round 1');
      const notificationMessage = `Your ${sport} match (${categoryText}) at ${playingArea} is scheduled for ${formattedTime}. Please report immediately.`;

      const notificationInserts = playerIds.map(pid => ({
        player_id: pid,
        match_id: newMatch.id,
        type: 'MATCH_CALLED',
        message: notificationMessage,
        read: false
      }));

      const { data: insertedNotifs, error: notifErr } = await supabase
        .from('notifications')
        .insert(notificationInserts)
        .select();

      if (notifErr) {
        console.error('Error creating player notifications:', notifErr);
      }

      // 6. Broadcast notification via Realtime channels to open player pages
      try {
        for (const pid of playerIds) {
          const insertedNotif = (insertedNotifs || []).find(n => n.player_id === pid);
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
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                supabase.removeChannel(channel);
                resolve(false);
              }
            });
            setTimeout(() => {
              supabase.removeChannel(channel);
              resolve(false);
            }, 1000);
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
