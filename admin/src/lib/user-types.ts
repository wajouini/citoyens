/**
 * User types and constants — safe to import from client components.
 * No Node.js dependencies (fs, path, crypto).
 */

export type UserRole = 'admin' | 'editorialiste' | 'lecteur';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
  active: boolean;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  editorialiste: 'Éditorialiste',
  lecteur: 'Lecteur',
};

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['pipeline.run', 'edition.edit', 'edition.publish', 'sources.manage', 'users.manage', 'settings.view'],
  editorialiste: ['edition.edit', 'edition.publish', 'sources.view'],
  lecteur: ['edition.view', 'sources.view'],
};
