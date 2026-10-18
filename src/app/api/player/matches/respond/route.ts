import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractPlayerTeam } from '@/utils/teamUtils';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { matchId, playerId, response } = body;

    // 1. Validations
    if (!matchId || !playerId || !response) {
      return NextResponse.json({ error: 'Missing required parameters: matchId, playerId, and response are required.' }, { status: 400 });
    }

    const cleanResponse = String(response).trim().toUpperCase();
    if (cleanResponse !== 'COMING' && cleanResponse !== 'NOT_COMING') {
      return NextResponse.json({ error: 'Invalid response value. Must be COMING or NOT_COMING.' }, { status: 400 });
    }

    // 2. Fetch match
    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .select('id, event_id, sport, category, playing_area, status, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id, score')
      .eq('id', matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
    }

    // 3. Fetch player and verify eligibility for this match
    const { data: player, error: playerErr } = await supabase
      .from('players')
      .select('id, event_id, name, employee_id, sport, push_subscription')
      .eq('id', playerId)
      .single();

    if (playerErr || !player) {
      return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
    }

    if (player.event_id !== match.event_id) {
      return NextResponse.json({ error: 'Player does not belong to the event for this match.' }, { status: 403 });
    }

    // Verify player is part of the match
    let isEligible = false;
    let scoreMeta: any = {};
    try {
      if (typeof match.score === 'string' && match.score.startsWith('{')) {
        scoreMeta = JSON.parse(match.score);
      } else if (typeof match.score === 'object' && match.score !== null) {
        scoreMeta = match.score;
      }
    } catch {}

    const directIds = [match.team1_p1_id, match.team1_p2_id, match.team2_p1_id, match.team2_p2_id].filter(Boolean);
    if (directIds.includes(playerId)) {
      isEligible = true;
    }

    if (!isEligible && scoreMeta.is_team_match) {
      const team1Ids = scoreMeta.team1_player_ids || [];
      const team2Ids = scoreMeta.team2_player_ids || [];
      if (team1Ids.includes(playerId) || team2Ids.includes(playerId)) {
        isEligible = true;
      } else {
        const playerTeam = extractPlayerTeam(player);
        if (
          playerTeam &&
          ((scoreMeta.team1_name && playerTeam.toLowerCase() === scoreMeta.team1_name.toLowerCase()) ||
            (scoreMeta.team2_name && playerTeam.toLowerCase() === scoreMeta.team2_name.toLowerCase()))
        ) {
          isEligible = true;
        }
      }
    }

    if (!isEligible) {
      // In non-strict mode or walk-in/replacement scenarios, check if player has a MATCH_CALLED notification for this match
      const { data: notif } = await supabase
        .from('notifications')
        .select('id')
        .eq('player_id', playerId)
        .eq('match_id', matchId)
        .maybeSingle();

      if (notif) {
        isEligible = true;
      }
    }

    if (!isEligible) {
      return NextResponse.json(
        { error: 'Player is not scheduled to participate in this match.' },
        { status: 403 }
      );
    }

    const respondedAt = new Date().toISOString();

    // 4. Persist in match_player_responses table (relational)
    try {
      await supabase
        .from('match_player_responses')
        .upsert(
          {
            match_id: matchId,
            player_id: playerId,
            response: cleanResponse,
            responded_at: respondedAt,
            updated_at: respondedAt
          },
          { onConflict: 'match_id,player_id' }
        );
    } catch (tblErr) {
      console.warn('match_player_responses upsert deferred to score json:', tblErr);
    }

    // 5. Update matches.score JSON for instant Realtime broadcast to admin and player dashboards
    scoreMeta.player_responses = scoreMeta.player_responses || {};
    scoreMeta.player_responses[playerId] = {
      response: cleanResponse,
      responded_at: respondedAt,
      player_name: player.name
    };

    await supabase
      .from('matches')
      .update({
        score: JSON.stringify(scoreMeta)
      })
      .eq('id', matchId);

    // 6. Broadcast Realtime channel update for active view subscribers
    try {
      const channel = supabase.channel(`match-responses-${matchId}`);
      await new Promise((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel
              .send({
                type: 'broadcast',
                event: 'player-response',
                payload: {
                  matchId,
                  playerId,
                  playerName: player.name,
                  response: cleanResponse,
                  respondedAt
                }
              })
              .then(() => {
                supabase.removeChannel(channel);
                resolve(true);
              });
          }
        });
        setTimeout(resolve, 300);
      });
    } catch {}

    return NextResponse.json({
      success: true,
      matchId,
      playerId,
      playerName: player.name,
      response: cleanResponse,
      respondedAt,
      message: cleanResponse === 'COMING' ? "Response recorded: I'm Coming" : "Response recorded: Can't Make It"
    });
  } catch (err: any) {
    console.error('Error recording match player response:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get('matchId');
    const playerId = searchParams.get('playerId');

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Try relational match_player_responses table
    let responseRecord: any = null;
    try {
      let query = supabase
        .from('match_player_responses')
        .select('id, match_id, player_id, response, responded_at')
        .eq('match_id', matchId);

      if (playerId) {
        query = query.eq('player_id', playerId);
        const { data } = await query.maybeSingle();
        if (data) responseRecord = data;
      } else {
        const { data } = await query;
        if (data && data.length > 0) responseRecord = data;
      }
    } catch {}

    // 2. Fallback to matches.score JSON if relational table was not present or empty
    if (!responseRecord) {
      const { data: match } = await supabase
        .from('matches')
        .select('score')
        .eq('id', matchId)
        .maybeSingle();

      if (match?.score) {
        try {
          const scoreMeta = typeof match.score === 'string' ? JSON.parse(match.score) : match.score;
          const playerResponses = scoreMeta?.player_responses || {};
          if (playerId) {
            if (playerResponses[playerId]) {
              responseRecord = {
                match_id: matchId,
                player_id: playerId,
                response: playerResponses[playerId].response,
                responded_at: playerResponses[playerId].responded_at
              };
            }
          } else {
            responseRecord = Object.entries(playerResponses).map(([pid, val]: [string, any]) => ({
              match_id: matchId,
              player_id: pid,
              response: val.response,
              responded_at: val.responded_at
            }));
          }
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      matchId,
      playerId: playerId || null,
      response: responseRecord?.response || null,
      respondedAt: responseRecord?.responded_at || null,
      data: responseRecord || null
    });
  } catch (err: any) {
    console.error('Error fetching match response:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
