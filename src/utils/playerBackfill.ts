import { extractPlayerCode, generateUniquePlayerCode } from './playerCode';

export interface BackfillResult {
  success: boolean;
  totalPlayers: number;
  missingBefore: number;
  backfilledCount: number;
  updatedCount: number;
  message: string;
  details?: Array<{
    id: string;
    employee_id: string;
    name: string;
    player_code: string;
  }>;
}

/**
 * Safely backfills persistent unique Player Codes for all players in Supabase
 * that currently do not have one.
 *
 * Guarantees:
 * - Only modifies records where Player Code is currently missing.
 * - Existing Player Codes are strictly preserved.
 * - Idempotent: safe to run multiple times with 0 side effects if all codes exist.
 * - Schema-cache safe: updates both native player_code and push_subscription._metadata.
 * - Preserves all other attributes (Employee ID, Name, Sport, Category, Status, etc.).
 */
export async function backfillMissingPlayerCodes(supabase: any): Promise<BackfillResult> {
  const { data: allPlayers, error: fetchErr } = await supabase
    .from('players')
    .select('*');

  if (fetchErr) {
    throw new Error(`Failed to fetch players for backfill: ${fetchErr.message}`);
  }

  if (!allPlayers || allPlayers.length === 0) {
    return {
      success: true,
      totalPlayers: 0,
      missingBefore: 0,
      backfilledCount: 0,
      updatedCount: 0,
      message: 'No players found in database.'
    };
  }

  // 1. Gather all existing Player Codes
  const existingCodes = new Set<string>();
  const empToExistingCode = new Map<string, string>();

  allPlayers.forEach((p: any) => {
    const code = extractPlayerCode(p);
    if (code) {
      existingCodes.add(code.toUpperCase());
      const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
      if (cleanEmp && !empToExistingCode.has(cleanEmp)) {
        empToExistingCode.set(cleanEmp, code);
      }
    }
  });

  // 2. Identify players missing a Player Code
  const playersMissingCode = allPlayers.filter((p: any) => !extractPlayerCode(p));

  if (playersMissingCode.length === 0) {
    return {
      success: true,
      totalPlayers: allPlayers.length,
      missingBefore: 0,
      backfilledCount: 0,
      updatedCount: 0,
      message: 'All players already have unique persistent Player Codes.'
    };
  }

  // 3. Assign codes (consistent per employee_id)
  const updatedDetails: Array<{ id: string; employee_id: string; name: string; player_code: string }> = [];

  for (const p of playersMissingCode) {
    const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
    let assignedCode = empToExistingCode.get(cleanEmp);

    if (!assignedCode) {
      assignedCode = generateUniquePlayerCode(existingCodes);
      if (cleanEmp) {
        empToExistingCode.set(cleanEmp, assignedCode);
      }
    }

    const existingMeta = p.push_subscription?._metadata || {};
    const existingSource = (p as any).source || existingMeta.source;
    const updatedMeta = {
      ...existingMeta,
      player_code: assignedCode,
      source: existingSource || 'IMPORT'
    };
    const updatedPush = {
      ...(p.push_subscription || {}),
      _metadata: updatedMeta
    };

    // Attempt update with native player_code column
    const { error: updateErr } = await supabase
      .from('players')
      .update({
        player_code: assignedCode,
        push_subscription: updatedPush
      })
      .eq('id', p.id);

    // Fallback if native player_code column not in PostgREST schema cache
    if (
      updateErr &&
      (updateErr.code === 'PGRST204' || updateErr.code === '42703' || updateErr.message?.includes('column'))
    ) {
      const { error: fbErr } = await supabase
        .from('players')
        .update({
          push_subscription: updatedPush
        })
        .eq('id', p.id);

      if (fbErr) {
        console.error(`Backfill fallback failed for player ${p.id}:`, fbErr);
        continue;
      }
    } else if (updateErr) {
      console.error(`Backfill failed for player ${p.id}:`, updateErr);
      continue;
    }

    updatedDetails.push({
      id: p.id,
      employee_id: p.employee_id,
      name: p.name,
      player_code: assignedCode
    });
  }

  return {
    success: true,
    totalPlayers: allPlayers.length,
    missingBefore: playersMissingCode.length,
    backfilledCount: updatedDetails.length,
    updatedCount: updatedDetails.length,
    message: `Successfully backfilled Player Codes for ${updatedDetails.length} player(s).`,
    details: updatedDetails
  };
}
