import { getSettingsData } from '@/actions/settings';
import { SettingsClient } from '@/components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettingsData();
  return <SettingsClient settings={settings} />;
}
