import { loadUsers, loadAuditLog } from '@/actions/users';
import { UsersClient } from '@/components/UsersClient';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const [users, auditLog] = await Promise.all([loadUsers(), loadAuditLog()]);
  return <UsersClient users={users} auditLog={auditLog} />;
}
