export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/client';

export async function GET() {
  const supabase = createClient();
  const { data: players } = await supabase.from('players').select('*').limit(1);
  const columns = players && players.length > 0 ? Object.keys(players[0]) : [];
  return NextResponse.json({ columns });
}
