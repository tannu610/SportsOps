import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { formatMatchHistoryEntry, MatchHistoryEntry } from '@/utils/matchHistory';
import {
  buildMatchHistoryExcelBuffer,
  generateMatchHistoryFilename,
} from '@/utils/matchHistoryExport';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sport = searchParams.get('sport')?.trim();
    const category = searchParams.get('category')?.trim();
    const round = searchParams.get('round')?.trim();
    const referee = searchParams.get('referee')?.trim();
    const search = searchParams.get('search')?.trim();
    const eventId = searchParams.get('eventId')?.trim();

    const supabase = await createClient();

    let query = supabase
      .from('matches')
      .select(`
        id, event_id, sport, category, phase, playing_area, scheduled_time, reporting_time, status, score, winner_id, created_at,
        team1_p1:players!fk_t1p1(id, name),
        team1_p2:players!fk_t1p2(id, name),
        team2_p1:players!fk_t2p1(id, name),
        team2_p2:players!fk_t2p2(id, name),
        winner:players!winner_id(id, name)
      `)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false });

    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    const { data: rawMatches, error: fetchErr } = await query;

    if (fetchErr) {
      console.error('Error fetching completed matches for Match History Export:', fetchErr);
      return NextResponse.json(
        { error: 'Failed to fetch match history: ' + fetchErr.message },
        { status: 500 }
      );
    }

    // Filter to ONLY matches that are COMPLETED AND have a valid referee result
    const allHistoryEntries: MatchHistoryEntry[] = (rawMatches || [])
      .map(formatMatchHistoryEntry)
      .filter((entry): entry is MatchHistoryEntry => entry !== null);

    // Apply exact filter parameters
    let filtered = allHistoryEntries;

    if (sport && sport !== 'ALL') {
      filtered = filtered.filter(
        (m) => m.sport.toLowerCase() === sport.toLowerCase()
      );
    }

    if (category && category !== 'ALL') {
      filtered = filtered.filter(
        (m) => m.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (round && round !== 'ALL') {
      filtered = filtered.filter(
        (m) => m.phase.toLowerCase() === round.toLowerCase()
      );
    }

    if (referee && referee !== 'ALL') {
      filtered = filtered.filter(
        (m) => m.referee_name.toLowerCase() === referee.toLowerCase()
      );
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((m) => {
        const inCode = m.match_code.toLowerCase().includes(q);
        const inPlayers = m.players_display.toLowerCase().includes(q);
        const inReferee = m.referee_name.toLowerCase().includes(q);
        const inWinner = m.winner_name.toLowerCase().includes(q);
        return inCode || inPlayers || inReferee || inWinner;
      });
    }

    // Check zero matches condition
    if (filtered.length === 0) {
      return NextResponse.json(
        {
          error: 'No match history records found for the selected filters.',
          totalCount: 0,
        },
        { status: 404 }
      );
    }

    const filename = generateMatchHistoryFilename({
      sport: sport || 'ALL',
      category: category || 'ALL',
      round: round || 'ALL',
      referee: referee || 'ALL',
    });

    const buffer = buildMatchHistoryExcelBuffer(filtered);

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Count': String(filtered.length),
      },
    });
  } catch (err: any) {
    console.error('Unexpected error in GET /api/admin/history/export:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
