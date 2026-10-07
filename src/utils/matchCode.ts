/**
 * Utility functions for generating, validating, and extracting unique SportsOps Match Codes.
 * Format: Exactly 6 uppercase alphanumeric characters (excluding ambiguous characters 0, O, 1, I, 5, S).
 * Example: 'M7K2P4', 'A4N8Q2', 'X7C6R9'
 */

// 30 characters: uppercase letters excluding (I, O, S) and digits excluding (0, 1, 5)
export const MATCH_CODE_CHARS = '2346789ABCDEFGHJKLMNPQRTUVWXYZ';

/**
 * Generates a random 6-character Match Code.
 */
export function generateMatchCode(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * MATCH_CODE_CHARS.length);
    result += MATCH_CODE_CHARS[randomIndex];
  }
  return result;
}

/**
 * Validates that a given code conforms to the 6-character Match Code format.
 * Case-insensitive for user input, but validates 6 alphanumeric characters.
 */
export function isValidMatchCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length !== 6) return false;
  // Match only allowed characters (excluding 0, O, 1, I, 5, S)
  return /^[2346789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/i.test(trimmed);
}

/**
 * Generates a globally unique Match Code that does not collide with any code in existingCodes.
 * Automatically adds the newly chosen code to existingCodes before returning.
 */
export function generateUniqueMatchCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generateMatchCode();
    const upper = candidate.toUpperCase();
    if (!existingCodes.has(upper)) {
      existingCodes.add(upper);
      return candidate;
    }
  }

  // Astronomical fallback: deterministic timestamp-based safe code
  const ts = Date.now().toString(36).toUpperCase().replace(/[^2346789ABCDEFGHJKLMNPQRTUVWXYZ]/g, 'K');
  let fallback = ts.slice(-6).padStart(6, 'M');
  if (existingCodes.has(fallback)) {
    fallback = 'M' + Math.random().toString(36).substring(2, 7).toUpperCase().replace(/[^2346789ABCDEFGHJKLMNPQRTUVWXYZ]/g, 'Q');
  }
  existingCodes.add(fallback.toUpperCase());
  return fallback;
}

/**
 * Extracts a match's persistent Match Code from either the native match_code column
 * or from the fallback persistence metadata in the score field.
 */
export function extractMatchCode(match: any): string | null {
  if (!match) return null;

  // 1. Direct native column check
  const direct = typeof match.match_code === 'string' && match.match_code.trim();
  if (direct && direct !== '-' && direct !== 'PENDING') {
    return direct.trim().toUpperCase();
  }

  // 2. Score field fallback check (JSON payload or 'MC:' prefix)
  if (typeof match.score === 'string' && match.score.trim()) {
    const raw = match.score.trim();
    if (raw.startsWith('MC:')) {
      const codePart = raw.slice(3).trim().toUpperCase();
      if (isValidMatchCode(codePart)) return codePart;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.match_code === 'string' && parsed.match_code.trim()) {
        const code = parsed.match_code.trim().toUpperCase();
        if (isValidMatchCode(code)) return code;
      }
    } catch {
      // Not JSON, check if entire score is exactly a 6-character match code
      if (isValidMatchCode(raw)) return raw.toUpperCase();
    }
  }

  return null;
}

/**
 * Checks whether a given code is unique against a set of existing codes.
 */
export function isMatchCodeUnique(code: string, existingCodes: Set<string>): boolean {
  if (!isValidMatchCode(code)) return false;
  return !existingCodes.has(code.trim().toUpperCase());
}
