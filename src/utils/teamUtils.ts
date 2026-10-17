import { extractPlayerCode } from './playerCode';

export interface TeamMember {
  id: string; // DB UUID
  employeeId: string;
  playerCode: string;
  name: string;
  contact?: string | null;
  status: string;
  isCaptain?: boolean;
}

export interface TeamGroup {
  teamId?: string;
  teamName: string;
  captainName?: string | null;
  captainPlayerId?: string | null;
  captainPlayerCode?: string | null;
  sport: string;
  category: string;
  playerCount: number;
  players: TeamMember[];
}

/**
 * Extracts a player's team name from direct column or push_subscription._metadata.
 * Never throws, returns null if not assigned to any team.
 */
export function extractPlayerTeam(player: any): string | null {
  if (!player) return null;

  if (typeof player.team_name === 'string' && player.team_name.trim()) {
    return player.team_name.trim();
  }

  if (typeof player.team === 'string' && player.team.trim()) {
    return player.team.trim();
  }

  const meta = player.push_subscription?._metadata;
  if (meta && typeof meta.team_name === 'string' && meta.team_name.trim()) {
    return meta.team_name.trim();
  }

  if (meta && typeof meta.team === 'string' && meta.team.trim()) {
    return meta.team.trim();
  }

  return null;
}

/**
 * Groups players by their team name within an event.
 * Players without a team are excluded.
 */
export function groupPlayersByTeam(players: any[]): Record<string, any[]> {
  const teams: Record<string, any[]> = {};

  (players || []).forEach((p) => {
    const tName = extractPlayerTeam(p);
    if (tName) {
      if (!teams[tName]) teams[tName] = [];
      teams[tName].push(p);
    }
  });

  return teams;
}

/**
 * Converts a list of players into structured TeamGroup objects.
 */
export function getStructuredTeams(players: any[], filterSport?: string): TeamGroup[] {
  const teamsMap = new Map<
    string,
    {
      sport: string;
      category: string;
      captainName?: string | null;
      captainPlayerId?: string | null;
      players: TeamMember[];
    }
  >();

  (players || []).forEach((p) => {
    const tName = extractPlayerTeam(p);
    if (!tName) return;

    if (filterSport && p.sport && p.sport.toLowerCase() !== filterSport.toLowerCase()) {
      return;
    }

    const meta = p.push_subscription?._metadata;
    const isCap = meta?.is_captain === true;

    const member: TeamMember = {
      id: p.id,
      employeeId: p.employee_id,
      playerCode: extractPlayerCode(p) || p.player_code || '-',
      name: p.name,
      contact: p.contact_info,
      status: p.status,
      isCaptain: isCap
    };

    if (!teamsMap.has(tName)) {
      teamsMap.set(tName, {
        sport: p.sport || 'Cricket',
        category: p.category || 'Open Cricket',
        captainName: meta?.captain_name || (isCap ? p.name : null),
        captainPlayerId: isCap ? p.id : null,
        players: []
      });
    } else {
      const existing = teamsMap.get(tName)!;
      if (meta?.captain_name && !existing.captainName) {
        existing.captainName = meta.captain_name;
      }
      if (isCap) {
        existing.captainPlayerId = p.id;
        if (!existing.captainName) existing.captainName = p.name;
      }
    }

    teamsMap.get(tName)!.players.push(member);
  });

  const result: TeamGroup[] = [];
  teamsMap.forEach((val, teamName) => {
    result.push({
      teamName,
      captainName: val.captainName || null,
      captainPlayerId: val.captainPlayerId || null,
      sport: val.sport,
      category: val.category,
      playerCount: val.players.length,
      players: val.players
    });
  });

  return result.sort((a, b) => a.teamName.localeCompare(b.teamName));
}
