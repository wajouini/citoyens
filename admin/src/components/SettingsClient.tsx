'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { testLlmConnection } from '@/actions/settings';
import {
  updateNotificationConfig,
  updateScheduleConfig,
  testSlackNotification,
} from '@/actions/notifications';
import type { NotificationConfig, ScheduleConfig } from '@/lib/notification-types';

type SettingsData = { provider: string; model: string; hasAnthropicKey: boolean; hasOpenaiKey: boolean; hasGeminiKey: boolean; hasOpenrouterKey: boolean };

const providers = [
  { id: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-sonnet-4-20250514', keyField: 'hasAnthropicKey' as const },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o', keyField: 'hasOpenaiKey' as const },
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash', keyField: 'hasGeminiKey' as const },
  { id: 'openrouter', label: 'OpenRouter', model: 'anthropic/claude-sonnet-4', keyField: 'hasOpenrouterKey' as const },
];

export function SettingsClient({
  settings,
  notifConfig: initialNotifConfig,
  scheduleConfig: initialScheduleConfig,
}: {
  settings: SettingsData;
  notifConfig: NotificationConfig;
  scheduleConfig: ScheduleConfig;
}) {
  const router = useRouter();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [notif, setNotif] = useState<NotificationConfig>(initialNotifConfig);
  const [schedule, setSchedule] = useState<ScheduleConfig>(initialScheduleConfig);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function showToast(type: 'success' | 'error', text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }

  function handleTestLlm() {
    startTransition(async () => {
      setTestMsg(null);
      const r = await testLlmConnection();
      setTestMsg({ ok: r.success, text: r.success ? (r.response || 'OK') : (r.error || 'Erreur') });
    });
  }

  function handleSaveNotif() {
    startTransition(async () => {
      const result = await updateNotificationConfig(notif);
      if (result.success) showToast('success', 'Notifications mises à jour');
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleTestSlack() {
    startTransition(async () => {
      const result = await testSlackNotification();
      if (result.success) showToast('success', 'Notification Slack envoyée');
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleSaveSchedule() {
    startTransition(async () => {
      const result = await updateScheduleConfig(schedule);
      if (result.success) showToast('success', 'Planning mis à jour');
      else showToast('error', result.error || 'Erreur');
    });
  }

  return (
    <div className="p-8">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 font-mono text-[14px] px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-vert text-white' : 'bg-rouge-doux text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Settings</h1>
        <p className="text-gris-texte text-[14px] mt-1">Configuration du pipeline, notifications et planification</p>
      </div>

      <div className="space-y-6">
        {/* LLM Provider section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
            <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">LLM Provider</h2>
            <div className="space-y-3">
              {providers.map((p) => {
                const active = settings.provider.toLowerCase() === p.id;
                const hasKey = settings[p.keyField];
                return (
                  <div key={p.id} className={`p-3 rounded-lg border ${active ? 'border-bleu-rep bg-bleu-clair/30' : 'border-gris-chaud'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${active ? 'bg-bleu-rep' : 'bg-gris-chaud'}`} />
                      <div className="flex-1">
                        <div className="text-[15px] font-medium text-noir">{p.label}{active && <span className="ml-2 font-mono text-[11px] text-vert font-bold uppercase">actif</span>}</div>
                        <div className="font-mono text-[12px] text-gris-clair">Modele : {active && settings.model ? settings.model : p.model}</div>
                      </div>
                      <div className={`font-mono text-[12px] px-2 py-0.5 rounded ${hasKey ? 'bg-vert/10 text-vert' : 'bg-rouge-doux/10 text-rouge-doux'}`}>{hasKey ? 'Cle OK' : 'Pas de cle'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="font-mono text-[12px] text-gris-clair mt-3">Edite <code className="bg-creme px-1 py-0.5 rounded">LLM_PROVIDER</code> dans .env pour changer</p>
          </div>

          <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
            <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Configuration</h2>
            <div className="space-y-3">
              <Row label="LLM_PROVIDER" value={settings.provider} />
              <Row label="LLM_MODEL" value={settings.model || '(defaut)'} />
              <Row label="ANTHROPIC_API_KEY" value={settings.hasAnthropicKey ? '••••••••' : '—'} ok={settings.hasAnthropicKey} />
              <Row label="OPENAI_API_KEY" value={settings.hasOpenaiKey ? '••••••••' : '—'} ok={settings.hasOpenaiKey} />
              <Row label="GEMINI_API_KEY" value={settings.hasGeminiKey ? '••••••••' : '—'} ok={settings.hasGeminiKey} />
              <Row label="OPENROUTER_API_KEY" value={settings.hasOpenrouterKey ? '••••••••' : '—'} ok={settings.hasOpenrouterKey} />
            </div>
            <button onClick={handleTestLlm} disabled={isPending} className="mt-4 bg-orange text-white font-mono text-[13px] font-bold px-4 py-2 rounded-lg hover:opacity-90 cursor-pointer disabled:opacity-50">
              {isPending ? 'Test en cours...' : `Tester ${settings.provider}`}
            </button>
            {testMsg && (
              <div className={`mt-3 font-mono text-[13px] px-3 py-2 rounded-lg ${testMsg.ok ? 'bg-vert/10 text-vert' : 'bg-rouge-doux/10 text-rouge-doux'}`}>
                {testMsg.ok ? '✓' : '✗'} {testMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* Notifications section */}
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Notifications</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <label className="font-mono text-[11px] text-gris-clair block mb-1">Slack Webhook URL</label>
                <input
                  type="url"
                  value={notif.slackWebhookUrl || ''}
                  onChange={e => setNotif(n => ({ ...n, slackWebhookUrl: e.target.value || null }))}
                  className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:border-bleu-rep"
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>
              <div>
                <label className="font-mono text-[11px] text-gris-clair block mb-1">Email (pour alertes)</label>
                <input
                  type="email"
                  value={notif.emailTo || ''}
                  onChange={e => setNotif(n => ({ ...n, emailTo: e.target.value || null }))}
                  className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep"
                  placeholder="redac@citoyens.ai"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="font-mono text-[11px] text-gris-clair mb-2">Notifier quand :</div>
              <Toggle label="Nouvelle edition prete (draft)" checked={notif.notifyOnDraft} onChange={v => setNotif(n => ({ ...n, notifyOnDraft: v }))} />
              <Toggle label="Edition publiee" checked={notif.notifyOnPublish} onChange={v => setNotif(n => ({ ...n, notifyOnPublish: v }))} />
              <Toggle label="Echec du pipeline" checked={notif.notifyOnFailure} onChange={v => setNotif(n => ({ ...n, notifyOnFailure: v }))} />
              <Toggle label="Modification editoriale" checked={notif.notifyOnEdit} onChange={v => setNotif(n => ({ ...n, notifyOnEdit: v }))} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSaveNotif} disabled={isPending} className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
              {isPending ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
            {notif.slackWebhookUrl && (
              <button onClick={handleTestSlack} disabled={isPending} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-bleu-rep text-bleu-rep hover:bg-bleu-clair cursor-pointer disabled:opacity-50">
                Tester Slack
              </button>
            )}
          </div>
        </div>

        {/* Scheduling section */}
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Publication planifiee</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Toggle label="Activer la publication automatique" checked={schedule.enabled} onChange={v => setSchedule(s => ({ ...s, enabled: v }))} />
              <div>
                <label className="font-mono text-[11px] text-gris-clair block mb-1">Heure de publication</label>
                <input
                  type="time"
                  value={schedule.publishTime}
                  onChange={e => setSchedule(s => ({ ...s, publishTime: e.target.value }))}
                  disabled={!schedule.enabled}
                  className="border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:border-bleu-rep disabled:opacity-50"
                />
              </div>
              <div>
                <label className="font-mono text-[11px] text-gris-clair block mb-1">Fuseau horaire</label>
                <select
                  value={schedule.timezone}
                  onChange={e => setSchedule(s => ({ ...s, timezone: e.target.value }))}
                  disabled={!schedule.enabled}
                  className="border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep disabled:opacity-50"
                >
                  <option value="Europe/Paris">Europe/Paris (CET)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
            <div className="bg-creme rounded-lg p-4">
              <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Fonctionnement</div>
              <ul className="space-y-1.5 text-[13px] text-gris-texte">
                <li>1. Le pipeline genere une edition (cron ou manuel)</li>
                <li>2. L'edition passe en statut &quot;brouillon&quot;</li>
                <li>3. L'editorialiste relit et valide (&quot;Bon a tirer&quot;)</li>
                <li>4. A l'heure planifiee, les editions validees sont publiees</li>
              </ul>
              {schedule.lastScheduledPublish && (
                <div className="mt-3 font-mono text-[12px] text-gris-clair">
                  Derniere publication auto : {new Date(schedule.lastScheduledPublish).toLocaleString('fr-FR')}
                </div>
              )}
              {!schedule.enabled && (
                <div className="mt-3 font-mono text-[12px] text-orange">
                  La publication automatique est desactivee. Les editions doivent etre publiees manuellement.
                </div>
              )}
            </div>
          </div>
          <button onClick={handleSaveSchedule} disabled={isPending} className="mt-4 font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
            {isPending ? 'Sauvegarde...' : 'Enregistrer le planning'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gris-chaud/30 last:border-0">
      <span className="font-mono text-[13px] text-gris-texte">{label}</span>
      <span className={`font-mono text-[13px] ${ok === false ? 'text-gris-clair' : ok === true ? 'text-vert' : 'text-noir'}`}>{value}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-bleu-rep' : 'bg-gris-chaud'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-[14px] text-noir group-hover:text-bleu-rep transition-colors">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
    </label>
  );
}
