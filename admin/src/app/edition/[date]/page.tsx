import { loadEdition, loadEditionHistory } from '@/actions/edition';
import { EditionClient } from '@/components/EditionClient';

export const dynamic = 'force-dynamic';

export default async function EditionDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const { une } = await loadEdition(date);
  const history = await loadEditionHistory();
  return <EditionClient une={une} fileDate={null} history={history} selectedDate={date} />;
}
