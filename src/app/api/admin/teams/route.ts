import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStructuredTeams } from '@/utils/teamUtils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const sport = searchParams.get('sport') || 'Cricket';

    const supabase = await createClient();

    let query = supabase.from('players').select('*');
    if (eventId) {
      query = query.eq('event_id', eventId);
    }
    if (sport && sport !== 'ALL') {
      query = query.ilike('sport', `%${sport}%`);
    }

    const { data: players, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const teams = getStructuredTeams(players || [], sport);

    return NextResponse.json({
      success: true,
      sport,
      teamsCount: teams.length,
      totalTeams: teams.length,
      totalPlayers: teams.reduce((acc, t) => acc + t.playerCount, 0),
      teams
    });
  } catch (err: any) {
    console.error('Error fetching event teams:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
