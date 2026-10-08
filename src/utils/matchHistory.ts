import { extractMatchCode } from './matchCode';
import { parseMatchScoreMetadata } from './refereeMatch';

export interface MatchHistoryPlayer {
  id: string;
  name: string;
}

export interface MatchHistoryEntry {
  id: string;
  match_code: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  scheduled_time: string;
  reporting_time?: string | null;
  status: 'COMPLETED';
  team1: MatchHistoryPlayer[];
  team2: MatchHistoryPlayer[];
  team1_names: string;
  team2_names: string;
  players_display: string;
  referee_name: string;
  winner_id: string | null;
  winner_name: string;
  score_notes: string | null;
  completed_at: string;
}

/**
 * Validates whether a match is eligible for Match History.
 * Must be COMPLETED AND have a valid referee result (referee_name + winner).
 * Scheduled, LIVE, cancelled, deleted, or completed matches without referee results are excluded.
 */
export function isValidRefereeMatchHistory(match: any): boolean {
  if (!match || typeof match !== 'object') return false;
  if (match.status !== 'COMPLETED') return false;

  const meta = parseMatchScoreMetadata(match.score);
  const refereeName = meta.referee_name ? meta.referee_name.trim() : null;
  if (!refereeName) return false;

  // Must have a valid winner declared
  const hasWinner = Boolean(
    (meta.winner_name && meta.winner_name.trim()) ||
    meta.winner_id ||
    match.winner_id ||
    match.winner?.name
  );
  if (!hasWinner) return false;

  return true;
}

/**
 * Formats a raw Supabase match record into a clean MatchHistoryEntry.
 * Strips sensitive internal UUIDs, employee IDs, and player codes.
 */
export function formatMatchHistoryEntry(match: any): MatchHistoryEntry | null {
  if (!isValidRefereeMatchHistory(match)) return null;

  const meta = parseMatchScoreMetadata(match.score);
  const code = extractMatchCode(match) || match.match_code || '';

  const team1: MatchHistoryPlayer[] = [];
  if (match.team1_p1?.name) team1.push({ id: match.team1_p1.id, name: match.team1_p1.name });
  if (match.team1_p2?.name) team1.push({ id: match.team1_p2.id, name: match.team1_p2.name });

  const team2: MatchHistoryPlayer[] = [];
  if (match.team2_p1?.name) team2.push({ id: match.team2_p1.id, name: match.team2_p1.name });
  if (match.team2_p2?.name) team2.push({ id: match.team2_p2.id, name: match.team2_p2.name });

  const team1Names = team1.map((p) => p.name).join(' & ') || 'Team 1';
  const team2Names = team2.map((p) => p.name).join(' & ') || 'Team 2';
  const playersDisplay = `${team1Names} vs ${team2Names}`;

  let winnerName = meta.winner_name || (match.winner?.name ? match.winner.name : null);
  if (!winnerName) {
    if (meta.winning_team === 'team1') winnerName = team1Names;
    else if (meta.winning_team === 'team2') winnerName = team2Names;
    else if (match.winner_id) {
      const found = [...team1, ...team2].find((p) => p.id === match.winner_id);
      if (found) winnerName = found.name;
    }
  }

  const completedAt = meta.completed_at || match.created_at || new Date().toISOString();

  return {
    id: match.id,
    match_code: code,
    sport: match.sport || 'Badminton',
    category: match.category || 'NA',
    phase: match.phase || 'Round 1',
    playing_area: match.playing_area || 'Court 1',
    scheduled_time: match.scheduled_time,
    reporting_time: match.reporting_time || null,
    status: 'COMPLETED',
    team1,
    team2,
    team1_names: team1Names,
    team2_names: team2Names,
    players_display: playersDisplay,
    referee_name: meta.referee_name!.trim(),
    winner_id: match.winner_id || meta.winner_id || null,
    winner_name: winnerName || 'Winner declared',
    score_notes: meta.score || null,
    completed_at: completedAt,
  };
}
