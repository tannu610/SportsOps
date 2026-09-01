import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { matchId, winningTeam = 'team1', isWalkover = false } = body;

    if (!matchId) {
      return NextResponse.json({ error: 'Missing matchId parameter' }, { status: 400 });
    }

    // 1. Fetch match details
    const { data: match, error: fetchErr } = await supabase
      .from('matches')
      .select('id, event_id, sport, category, playing_area, status, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id')
      .eq('id', matchId)
      .single();

    if (fetchErr || !match) {
      return NextResponse.json({ error: 'Match not found: ' + (fetchErr?.message || 'Invalid ID') }, { status: 404 });
    }

    // 2. Determine match status
    const newMatchStatus = isWalkover ? 'WALKOVER' : 'COMPLETED';

    // 3. Update match record
    const { error: matchUpdateErr } = await supabase
      .from('matches')
      .update({ status: newMatchStatus })
      .eq('id', matchId);

    if (matchUpdateErr) {
      return NextResponse.json({ error: 'Failed to update match status: ' + matchUpdateErr.message }, { status: 500 });
    }

    // 4. Update participating players:
    // In V1, SportsOps does NOT decide tournament progression (QUALIFIED) or elimination (DISQUALIFIED).
    // - If the player checked in before the match (check_in_time IS NOT NULL or previous_status was PRESENT/AVAILABLE),
    //   their status returns to PRESENT.
    // - If the player had not checked in, preserve their existing attendance state (REGISTERED / ABSENT).
    const allPlayerIds = [
      match.team1_p1_id,
      match.team1_p2_id,
      match.team2_p1_id,
      match.team2_p2_id,
    ].filter(Boolean) as string[];

    if (allPlayerIds.length > 0) {
      const { data: participatingPlayers, error: pFetchErr } = await supabase
        .from('players')
        .select('id, status, previous_status, check_in_time')
        .in('id', allPlayerIds);

      if (pFetchErr) {
        console.error('Error fetching participating players for status reset:', pFetchErr);
      }

      const playerMap = new Map((participatingPlayers || []).map((p) => [p.id, p]));

      const determinePlayerStatus = (playerId: string, isWalkoverLoser: boolean) => {
        if (isWalkoverLoser) return 'NO_SHOW';
        const p = playerMap.get(playerId);
        if (!p) return 'PRESENT'; // default fallback for active match participant
        if (p.check_in_time || p.previous_status === 'PRESENT' || p.previous_status === 'AVAILABLE') {
          return 'PRESENT';
        }
        if (p.previous_status && ['REGISTERED', 'ABSENT'].includes(p.previous_status)) {
          return p.previous_status;
        }
        return 'REGISTERED';
      };

      const winners = winningTeam === 'team1'
        ? [match.team1_p1_id, match.team1_p2_id].filter(Boolean) as string[]
        : [match.team2_p1_id, match.team2_p2_id].filter(Boolean) as string[];
      const losers = winningTeam === 'team1'
        ? [match.team2_p1_id, match.team2_p2_id].filter(Boolean) as string[]
        : [match.team1_p1_id, match.team1_p2_id].filter(Boolean) as string[];

      for (const pid of allPlayerIds) {
        const isLoser = isWalkover && losers.includes(pid);
        const nextStatus = determinePlayerStatus(pid, isLoser);
        const currentP = playerMap.get(pid);

        await supabase
          .from('players')
          .update({
            previous_status: currentP?.status || null,
            status: nextStatus,
          })
          .eq('id', pid);
      }
    }

    return NextResponse.json({
      success: true,
      match: {
        id: matchId,
        status: newMatchStatus,
      },
      affectedPlayerIds: allPlayerIds,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/matches/complete:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
