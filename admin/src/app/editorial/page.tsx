import { loadEditorialDashboard } from '@/actions/editorial';
import { EditorialDashboardClient } from '@/components/EditorialDashboardClient';

export const dynamic = 'force-dynamic';

export default async function EditorialPage() {
  const data = await loadEditorialDashboard();
  return <EditorialDashboardClient data={data} />;
}
