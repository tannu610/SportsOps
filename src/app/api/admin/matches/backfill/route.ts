import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { backfillMissingMatchCodes } from '@/utils/matchBackfill';
import { extractMatchCode } from '@/utils/matchCode';

export async function GET() {
  try {
    const supabase = await createClient();

    let allMatches: any[] = [];
    const q1 = await supabase
      .from('matches')
      .select('id, sport, category, playing_area, scheduled_time, status, score, match_code');

    if (!q1.error && q1.data) {
      allMatches = q1.data;
    } else {
      const q2 = await supabase
        .from('matches')
        .select('id, sport, category, playing_area, scheduled_time, status, score');
      if (q2.error) {
        return NextResponse.json({ error: q2.error.message }, { status: 500 });
      }
      allMatches = q2.data || [];
    }

    const total = allMatches.length;
    const withCode = allMatches.filter((m: any) => extractMatchCode(m) !== null).length;
    const missingCode = total - withCode;

    return NextResponse.json({
      total,
      withCode,
      missingCode,
      allAssigned: missingCode === 0
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const supabase = await createClient();
    const result = await backfillMissingMatchCodes(supabase);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Match Backfill API error:', err);
    return NextResponse.json({ error: err.message || 'Backfill failed' }, { status: 500 });
  }
}
