/**
 * Notification types — safe to import from client components.
 * No Node.js dependencies.
 */

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
