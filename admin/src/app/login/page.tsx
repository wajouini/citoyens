import { LoginClient } from '@/components/LoginClient';
import { isAuthRequired, isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LoginPage() {
  // If no password set, skip login
  if (!isAuthRequired()) {
    redirect('/');
  }

  // If already authenticated, redirect
  if (await isAuthenticated()) {
    redirect('/');
  }

  return <LoginClient />;
}
