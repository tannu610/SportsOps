import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isValidMatchCode } from '@/utils/matchCode';
import { findMatchByMatchCode, sanitizeMatchForReferee } from '@/utils/refereeMatch';

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

    const supabase = await createClient();
    const match = await findMatchByMatchCode(supabase, cleanCode);

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
        { status: 404 }
      );
    }

    const sanitized = sanitizeMatchForReferee(match, refereeName);
    return NextResponse.json({
      success: true,
      match: sanitized,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/referee/lookup:', err);
    return NextResponse.json(
      { error: 'Match not found', message: 'Please check the Match Code provided by the committee.' },
      { status: 500 }
    );
  }
}
