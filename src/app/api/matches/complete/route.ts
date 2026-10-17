import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractMatchCode } from '@/utils/matchCode';
import { extractPlayerTeam } from '@/utils/teamUtils';

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
      .select('id, event_id, sport, category, playing_area, status, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id, score')
      .eq('id', matchId)
      .single();

    if (fetchErr || !match) {
      return NextResponse.json({ error: 'Match not found: ' + (fetchErr?.message || 'Invalid ID') }, { status: 404 });
    }

    // Check if team match
    let scoreMeta: any = {};
    try {
      if (typeof match.score === 'string' && match.score.startsWith('{')) {
        scoreMeta = JSON.parse(match.score);
      }
    } catch {}

    const isTeamMatch = Boolean(scoreMeta?.is_team_match && (scoreMeta?.team1_name || scoreMeta?.team2_name));

    // 2. Determine match status
    const newMatchStatus = isWalkover ? 'WALKOVER' : 'COMPLETED';

    // Update score metadata with winning team info
    if (isTeamMatch) {
      const winnerName = winningTeam === 'team1' ? scoreMeta.team1_name : scoreMeta.team2_name;
      scoreMeta = {
        ...scoreMeta,
        winning_team: winningTeam,
        winner_name: winnerName,
        completed_at: new Date().toISOString()
      };
    }

    // 3. Update match record
    const { error: matchUpdateErr } = await supabase
      .from('matches')
      .update({
        status: newMatchStatus,
        score: JSON.stringify(scoreMeta)
      })
      .eq('id', matchId);

    if (matchUpdateErr) {
      return NextResponse.json({ error: 'Failed to update match status: ' + matchUpdateErr.message }, { status: 500 });
    }

    // 4. Update participating players:
    // In V1, SportsOps does NOT decide tournament progression (QUALIFIED) or elimination (DISQUALIFIED).
    // - If the player checked in before the match, their status returns to PRESENT.
    // - If the player had not checked in, preserve their existing attendance state (REGISTERED / ABSENT).
    let allPlayerIds = [
      match.team1_p1_id,
      match.team1_p2_id,
      match.team2_p1_id,
      match.team2_p2_id,
    ].filter(Boolean) as string[];

    let team1Pids: string[] = [match.team1_p1_id, match.team1_p2_id].filter(Boolean) as string[];
    let team2Pids: string[] = [match.team2_p1_id, match.team2_p2_id].filter(Boolean) as string[];

    if (isTeamMatch) {
      const { data: teamPlayers } = await supabase
        .from('players')
        .select('*')
        .eq('event_id', match.event_id);

      const t1List: string[] = [];
      const t2List: string[] = [];

      (teamPlayers || []).forEach((p: any) => {
        const t = extractPlayerTeam(p);
        if (t && scoreMeta.team1_name && t.toLowerCase() === scoreMeta.team1_name.toLowerCase()) {
          t1List.push(p.id);
        } else if (t && scoreMeta.team2_name && t.toLowerCase() === scoreMeta.team2_name.toLowerCase()) {
          t2List.push(p.id);
        }
      });

      if (t1List.length > 0 || t2List.length > 0) {
        team1Pids = t1List;
        team2Pids = t2List;
        allPlayerIds = Array.from(new Set([...t1List, ...t2List]));
      }
    }

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
        if (
          p.check_in_time ||
          p.previous_status === 'PRESENT' ||
          p.previous_status === 'AVAILABLE' ||
          p.previous_status === 'CALLED' ||
          p.status === 'PLAYING'
        ) {
          return 'PRESENT';
        }
        if (p.previous_status && ['REGISTERED', 'ABSENT'].includes(p.previous_status)) {
          return p.previous_status;
        }
        return 'PRESENT';
      };

      const losers = winningTeam === 'team1' ? team2Pids : team1Pids;

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

    const matchCode = extractMatchCode(match);

    return NextResponse.json({
      success: true,
      match: {
        id: matchId,
        status: newMatchStatus,
        ...(matchCode ? { match_code: matchCode } : {}),
      },
      affectedPlayerIds: allPlayerIds,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/matches/complete:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
