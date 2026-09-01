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
    // All participating players in a completed match are reset to REGISTERED and remain selectable for future matches.
    const allPlayerIds = [
      match.team1_p1_id,
      match.team1_p2_id,
      match.team2_p1_id,
      match.team2_p2_id,
    ].filter(Boolean) as string[];

    if (isWalkover) {
      const winners = winningTeam === 'team1'
        ? [match.team1_p1_id, match.team1_p2_id].filter(Boolean) as string[]
        : [match.team2_p1_id, match.team2_p2_id].filter(Boolean) as string[];
      const losers = winningTeam === 'team1'
        ? [match.team2_p1_id, match.team2_p2_id].filter(Boolean) as string[]
        : [match.team1_p1_id, match.team1_p2_id].filter(Boolean) as string[];

      if (winners.length > 0) {
        await supabase.from('players').update({ status: 'REGISTERED' }).in('id', winners);
      }
      if (losers.length > 0) {
        await supabase.from('players').update({ status: 'NO_SHOW' }).in('id', losers);
      }
    } else {
      if (allPlayerIds.length > 0) {
        const { error: playersUpdateErr } = await supabase
          .from('players')
          .update({ status: 'REGISTERED' })
          .in('id', allPlayerIds);

        if (playersUpdateErr) {
          console.error('Error resetting players to REGISTERED:', playersUpdateErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      match: {
        id: matchId,
        status: newMatchStatus,
      },
      affectedPlayerIds: allPlayerIds,
      playerStatus: 'REGISTERED',
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/matches/complete:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
