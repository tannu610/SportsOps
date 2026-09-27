import crypto from 'crypto';

const TOKEN_SECRET =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.VAPID_PRIVATE_KEY ||
  'sportsops-matchday-secure-token-key-2026';

export interface CheckInTokenPayload {
  playerId: string;
  playerCode: string;
  employeeId: string;
  exp: number; // Unix timestamp in ms
}

/**
 * Generates a signed, tamper-proof check-in token for a newly registered walk-in player.
 * Valid for 30 minutes.
 */
export function generateCheckInToken(playerId: string, playerCode: string, employeeId: string): string {
  const payloadObj: CheckInTokenPayload = {
    playerId,
    playerCode,
    employeeId: employeeId.trim().toUpperCase(),
    exp: Date.now() + 30 * 60 * 1000 // 30 minutes validity window
  };

  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a check-in token and returns its payload if valid and unexpired.
 * Returns null if invalid, tampered with, or expired.
 */
export function verifyCheckInToken(token: string): CheckInTokenPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return null;
  }

  try {
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload: CheckInTokenPayload = JSON.parse(payloadStr);

    if (!payload.playerId || !payload.playerCode || !payload.employeeId || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null; // Token expired
    }

    return payload;
  } catch {
    return null;
  }
}
