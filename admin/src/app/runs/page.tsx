import { getRecentRuns } from '@/actions/pipeline';
import { RunsClient } from '@/components/RunsClient';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const runs = await getRecentRuns();
  return <RunsClient runs={runs} />;
}
