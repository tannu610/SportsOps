import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractPlayerTeam } from '@/utils/teamUtils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get('matchId');

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Fetch match record with fallback if team1_id/team2_id columns do not exist
    let match: any = null;

    const qWithTeams = await supabase
      .from('matches')
      .select(`
        id, event_id, sport, category, playing_area, scheduled_time, reporting_time, status, score,
        team1_id, team2_id,
        team1_p1:players!fk_t1p1(id, employee_id, name, contact_info, status),
        team1_p2:players!fk_t1p2(id, employee_id, name, contact_info, status),
        team2_p1:players!fk_t2p1(id, employee_id, name, contact_info, status),
        team2_p2:players!fk_t2p2(id, employee_id, name, contact_info, status)
      `)
      .eq('id', matchId)
      .single();

    if (!qWithTeams.error && qWithTeams.data) {
      match = qWithTeams.data;
    } else {
      const qFallback = await supabase
        .from('matches')
        .select(`
          id, event_id, sport, category, playing_area, scheduled_time, reporting_time, status, score,
          team1_p1:players!fk_t1p1(id, employee_id, name, contact_info, status),
          team1_p2:players!fk_t1p2(id, employee_id, name, contact_info, status),
          team2_p1:players!fk_t2p1(id, employee_id, name, contact_info, status),
          team2_p2:players!fk_t2p2(id, employee_id, name, contact_info, status)
        `)
        .eq('id', matchId)
        .single();

      if (qFallback.error || !qFallback.data) {
        return NextResponse.json({ error: 'Match not found: ' + (qFallback.error?.message || 'Invalid ID') }, { status: 404 });
      }
      match = qFallback.data;
    }

    // 2. Fetch responses from match_player_responses table
    const responsesMap = new Map<string, { response: string; respondedAt: string }>();

    try {
      const { data: dbResponses } = await supabase
        .from('match_player_responses')
        .select('player_id, response, responded_at')
        .eq('match_id', matchId);

      if (dbResponses) {
        dbResponses.forEach((r: any) => {
          responsesMap.set(r.player_id, {
            response: r.response,
            respondedAt: r.responded_at
          });
        });
      }
    } catch {}

    // Fallback/augment from score JSON
    let scoreMeta: any = {};
    try {
      if (typeof match.score === 'string' && match.score.startsWith('{')) {
        scoreMeta = JSON.parse(match.score);
      } else if (typeof match.score === 'object' && match.score !== null) {
        scoreMeta = match.score;
      }
    } catch {}

    if (scoreMeta.player_responses) {
      Object.entries(scoreMeta.player_responses).forEach(([pid, val]: [string, any]) => {
        if (!responsesMap.has(pid)) {
          responsesMap.set(pid, {
            response: val.response,
            respondedAt: val.responded_at
          });
        }
      });
    }

    const isCricket = Boolean(
      match.sport?.toLowerCase().includes('cricket') ||
      scoreMeta.is_team_match ||
      (scoreMeta.team1_name && scoreMeta.team2_name)
    );

    // 3. For Cricket, construct team player rosters
    if (isCricket) {
      const team1Name = scoreMeta.team1_name || 'Team 1';
      const team2Name = scoreMeta.team2_name || 'Team 2';

      // Fetch all event players with fallback if team_id column does not exist
      let pList: any[] = [];
      const qPlayersWithTeam = await supabase
        .from('players')
        .select('id, employee_id, name, status, push_subscription, team_id')
        .eq('event_id', match.event_id);

      if (!qPlayersWithTeam.error && qPlayersWithTeam.data) {
        pList = qPlayersWithTeam.data;
      } else {
        const qPlayersFallback = await supabase
          .from('players')
          .select('id, employee_id, name, status, push_subscription')
          .eq('event_id', match.event_id);
        pList = qPlayersFallback.data || [];
      }

      // Partition into Team 1 and Team 2
      const team1Players = pList.filter((p: any) => {
        if (scoreMeta.team1_id && p.team_id === scoreMeta.team1_id) return true;
        if (scoreMeta.team1_player_ids?.includes(p.id)) return true;
        const t = extractPlayerTeam(p);
        return t && t.toLowerCase() === team1Name.toLowerCase();
      });

      const team2Players = pList.filter((p: any) => {
        if (scoreMeta.team2_id && p.team_id === scoreMeta.team2_id) return true;
        if (scoreMeta.team2_player_ids?.includes(p.id)) return true;
        const t = extractPlayerTeam(p);
        return t && t.toLowerCase() === team2Name.toLowerCase();
      });

      const mapMember = (p: any, teamCaptainId?: string | null) => {
        const resp = responsesMap.get(p.id);
        const isCap = p.id === teamCaptainId || p.push_subscription?._metadata?.is_captain === true;
        return {
          id: p.id,
          employeeId: p.employee_id,
          name: p.name,
          isCaptain: isCap,
          status: p.status,
          response: resp ? resp.response : 'NO_RESPONSE',
          respondedAt: resp ? resp.respondedAt : null
        };
      };

      const t1Captain = team1Players.find((p: any) => p.push_subscription?._metadata?.is_captain === true) || team1Players[0];
      const t2Captain = team2Players.find((p: any) => p.push_subscription?._metadata?.is_captain === true) || team2Players[0];

      const mappedT1 = team1Players.map((p: any) => mapMember(p, t1Captain?.id));
      const mappedT2 = team2Players.map((p: any) => mapMember(p, t2Captain?.id));

      const countT1Coming = mappedT1.filter((p: any) => p.response === 'COMING').length;
      const countT1NotComing = mappedT1.filter((p: any) => p.response === 'NOT_COMING').length;
      const countT1NoResponse = mappedT1.filter((p: any) => p.response === 'NO_RESPONSE').length;

      const countT2Coming = mappedT2.filter((p: any) => p.response === 'COMING').length;
      const countT2NotComing = mappedT2.filter((p: any) => p.response === 'NOT_COMING').length;
      const countT2NoResponse = mappedT2.filter((p: any) => p.response === 'NO_RESPONSE').length;

      const totalComing = countT1Coming + countT2Coming;
      const totalNotComing = countT1NotComing + countT2NotComing;
      const totalNoResponse = countT1NoResponse + countT2NoResponse;
      const totalPlayers = mappedT1.length + mappedT2.length;

      return NextResponse.json({
        success: true,
        matchId,
        sport: 'Cricket',
        isTeamMatch: true,
        summary: {
          coming: totalComing,
          notComing: totalNotComing,
          noResponse: totalNoResponse,
          totalPlayers
        },
        teams: {
          team1: {
            teamName: team1Name,
            captainName: t1Captain?.name || null,
            captainPlayerId: t1Captain?.id || null,
            counts: {
              coming: countT1Coming,
              notComing: countT1NotComing,
              noResponse: countT1NoResponse,
              total: mappedT1.length
            },
            players: mappedT1
          },
          team2: {
            teamName: team2Name,
            captainName: t2Captain?.name || null,
            captainPlayerId: t2Captain?.id || null,
            counts: {
              coming: countT2Coming,
              notComing: countT2NotComing,
              noResponse: countT2NoResponse,
              total: mappedT2.length
            },
            players: mappedT2
          }
        },
        teamsList: [
          {
            name: team1Name,
            captainName: t1Captain?.name || null,
            captainPlayerId: t1Captain?.id || null,
            counts: {
              coming: countT1Coming,
              notComing: countT1NotComing,
              noResponse: countT1NoResponse,
              total: mappedT1.length
            },
            players: mappedT1
          },
          {
            name: team2Name,
            captainName: t2Captain?.name || null,
            captainPlayerId: t2Captain?.id || null,
            counts: {
              coming: countT2Coming,
              notComing: countT2NotComing,
              noResponse: countT2NoResponse,
              total: mappedT2.length
            },
            players: mappedT2
          }
        ]
      });
    }

    // 4. For Badminton / individual matches
    const bTeam1Players = [match.team1_p1, match.team1_p2].filter(Boolean);
    const bTeam2Players = [match.team2_p1, match.team2_p2].filter(Boolean);

    const mapBadminton = (p: any) => {
      const resp = responsesMap.get(p.id);
      return {
        id: p.id,
        employeeId: p.employee_id,
        name: p.name,
        isCaptain: false,
        status: p.status,
        response: resp ? resp.response : 'NO_RESPONSE',
        respondedAt: resp ? resp.respondedAt : null
      };
    };

    const bT1Mapped = bTeam1Players.map(mapBadminton);
    const bT2Mapped = bTeam2Players.map(mapBadminton);
    const allB = [...bT1Mapped, ...bT2Mapped];

    return NextResponse.json({
      success: true,
      matchId,
      sport: match.sport || 'Badminton',
      isTeamMatch: false,
      summary: {
        coming: allB.filter((p) => p.response === 'COMING').length,
        notComing: allB.filter((p) => p.response === 'NOT_COMING').length,
        noResponse: allB.filter((p) => p.response === 'NO_RESPONSE').length,
        totalPlayers: allB.length
      },
      teams: {
        team1: {
          teamName: 'Team 1',
          players: bT1Mapped
        },
        team2: {
          teamName: 'Team 2',
          players: bT2Mapped
        }
      },
      teamsList: [
        {
          name: 'Team 1',
          players: bT1Mapped
        },
        {
          name: 'Team 2',
          players: bT2Mapped
        }
      ]
    });
  } catch (err: any) {
    console.error('Error fetching match responses:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
