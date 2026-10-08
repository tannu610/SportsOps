import { isValidMatchCode, extractMatchCode } from './matchCode';

export interface RefereeMatchSummary {
  id: string;
  match_code: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  scheduled_time: string;
  reporting_time?: string | null;
  status: string;
  team1: Array<{ id: string; name: string }>;
  team2: Array<{ id: string; name: string }>;
  winner_id: string | null;
  winner_name: string | null;
  winning_team: 'team1' | 'team2' | null;
  score_notes: string | null;
  referee_name: string | null;
  completed_at: string | null;
}

/**
 * Parses match score metadata from the database score column.
 */
export function parseMatchScoreMetadata(rawScore: any): {
  score: string | null;
  referee_name: string | null;
  winner_name: string | null;
  winner_id: string | null;
  winning_team: 'team1' | 'team2' | null;
  completed_at: string | null;
} {
  const result: {
    score: string | null;
    referee_name: string | null;
    winner_name: string | null;
    winner_id: string | null;
    winning_team: 'team1' | 'team2' | null;
    completed_at: string | null;
  } = {
    score: null,
    referee_name: null,
    winner_name: null,
    winner_id: null,
    winning_team: null,
    completed_at: null,
  };

  if (!rawScore || typeof rawScore !== 'string') {
    return result;
  }

  const trimmed = rawScore.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        result.score = typeof parsed.score === 'string' ? parsed.score : null;
        result.referee_name = typeof parsed.referee_name === 'string' ? parsed.referee_name : null;
        result.winner_name = typeof parsed.winner_name === 'string' ? parsed.winner_name : null;
        result.winner_id = typeof parsed.winner_id === 'string' ? parsed.winner_id : null;
        result.winning_team = parsed.winning_team === 'team1' || parsed.winning_team === 'team2' ? parsed.winning_team : null;
        result.completed_at = typeof parsed.completed_at === 'string' ? parsed.completed_at : null;
      }
    } catch {
      result.score = trimmed;
    }
  } else if (!trimmed.startsWith('MC:')) {
    result.score = trimmed;
  }

  return result;
}

/**
 * Merges updates into the match score metadata JSON string.
 * Always ensures match_code is preserved.
 */
export function serializeMatchScoreMetadata(
  existingScore: any,
  matchCode: string,
  updates: Partial<{
    score: string | null;
    referee_name: string | null;
    winner_name: string | null;
    winner_id: string | null;
    winning_team: 'team1' | 'team2' | null;
    completed_at: string | null;
    status: string;
  }>
): string {
  let existingMeta: Record<string, any> = {};

  if (existingScore && typeof existingScore === 'string' && existingScore.trim().startsWith('{')) {
    try {
      existingMeta = JSON.parse(existingScore.trim());
    } catch {}
  }

  const merged: Record<string, any> = {
    ...existingMeta,
    match_code: matchCode,
    ...updates,
  };

  // Clean undefined
  Object.keys(merged).forEach((k) => {
    if (merged[k] === undefined) delete merged[k];
  });

  return JSON.stringify(merged);
}

/**
 * Finds a match in Supabase by its 6-character Match Code.
 */
export async function findMatchByMatchCode(supabase: any, code: string): Promise<any | null> {
  if (!code || typeof code !== 'string') return null;
  const cleanCode = code.trim().toUpperCase();
  if (!isValidMatchCode(cleanCode)) return null;

  const selectFields = `
    id, sport, category, phase, playing_area, scheduled_time, reporting_time, status, score, winner_id,
    team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id,
    team1_p1:players!fk_t1p1(id, name),
    team1_p2:players!fk_t1p2(id, name),
    team2_p1:players!fk_t2p1(id, name),
    team2_p2:players!fk_t2p2(id, name),
    winner:players!winner_id(id, name)
  `;

  // 1. Try querying with match_code column if exposed in schema cache
  try {
    const { data: m1, error: err1 } = await supabase
      .from('matches')
      .select(`match_code, ${selectFields}`)
      .eq('match_code', cleanCode)
      .maybeSingle();

    if (!err1 && m1) {
      return {
        ...m1,
        match_code: cleanCode,
      };
    }
  } catch {}

  // 2. Query fallback using score matching
  try {
    const { data: fallbackMatches, error: err2 } = await supabase
      .from('matches')
      .select(selectFields)
      .ilike('score', `%${cleanCode}%`);

    if (!err2 && fallbackMatches && fallbackMatches.length > 0) {
      const matched = fallbackMatches.find((m: any) => extractMatchCode(m) === cleanCode);
      if (matched) {
        return {
          ...matched,
          match_code: cleanCode,
        };
      }
    }
  } catch {}

  // 3. Fallback scan of recent matches
  try {
    const { data: recentMatches } = await supabase
      .from('matches')
      .select(selectFields)
      .order('created_at', { ascending: false })
      .limit(60);

    if (recentMatches) {
      const matched = recentMatches.find((m: any) => extractMatchCode(m) === cleanCode);
      if (matched) {
        return {
          ...matched,
          match_code: cleanCode,
        };
      }
    }
  } catch {}

  return null;
}

/**
 * Sanitizes and formats a match record for the Referee Portal.
 * Strips internal employee IDs, player codes, and private details.
 */
export function sanitizeMatchForReferee(
  match: any,
  activeRefereeName?: string | null
): RefereeMatchSummary {
  const meta = parseMatchScoreMetadata(match.score);
  const matchCode = extractMatchCode(match) || match.match_code || '';

  const team1: Array<{ id: string; name: string }> = [];
  if (match.team1_p1?.name) team1.push({ id: match.team1_p1.id, name: match.team1_p1.name });
  if (match.team1_p2?.name) team1.push({ id: match.team1_p2.id, name: match.team1_p2.name });

  const team2: Array<{ id: string; name: string }> = [];
  if (match.team2_p1?.name) team2.push({ id: match.team2_p1.id, name: match.team2_p1.name });
  if (match.team2_p2?.name) team2.push({ id: match.team2_p2.id, name: match.team2_p2.name });

  let winnerName: string | null = meta.winner_name || null;
  if (!winnerName && match.winner?.name) {
    winnerName = match.winner.name;
  }
  if (!winnerName && match.winner_id) {
    const allP = [...team1, ...team2];
    const found = allP.find((p) => p.id === match.winner_id);
    if (found) winnerName = found.name;
  }

  const refereeName = activeRefereeName || meta.referee_name || null;

  return {
    id: match.id,
    match_code: matchCode,
    sport: match.sport || 'Badminton',
    category: match.category || 'NA',
    phase: match.phase || 'Round 1',
    playing_area: match.playing_area || 'Court 1',
    scheduled_time: match.scheduled_time,
    reporting_time: match.reporting_time || null,
    status: match.status || 'SCHEDULED',
    team1,
    team2,
    winner_id: match.winner_id || meta.winner_id || null,
    winner_name: winnerName,
    winning_team: meta.winning_team || null,
    score_notes: meta.score,
    referee_name: refereeName,
    completed_at: meta.completed_at || null,
  };
}
