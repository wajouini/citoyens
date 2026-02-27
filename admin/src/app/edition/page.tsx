import { loadEdition, loadEditionHistory } from '@/actions/edition';
import { EditionClient } from '@/components/EditionClient';

export const dynamic = 'force-dynamic';

export default async function EditionPage() {
  const { une, fileDate } = await loadEdition();
  const history = await loadEditionHistory();
  return <EditionClient une={une} fileDate={fileDate} history={history} />;
}
