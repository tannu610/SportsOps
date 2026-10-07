import { extractMatchCode, generateUniqueMatchCode } from './matchCode';

export interface MatchBackfillResult {
  success: boolean;
  totalMatches: number;
  missingBefore: number;
  backfilledCount: number;
  updatedCount: number;
  message: string;
  details?: Array<{
    id: string;
    sport: string;
    category: string;
    playing_area: string;
    match_code: string;
  }>;
}

/**
 * Safely backfills unique 6-character Match Codes for all matches in Supabase
 * that currently do not have one.
 *
 * Guarantees:
 * - Only modifies records where Match Code is missing.
 * - Existing Match Codes are strictly preserved.
 * - Idempotent: safe to run multiple times with 0 side effects if all codes exist.
 * - Schema-cache safe: updates both native match_code column and score fallback.
 * - Preserves all other match fields (players, status, times, playing area, etc.).
 */
export async function backfillMissingMatchCodes(supabase: any): Promise<MatchBackfillResult> {
  // 1. Fetch all matches safely
  let allMatches: any[] = [];
  const queryWithCode = await supabase
    .from('matches')
    .select('id, sport, category, playing_area, scheduled_time, status, score, match_code');

  if (!queryWithCode.error && queryWithCode.data) {
    allMatches = queryWithCode.data;
  } else {
    // If match_code column is not in PostgREST schema cache, query without it
    const queryWithoutCode = await supabase
      .from('matches')
      .select('id, sport, category, playing_area, scheduled_time, status, score');

    if (queryWithoutCode.error) {
      throw new Error(`Failed to fetch matches for backfill: ${queryWithoutCode.error.message}`);
    }
    allMatches = queryWithoutCode.data || [];
  }

  if (allMatches.length === 0) {
    return {
      success: true,
      totalMatches: 0,
      missingBefore: 0,
      backfilledCount: 0,
      updatedCount: 0,
      message: 'No matches found in database.'
    };
  }

  // 2. Gather all existing Match Codes
  const existingCodes = new Set<string>();
  allMatches.forEach((m: any) => {
    const code = extractMatchCode(m);
    if (code) {
      existingCodes.add(code.toUpperCase());
    }
  });

  // 3. Identify matches missing a Match Code
  const matchesMissingCode = allMatches.filter((m: any) => !extractMatchCode(m));

  if (matchesMissingCode.length === 0) {
    return {
      success: true,
      totalMatches: allMatches.length,
      missingBefore: 0,
      backfilledCount: 0,
      updatedCount: 0,
      message: 'All matches already have unique persistent Match Codes.'
    };
  }

  // 4. Assign codes and persist
  const updatedDetails: Array<{
    id: string;
    sport: string;
    category: string;
    playing_area: string;
    match_code: string;
  }> = [];

  for (const m of matchesMissingCode) {
    const assignedCode = generateUniqueMatchCode(existingCodes);

    // Merge score with existing score data if any
    let updatedScore = JSON.stringify({ match_code: assignedCode });
    if (m.score && typeof m.score === 'string') {
      try {
        const parsed = JSON.parse(m.score);
        updatedScore = JSON.stringify({ ...parsed, match_code: assignedCode });
      } catch {
        // Leave previous score in object
        updatedScore = JSON.stringify({ match_code: assignedCode, raw_score: m.score });
      }
    }

    // Try update with native match_code column
    const { error: updateErr } = await supabase
      .from('matches')
      .update({
        match_code: assignedCode,
        score: updatedScore
      })
      .eq('id', m.id);

    // If native match_code is not in PostgREST schema cache, update score fallback
    if (
      updateErr &&
      (updateErr.code === 'PGRST204' || updateErr.code === '42703' || updateErr.message?.includes('column'))
    ) {
      const { error: fbErr } = await supabase
        .from('matches')
        .update({
          score: updatedScore
        })
        .eq('id', m.id);

      if (fbErr) {
        console.error(`Backfill fallback failed for match ${m.id}:`, fbErr);
        continue;
      }
    } else if (updateErr) {
      console.error(`Backfill failed for match ${m.id}:`, updateErr);
      continue;
    }

    updatedDetails.push({
      id: m.id,
      sport: m.sport,
      category: m.category,
      playing_area: m.playing_area,
      match_code: assignedCode
    });
  }

  return {
    success: true,
    totalMatches: allMatches.length,
    missingBefore: matchesMissingCode.length,
    backfilledCount: updatedDetails.length,
    updatedCount: updatedDetails.length,
    message: `Successfully backfilled Match Codes for ${updatedDetails.length} match(es).`,
    details: updatedDetails
  };
}
