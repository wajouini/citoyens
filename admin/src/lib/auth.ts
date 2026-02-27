import { cookies } from 'next/headers';

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Simple password-based auth.
 * Set ADMIN_PASSWORD in .env to enable auth.
 * If not set, admin is open (useful for local dev).
 */
export function getAdminPassword(): string | null {
  return process.env.ADMIN_PASSWORD ?? null;
}

export function isAuthRequired(): boolean {
  return !!getAdminPassword();
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthRequired()) return true;
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return session?.value === generateSessionToken();
}

export function generateSessionToken(): string {
  // Simple hash of the password as session token
  const password = getAdminPassword();
  if (!password) return '';
  // Use a simple hash — this is admin auth, not a bank
  let hash = 0;
  const str = `citoyens-admin-${password}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `s_${Math.abs(hash).toString(36)}`;
}

export function verifyPassword(password: string): boolean {
  return password === getAdminPassword();
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
