import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isValidMatchCode } from '@/utils/matchCode';
import {
  findMatchByMatchCode,
  serializeMatchScoreMetadata,
  sanitizeMatchForReferee,
} from '@/utils/refereeMatch';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchCode = body?.matchCode || body?.match_code;
    const refereeName = body?.refereeName || body?.referee_name;
    const winningTeam = body?.winningTeam || body?.winning_team;
    const winnerId = body?.winnerId || body?.winner_id;
    const scoreNotes = body?.scoreNotes ?? body?.score ?? '';

    if (!matchCode || typeof matchCode !== 'string') {
      return NextResponse.json(
        { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
        { status: 404 }
      );
    }

    const cleanCode = matchCode.trim().toUpperCase();
    if (!isValidMatchCode(cleanCode)) {
      return NextResponse.json(
        { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
        { status: 404 }
      );
    }

    if (winningTeam !== 'team1' && winningTeam !== 'team2') {
      return NextResponse.json(
        {
          error: 'Winner selection required',
          message: 'Please select whether Team 1 or Team 2 won the match.',
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const match = await findMatchByMatchCode(supabase, cleanCode);

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
        { status: 404 }
      );
    }

    // Safety checks: match must not be already finished
    if (['COMPLETED', 'WALKOVER', 'CANCELLED'].includes(match.status)) {
      return NextResponse.json(
        {
          error: 'Match already concluded',
          message: 'This match has already completed and cannot be modified.',
        },
        { status: 400 }
      );
    }

    // Safety check: must be started (LIVE) before completing
    if (match.status !== 'LIVE') {
      return NextResponse.json(
        {
          error: 'Match not started',
          message: 'The match must be started and LIVE before it can be completed.',
        },
        { status: 400 }
      );
    }

    // Determine winner player ID and winner display name
    const team1Pids = [match.team1_p1_id || match.team1_p1?.id, match.team1_p2_id || match.team1_p2?.id].filter(Boolean) as string[];
    const team2Pids = [match.team2_p1_id || match.team2_p1?.id, match.team2_p2_id || match.team2_p2?.id].filter(Boolean) as string[];

    const team1Names = [match.team1_p1?.name, match.team1_p2?.name].filter(Boolean);
    const team2Names = [match.team2_p1?.name, match.team2_p2?.name].filter(Boolean);

    let winnerIdToStore: string | null = null;
    let winnerName: string = '';

    if (winningTeam === 'team1') {
      winnerIdToStore = winnerId && team1Pids.includes(winnerId) ? winnerId : team1Pids[0] || null;
      winnerName = team1Names.join(' & ') || 'Team 1';
    } else {
      winnerIdToStore = winnerId && team2Pids.includes(winnerId) ? winnerId : team2Pids[0] || null;
      winnerName = team2Names.join(' & ') || 'Team 2';
    }

    const completedAt = new Date().toISOString();
    const cleanRefereeName = refereeName?.trim() || null;
    const cleanScoreNotes = typeof scoreNotes === 'string' ? scoreNotes.trim() : null;

    // 1. Serialize score metadata
    const updatedScore = serializeMatchScoreMetadata(match.score, cleanCode, {
      score: cleanScoreNotes || null,
      referee_name: cleanRefereeName,
      winner_name: winnerName,
      winner_id: winnerIdToStore,
      winning_team: winningTeam,
      status: 'COMPLETED',
      completed_at: completedAt,
    });

    // 2. Update match to COMPLETED
    const { error: matchUpdateErr } = await supabase
      .from('matches')
      .update({
        status: 'COMPLETED',
        winner_id: winnerIdToStore,
        score: updatedScore,
      })
      .eq('id', match.id);

    if (matchUpdateErr) {
      console.error('Failed to update match status to COMPLETED:', matchUpdateErr);
      return NextResponse.json(
        { error: 'Failed to complete match', message: matchUpdateErr.message },
        { status: 500 }
      );
    }

    // 3. Update participating players per SportsOps rules:
    // In V1, tournament progression (QUALIFIED/DISQUALIFIED) is NOT automated.
    // Participating players return to PRESENT status, preserving their attendance.
    const allPlayerIds = [...team1Pids, ...team2Pids];

    if (allPlayerIds.length > 0) {
      const { data: currentPlayers } = await supabase
        .from('players')
        .select('id, status, previous_status, check_in_time')
        .in('id', allPlayerIds);

      const playerMap = new Map((currentPlayers || []).map((p) => [p.id, p]));

      for (const pid of allPlayerIds) {
        const p = playerMap.get(pid);
        let nextStatus = 'PRESENT';
        if (p) {
          if (p.check_in_time || p.previous_status === 'PRESENT' || p.previous_status === 'AVAILABLE') {
            nextStatus = 'PRESENT';
          } else if (p.previous_status && ['REGISTERED', 'ABSENT'].includes(p.previous_status)) {
            nextStatus = p.previous_status;
          }
        }

        await supabase
          .from('players')
          .update({
            previous_status: p?.status || null,
            status: nextStatus,
          })
          .eq('id', pid);
      }
    }

    // 4. Refetch fresh match record
    const updatedMatch = await findMatchByMatchCode(supabase, cleanCode);
    const sanitized = sanitizeMatchForReferee(updatedMatch || {
      ...match,
      status: 'COMPLETED',
      winner_id: winnerIdToStore,
      score: updatedScore,
    }, cleanRefereeName);

    return NextResponse.json({
      success: true,
      match: sanitized,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/referee/complete:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
