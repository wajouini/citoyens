'use server';

import {
  getNotificationConfig,
  saveNotificationConfig,
  getScheduleConfig,
  saveScheduleConfig,
  sendSlackNotification,
} from '@/lib/notifications';
import type { NotificationConfig, ScheduleConfig } from '@/lib/notification-types';
import { logAudit } from '@/lib/audit';

export async function loadNotificationConfig(): Promise<NotificationConfig> {
  return getNotificationConfig();
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<{ success: boolean; error?: string }> {
  try {
    await saveNotificationConfig(config);
    await logAudit({ action: 'notifications_update', detail: 'Configuration mise à jour', result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function loadScheduleConfig(): Promise<ScheduleConfig> {
  return getScheduleConfig();
}

export async function updateScheduleConfig(config: ScheduleConfig): Promise<{ success: boolean; error?: string }> {
  try {
    await saveScheduleConfig(config);
    await logAudit({ action: 'schedule_update', detail: `${config.enabled ? 'Activé' : 'Désactivé'} — ${config.publishTime}`, result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function testSlackNotification(): Promise<{ success: boolean; error?: string }> {
  try {
    const ok = await sendSlackNotification(
      'Test de notification',
      'Si vous voyez ce message, les notifications Slack fonctionnent.',
    );
    if (!ok) return { success: false, error: 'Webhook URL invalide ou inaccessible' };
    await logAudit({ action: 'slack_test', result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
