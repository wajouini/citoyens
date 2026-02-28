import { loadEditionHistory } from '@/actions/edition';
import { loadAllEditions } from '@/actions/edition-history';
import { EditionHistoryClient } from '@/components/EditionHistoryClient';

export const dynamic = 'force-dynamic';

export default async function EditionHistoryPage() {
  const [history, editions] = await Promise.all([
    loadEditionHistory(),
    loadAllEditions(),
  ]);
  return <EditionHistoryClient history={history} editions={editions} />;
}
