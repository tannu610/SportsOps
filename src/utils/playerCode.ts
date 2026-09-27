/**
 * Utility functions for generating and validating unique SportsOps Player Codes.
 * Format: 'SO-' followed by 6 alphanumeric characters (excluding ambiguous characters 0, 1, I, O).
 * Example: 'SO-7K92PX'
 */

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generatePlayerCode(): string {
  let result = 'SO-';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * CODE_CHARS.length);
    result += CODE_CHARS[randomIndex];
  }
  return result;
}

export function isValidPlayerCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  return /^SO-[2-9A-HJ-NP-Z]{6}$/i.test(code.trim());
}

/**
 * Generates a unique player code that does not collide with any code in existingCodes.
 * Adds the new code to existingCodes before returning.
 */
export function generateUniquePlayerCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generatePlayerCode();
    const upper = candidate.toUpperCase();
    if (!existingCodes.has(upper)) {
      existingCodes.add(upper);
      return candidate;
    }
  }
  // Astronomical fallback
  const fallback = `SO-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  existingCodes.add(fallback.toUpperCase());
  return fallback;
}

/**
 * Standard extractor to read a player's persistent Player Code from either
 * the native column or push_subscription metadata.
 */
export function extractPlayerCode(player: any): string | null {
  if (!player) return null;
  const direct = typeof player.player_code === 'string' && player.player_code.trim();
  if (direct && direct !== '-' && direct !== 'PENDING') {
    return direct.trim().toUpperCase();
  }
  const meta = player.push_subscription?._metadata?.player_code;
  if (typeof meta === 'string' && meta.trim() && meta !== '-' && meta !== 'PENDING') {
    return meta.trim().toUpperCase();
  }
  return null;
}
