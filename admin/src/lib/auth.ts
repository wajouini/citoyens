import { cookies } from 'next/headers';
import { createHash, timingSafeEqual, randomBytes } from 'crypto';

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Rate limiting: track failed login attempts
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

export function getAdminPassword(): string | null {
  return process.env.ADMIN_PASSWORD ?? null;
}

export function isAuthRequired(): boolean {
  return !!getAdminPassword();
}

/**
 * Generate a session token using SHA-256.
 * Uses Node crypto (server-side only). The middleware uses Web Crypto
 * with the same algorithm to produce an identical output.
 */
export function generateSessionToken(): string {
  const password = getAdminPassword();
  if (!password) return '';
  const salt = process.env.SESSION_SALT || 'citoyens-admin-default-salt';
  return createHash('sha256').update(`${salt}:${password}`).digest('hex').slice(0, 48);
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthRequired()) return true;
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value) return false;

  const expected = generateSessionToken();
  if (session.value.length !== expected.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(session.value, 'utf-8'),
      Buffer.from(expected, 'utf-8'),
    );
  } catch {
    return false;
  }
}

export function verifyPassword(password: string): boolean {
  const expected = getAdminPassword();
  if (!expected) return false;
  if (password.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(password, 'utf-8'),
      Buffer.from(expected, 'utf-8'),
    );
  } catch {
    return false;
  }
}

/**
 * Check if an IP has exceeded the rate limit for login attempts.
 * Returns { allowed: boolean, retryAfterSeconds: number }
 */
export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry) return { allowed: true, retryAfterSeconds: 0 };

  if (now - entry.lastAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(ip);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const remaining = Math.ceil((LOCKOUT_DURATION - (now - entry.lastAttempt)) / 1000);
    return { allowed: false, retryAfterSeconds: remaining };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now - entry.lastAttempt < LOCKOUT_DURATION) {
    loginAttempts.set(ip, { count: entry.count + 1, lastAttempt: now });
  } else {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
  }
}

/**
 * Generate a CSRF token for the current session.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
