import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd().replace(/\/admin$/, '');
const PIPELINE = join(ROOT, 'src', 'data', '.pipeline');
const NOTIF_CONFIG_PATH = join(PIPELINE, 'notifications.json');
const SCHEDULE_PATH = join(PIPELINE, 'schedule.json');

export interface NotificationConfig {
  slackWebhookUrl: string | null;
  emailTo: string | null;
  notifyOnDraft: boolean;
  notifyOnPublish: boolean;
  notifyOnFailure: boolean;
  notifyOnEdit: boolean;
}

export interface ScheduleConfig {
  enabled: boolean;
  publishTime: string; // HH:MM format
  timezone: string;
  lastScheduledPublish: string | null;
}

const DEFAULT_NOTIF_CONFIG: NotificationConfig = {
  slackWebhookUrl: null,
  emailTo: null,
  notifyOnDraft: true,
  notifyOnPublish: true,
  notifyOnFailure: true,
  notifyOnEdit: false,
};

const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: false,
  publishTime: '08:00',
  timezone: 'Europe/Paris',
  lastScheduledPublish: null,
};

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(path: string, data: any): Promise<void> {
  await mkdir(PIPELINE, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  return readJSON(NOTIF_CONFIG_PATH, DEFAULT_NOTIF_CONFIG);
}

export async function saveNotificationConfig(config: NotificationConfig): Promise<void> {
  await writeJSON(NOTIF_CONFIG_PATH, config);
}

export async function getScheduleConfig(): Promise<ScheduleConfig> {
  return readJSON(SCHEDULE_PATH, DEFAULT_SCHEDULE);
}

export async function saveScheduleConfig(config: ScheduleConfig): Promise<void> {
  await writeJSON(SCHEDULE_PATH, config);
}

export async function sendSlackNotification(message: string, details?: string): Promise<boolean> {
  const config = await getNotificationConfig();
  if (!config.slackWebhookUrl) return false;

  try {
    const payload = {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Citoyens.ai*\n${message}` } },
        ...(details ? [{ type: 'section', text: { type: 'mrkdwn', text: details } }] : []),
      ],
    };

    const resp = await fetch(config.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function notifyEditionReady(titre: string, date: string): Promise<void> {
  const config = await getNotificationConfig();
  if (!config.notifyOnDraft) return;
  await sendSlackNotification(
    `Nouvelle édition prête à relire`,
    `*${titre}*\nDate : ${date}\nConnectez-vous à l'admin pour relire et publier.`,
  );
}

export async function notifyEditionPublished(titre: string, date: string): Promise<void> {
  const config = await getNotificationConfig();
  if (!config.notifyOnPublish) return;
  await sendSlackNotification(
    `Edition publiée`,
    `*${titre}* (${date}) a été publiée.`,
  );
}

export async function notifyPipelineFailure(action: string, error: string): Promise<void> {
  const config = await getNotificationConfig();
  if (!config.notifyOnFailure) return;
  await sendSlackNotification(
    `Pipeline en erreur`,
    `Action : ${action}\nErreur : ${error}`,
  );
}
