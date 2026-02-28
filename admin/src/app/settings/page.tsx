import { getSettingsData } from '@/actions/settings';
import { loadNotificationConfig, loadScheduleConfig } from '@/actions/notifications';
import { SettingsClient } from '@/components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [settings, notifConfig, scheduleConfig] = await Promise.all([
    getSettingsData(),
    loadNotificationConfig(),
    loadScheduleConfig(),
  ]);
  return <SettingsClient settings={settings} notifConfig={notifConfig} scheduleConfig={scheduleConfig} />;
}
