import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStructuredTeams } from '@/utils/teamUtils';
import { extractPlayerCode } from '@/utils/playerCode';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const sport = searchParams.get('sport') || 'Cricket';

    const supabase = await createClient();

    // 1. If querying Cricket for an event, check relational cricket_teams first
    if (eventId && (!sport || sport.toLowerCase().includes('cricket'))) {
      try {
        const { data: dbTeams, error: dbTeamsErr } = await supabase
          .from('cricket_teams')
          .select(`
            id, name, category, captain_name, captain_player_id,
            captain_player:players!captain_player_id(id, name, employee_id, push_subscription),
            members:cricket_team_members(
              id, is_captain,
              player:players(id, employee_id, name, contact_info, status, push_subscription)
            )
          `)
          .eq('event_id', eventId);

        if (!dbTeamsErr && dbTeams && dbTeams.length > 0) {
          const structuredRelationalTeams = dbTeams.map((t: any) => {
            const capPlayer = t.captain_player;
            const capCode = capPlayer ? extractPlayerCode(capPlayer) : null;
            const members = (t.members || []).map((m: any) => {
              const p = m.player || {};
              return {
                id: p.id,
                employeeId: p.employee_id,
                playerCode: extractPlayerCode(p) || '-',
                name: p.name,
                isCaptain: m.is_captain || false,
                contact: p.contact_info,
                status: p.status
              };
            });

            return {
              teamId: t.id,
              teamName: t.name,
              captainName: t.captain_name || capPlayer?.name || null,
              captainPlayerId: t.captain_player_id,
              captainPlayerCode: capCode,
              sport: 'Cricket',
              category: t.category || 'Open Cricket',
              playerCount: members.length,
              players: members
            };
          });

          return NextResponse.json({
            success: true,
            sport,
            source: 'relational',
            teamsCount: structuredRelationalTeams.length,
            totalTeams: structuredRelationalTeams.length,
            totalPlayers: structuredRelationalTeams.reduce((acc: number, t: any) => acc + t.playerCount, 0),
            teams: structuredRelationalTeams.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName))
          });
        }
      } catch {
        // Relational query failed or table not migrated yet; fallback to players table
      }
    }

    // 2. Fallback: Query players table and extract structured teams
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
      source: 'players_fallback',
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
