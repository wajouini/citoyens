'use server';

import {
  getUsers,
  createUser,
  updateUserRole,
  toggleUserActive,
  resetUserPassword,
  deleteUser,
  initializeDefaultAdmin,
  type PublicUser,
  type UserRole,
} from '@/lib/users';
import { logAudit } from '@/lib/audit';

export type { PublicUser, UserRole };

export async function loadUsers(): Promise<PublicUser[]> {
  await initializeDefaultAdmin();
  return getUsers();
}

export async function addUser(
  username: string,
  displayName: string,
  password: string,
  role: UserRole,
): Promise<{ success: boolean; error?: string }> {
  const result = await createUser(username, displayName, password, role);
  if (result.success) {
    await logAudit({ action: 'user_create', detail: `${username} (${role})`, result: 'success' });
  }
  return result;
}

export async function changeRole(username: string, role: UserRole): Promise<{ success: boolean; error?: string }> {
  const result = await updateUserRole(username, role);
  if (result.success) {
    await logAudit({ action: 'user_role_change', detail: `${username} → ${role}`, result: 'success' });
  }
  return result;
}

export async function toggleActive(username: string): Promise<{ success: boolean; error?: string }> {
  const result = await toggleUserActive(username);
  if (result.success) {
    await logAudit({ action: 'user_toggle_active', detail: username, result: 'success' });
  }
  return result;
}

export async function resetPassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const result = await resetUserPassword(username, newPassword);
  if (result.success) {
    await logAudit({ action: 'user_reset_password', detail: username, result: 'success' });
  }
  return result;
}

export async function removeUser(username: string): Promise<{ success: boolean; error?: string }> {
  const result = await deleteUser(username);
  if (result.success) {
    await logAudit({ action: 'user_delete', detail: username, result: 'success' });
  }
  return result;
}

export async function loadAuditLog(): Promise<Array<{ timestamp: string; action: string; detail?: string; result?: string }>> {
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const ROOT = process.cwd().replace(/\/admin$/, '');
    const raw = await readFile(join(ROOT, 'src', 'data', '.pipeline', 'audit.json'), 'utf-8');
    const entries = JSON.parse(raw);
    return [...entries].reverse().slice(0, 100);
  } catch {
    return [];
  }
}
