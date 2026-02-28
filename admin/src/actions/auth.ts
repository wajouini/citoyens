'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyPassword,
  generateSessionToken,
  checkRateLimit,
  recordLoginAttempt,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function loginAction(password: string): Promise<{ success: boolean; error?: string }> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for') || headerStore.get('x-real-ip') || 'unknown';

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    await logAudit({ action: 'login', detail: `Rate limited: ${ip}`, result: 'failed' });
    return {
      success: false,
      error: `Trop de tentatives. Réessayez dans ${Math.ceil(rateCheck.retryAfterSeconds / 60)} minute${rateCheck.retryAfterSeconds > 60 ? 's' : ''}.`,
    };
  }

  if (!verifyPassword(password)) {
    recordLoginAttempt(ip, false);
    await logAudit({ action: 'login', detail: `Failed from ${ip}`, result: 'failed' });
    return { success: false, error: 'Mot de passe incorrect' };
  }

  recordLoginAttempt(ip, true);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, generateSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });

  await logAudit({ action: 'login', detail: `Success from ${ip}`, result: 'success' });
  redirect('/');
}

export async function logoutAction() {
  await logAudit({ action: 'logout', result: 'success' });
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
