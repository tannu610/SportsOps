import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStructuredTeams, extractPlayerTeam } from '@/utils/teamUtils';
import { extractPlayerCode } from '@/utils/playerCode';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const sport = searchParams.get('sport') || 'Cricket';

    const supabase = await createClient();

    // 1. If querying an event, check relational teams table first
    if (eventId) {
      try {
        const { data: dbTeams, error: dbTeamsErr } = await supabase
          .from('teams')
          .select('id, name, sport, category, captain_player_id')
          .eq('event_id', eventId);

        if (!dbTeamsErr && dbTeams && dbTeams.length > 0) {
          // Filter by sport if specified and not 'ALL'
          const filteredTeams = dbTeams.filter((t: any) =>
            !sport || sport === 'ALL' || t.sport?.toLowerCase().includes(sport.toLowerCase())
          );

          if (filteredTeams.length > 0) {
            // Fetch all event players (including REGISTERED) to build rosters
            const { data: eventPlayers } = await supabase
              .from('players')
              .select('id, employee_id, name, contact_info, status, push_subscription, team_id')
              .eq('event_id', eventId);

            const playersList = eventPlayers || [];

            const structuredRelationalTeams = filteredTeams.map((t: any) => {
              // Find captain player
              const capPlayer = playersList.find(
                (p: any) => p.id === t.captain_player_id || p.push_subscription?._metadata?.is_captain === true
              );
              const capCode = capPlayer ? extractPlayerCode(capPlayer) : null;

              // Find roster players linked by team_id or metadata team_name
              const members = playersList
                .filter((p: any) => {
                  if (p.team_id && p.team_id === t.id) return true;
                  const extracted = extractPlayerTeam(p);
                  return extracted && extracted.toLowerCase() === t.name.toLowerCase();
                })
                .map((p: any) => {
                  const isCap = p.id === t.captain_player_id || p.push_subscription?._metadata?.is_captain === true;
                  return {
                    id: p.id,
                    employeeId: p.employee_id,
                    playerCode: extractPlayerCode(p) || '-',
                    name: p.name,
                    isCaptain: isCap,
                    contact: p.contact_info,
                    status: p.status
                  };
                });

              return {
                teamId: t.id,
                teamName: t.name,
                captainName: capPlayer?.name || null,
                captainPlayerId: t.captain_player_id || capPlayer?.id || null,
                captainPlayerCode: capCode,
                sport: t.sport || sport || 'Cricket',
                category: t.category || 'Open Cricket',
                playerCount: members.length,
                players: members
              };
            });

            return NextResponse.json({
              success: true,
              sport,
              source: 'relational_teams',
              teamsCount: structuredRelationalTeams.length,
              totalTeams: structuredRelationalTeams.length,
              totalPlayers: structuredRelationalTeams.reduce((acc: number, t: any) => acc + t.playerCount, 0),
              teams: structuredRelationalTeams.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName))
            });
          }
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
