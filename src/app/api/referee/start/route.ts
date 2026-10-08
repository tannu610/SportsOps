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

    if (!refereeName || typeof refereeName !== 'string' || !refereeName.trim()) {
      return NextResponse.json(
        { error: 'Referee name is required', message: 'Please enter your name before starting the match.' },
        { status: 400 }
      );
    }

    const trimmedRefereeName = refereeName.trim();
    const supabase = await createClient();
    const match = await findMatchByMatchCode(supabase, cleanCode);

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
        { status: 404 }
      );
    }

    // Safety checks on state
    if (['COMPLETED', 'WALKOVER', 'CANCELLED'].includes(match.status)) {
      return NextResponse.json(
        {
          error: 'Match already concluded',
          message: 'This match has already completed and cannot be restarted.',
        },
        { status: 400 }
      );
    }

    // If already LIVE, return current match with referee name recorded
    if (match.status === 'LIVE') {
      const sanitized = sanitizeMatchForReferee(match, trimmedRefereeName);
      return NextResponse.json({ success: true, match: sanitized });
    }

    // 1. Prepare score metadata with referee_name & status
    const updatedScore = serializeMatchScoreMetadata(match.score, cleanCode, {
      referee_name: trimmedRefereeName,
      status: 'LIVE',
    });

    // 2. Update match status to LIVE
    const { error: matchUpdateErr } = await supabase
      .from('matches')
      .update({
        status: 'LIVE',
        score: updatedScore,
      })
      .eq('id', match.id);

    if (matchUpdateErr) {
      console.error('Failed to update match status to LIVE:', matchUpdateErr);
      return NextResponse.json(
        { error: 'Failed to update match', message: matchUpdateErr.message },
        { status: 500 }
      );
    }

    // 3. Update participating players to PLAYING
    const playerIds = [
      match.team1_p1_id || match.team1_p1?.id,
      match.team1_p2_id || match.team1_p2?.id,
      match.team2_p1_id || match.team2_p1?.id,
      match.team2_p2_id || match.team2_p2?.id,
    ].filter(Boolean) as string[];

    if (playerIds.length > 0) {
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

    // 4. Refetch fresh match record
    const updatedMatch = await findMatchByMatchCode(supabase, cleanCode);
    const sanitized = sanitizeMatchForReferee(updatedMatch || {
      ...match,
      status: 'LIVE',
      score: updatedScore,
    }, trimmedRefereeName);

    return NextResponse.json({
      success: true,
      match: sanitized,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/referee/start:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
