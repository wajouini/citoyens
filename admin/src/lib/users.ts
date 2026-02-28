import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

// Re-export types from the browser-safe module so existing server-side imports still work
export type { UserRole, User, PublicUser } from './user-types';
export { ROLE_LABELS, ROLE_PERMISSIONS } from './user-types';
import type { UserRole, User, PublicUser } from './user-types';

const ROOT = process.cwd().replace(/\/admin$/, '');
const USERS_PATH = join(ROOT, 'src', 'data', '.pipeline', 'users.json');

function hashPassword(password: string): string {
  const salt = 'citoyens-user-v1';
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

async function loadUsers(): Promise<User[]> {
  try {
    const raw = await readFile(USERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveUsers(users: User[]): Promise<void> {
  await mkdir(join(ROOT, 'src', 'data', '.pipeline'), { recursive: true });
  await writeFile(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

export async function getUsers(): Promise<PublicUser[]> {
  const users = await loadUsers();
  return users.map(({ passwordHash, ...rest }) => rest);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await loadUsers();
  return users.find(u => u.username === username) || null;
}

export async function verifyUserPassword(username: string, password: string): Promise<User | null> {
  const user = await getUserByUsername(username);
  if (!user || !user.active) return null;
  if (user.passwordHash !== hashPassword(password)) return null;
  return user;
}

export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: UserRole = 'lecteur',
): Promise<{ success: boolean; error?: string }> {
  const users = await loadUsers();
  if (users.some(u => u.username === username)) {
    return { success: false, error: 'Ce nom d\'utilisateur existe déjà' };
  }

  const newUser: User = {
    id: randomBytes(8).toString('hex'),
    username,
    displayName,
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    active: true,
  };

  users.push(newUser);
  await saveUsers(users);
  return { success: true };
}

export async function updateUserRole(username: string, role: UserRole): Promise<{ success: boolean; error?: string }> {
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return { success: false, error: 'Utilisateur introuvable' };
  user.role = role;
  await saveUsers(users);
  return { success: true };
}

export async function toggleUserActive(username: string): Promise<{ success: boolean; error?: string }> {
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return { success: false, error: 'Utilisateur introuvable' };
  user.active = !user.active;
  await saveUsers(users);
  return { success: true };
}

export async function resetUserPassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return { success: false, error: 'Utilisateur introuvable' };
  user.passwordHash = hashPassword(newPassword);
  await saveUsers(users);
  return { success: true };
}

export async function recordUserLogin(username: string): Promise<void> {
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (user) {
    user.lastLoginAt = new Date().toISOString();
    await saveUsers(users);
  }
}

export async function deleteUser(username: string): Promise<{ success: boolean; error?: string }> {
  const users = await loadUsers();
  const filtered = users.filter(u => u.username !== username);
  if (filtered.length === users.length) return { success: false, error: 'Utilisateur introuvable' };
  await saveUsers(filtered);
  return { success: true };
}

export async function initializeDefaultAdmin(): Promise<void> {
  const users = await loadUsers();
  if (users.length > 0) return;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  await createUser('admin', 'Administrateur', adminPassword, 'admin');
}

// ROLE_LABELS and ROLE_PERMISSIONS are re-exported from ./user-types above
