'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyPassword,
  generateSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function loginAction(password: string): Promise<{ success: boolean; error?: string }> {
  if (!verifyPassword(password)) {
    await logAudit({ action: 'login', result: 'failed' });
    return { success: false, error: 'Mot de passe incorrect' };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, generateSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });

  await logAudit({ action: 'login', result: 'success' });
  redirect('/');
}

export async function logoutAction() {
  await logAudit({ action: 'logout', result: 'success' });
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
