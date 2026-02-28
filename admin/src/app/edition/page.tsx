import { loadEdition, loadEditionHistory, loadEditionMeta, loadEditorialAlerts } from '@/actions/edition';
import { EditionClient } from '@/components/EditionClient';

export const dynamic = 'force-dynamic';

export default async function EditionPage() {
  const [{ une, fileDate }, history, meta, alerts] = await Promise.all([
    loadEdition(),
    loadEditionHistory(),
    loadEditionMeta(),
    loadEditorialAlerts(),
  ]);
  return <EditionClient une={une} fileDate={fileDate} history={history} meta={meta} alerts={alerts} />;
}
