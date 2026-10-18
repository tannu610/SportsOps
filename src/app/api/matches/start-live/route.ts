import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractMatchCode } from '@/utils/matchCode';
import { extractPlayerTeam } from '@/utils/teamUtils';

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
      .select('id, event_id, sport, category, playing_area, status, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id, score')
      .eq('id', matchId)
      .single();

    if (fetchErr || !match) {
      return NextResponse.json({ error: 'Match not found: ' + (fetchErr?.message || 'Invalid ID') }, { status: 404 });
    }

    let playerIds = [
      match.team1_p1_id,
      match.team1_p2_id,
      match.team2_p1_id,
      match.team2_p2_id,
    ].filter(Boolean) as string[];

    // If team match (Cricket), retrieve all players belonging to Team 1 and Team 2
    try {
      const scoreMeta = typeof match.score === 'string' && match.score.startsWith('{')
        ? JSON.parse(match.score)
        : {};
      if (scoreMeta.is_team_match && (scoreMeta.team1_name || scoreMeta.team2_name)) {
        const { data: teamPlayers } = await supabase
          .from('players')
          .select('*')
          .eq('event_id', match.event_id);

        const allMatching = (teamPlayers || []).filter((p: any) => {
          if (scoreMeta.team1_id && p.team_id === scoreMeta.team1_id) return true;
          if (scoreMeta.team2_id && p.team_id === scoreMeta.team2_id) return true;
          const t = extractPlayerTeam(p);
          return t && (
            (scoreMeta.team1_name && t.toLowerCase() === scoreMeta.team1_name.toLowerCase()) ||
            (scoreMeta.team2_name && t.toLowerCase() === scoreMeta.team2_name.toLowerCase())
          );
        });
        if (allMatching.length > 0) {
          playerIds = Array.from(new Set([...playerIds, ...allMatching.map((p: any) => p.id)]));
        }
      }
    } catch {}

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

      const playerMap = new Map((currentPlayers || []).map((p: any) => [p.id, p]));

      for (const pid of playerIds) {
        const currentP = playerMap.get(pid);
        const originalStatus =
          currentP?.previous_status === 'PRESENT' || currentP?.previous_status === 'AVAILABLE'
            ? currentP.previous_status
            : (currentP?.status === 'CALLED' ? 'PRESENT' : currentP?.status || null);

        await supabase
          .from('players')
          .update({
            previous_status: originalStatus,
            status: 'PLAYING',
          })
          .eq('id', pid);
      }
    }

    const finalCode = extractMatchCode(updatedMatch) || extractMatchCode(match);

    return NextResponse.json({
      success: true,
      match: {
        ...updatedMatch,
        ...(finalCode ? { match_code: finalCode } : {})
      },
      affectedPlayerIds: playerIds,
      playerStatus: 'PLAYING',
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/matches/start-live:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
