import { loadEdition, loadEditionMeta } from '@/actions/edition';
import { PreviewClient } from '@/components/PreviewClient';

export const dynamic = 'force-dynamic';

export default async function PreviewPage() {
  const [{ une }, meta] = await Promise.all([loadEdition(), loadEditionMeta()]);
  return <PreviewClient une={une} meta={meta} />;
}
