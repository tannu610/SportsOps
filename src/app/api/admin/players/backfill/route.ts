import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { backfillMissingPlayerCodes } from '@/utils/playerBackfill';
import { extractPlayerCode } from '@/utils/playerCode';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: allPlayers, error } = await supabase
      .from('players')
      .select('id, employee_id, name, player_code, push_subscription');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = allPlayers?.length || 0;
    const withCode = allPlayers?.filter((p: any) => extractPlayerCode(p) !== null).length || 0;
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
    const result = await backfillMissingPlayerCodes(supabase);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Backfill API error:', err);
    return NextResponse.json({ error: err.message || 'Backfill failed' }, { status: 500 });
  }
}
