import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { matchId } = body;

    if (!matchId) {
      return NextResponse.json({ error: 'Missing matchId parameter' }, { status: 400 });
    }

    // 1. Fetch match and participating player IDs
    const { data: match, error: fetchErr } = await supabase
      .from('matches')
      .select('id, event_id, sport, category, playing_area, status, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id')
      .eq('id', matchId)
      .single();

    if (fetchErr || !match) {
      return NextResponse.json({ error: 'Match not found: ' + (fetchErr?.message || 'Invalid ID') }, { status: 404 });
    }

    const playerIds = [
      match.team1_p1_id,
      match.team1_p2_id,
      match.team2_p1_id,
      match.team2_p2_id,
    ].filter(Boolean) as string[];

    // 2. Update match status to LIVE
    const { data: updatedMatch, error: matchUpdateErr } = await supabase
      .from('matches')
      .update({ status: 'LIVE' })
      .eq('id', matchId)
      .select()
      .single();

    if (matchUpdateErr) {
      return NextResponse.json({ error: 'Failed to update match status: ' + matchUpdateErr.message }, { status: 500 });
    }

    // 3. Update all participating players to PLAYING
    if (playerIds.length > 0) {
      // Fetch current statuses to preserve previous_status
      const { data: currentPlayers } = await supabase
        .from('players')
        .select('id, status')
        .in('id', playerIds);

      const playerMap = new Map((currentPlayers || []).map((p) => [p.id, p]));

      for (const pid of playerIds) {
        const currentP = playerMap.get(pid);
        await supabase
          .from('players')
          .update({
            previous_status: currentP?.status || null,
            status: 'PLAYING',
          })
          .eq('id', pid);
      }
    }

    return NextResponse.json({
      success: true,
      match: updatedMatch,
      affectedPlayerIds: playerIds,
      playerStatus: 'PLAYING',
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/matches/start-live:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
