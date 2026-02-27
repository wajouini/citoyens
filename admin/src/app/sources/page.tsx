import { loadFeeds } from '@/actions/sources';
import { SourcesClient } from '@/components/SourcesClient';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const feeds = await loadFeeds();
  return <SourcesClient feeds={feeds} />;
}
