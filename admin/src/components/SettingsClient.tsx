'use client';

import { useState, useTransition } from 'react';
import { testLlmConnection } from '@/actions/settings';

type SettingsData = { provider: string; model: string; hasAnthropicKey: boolean; hasOpenaiKey: boolean; hasGeminiKey: boolean; hasOpenrouterKey: boolean };

const providers = [
  { id: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-sonnet-4-20250514', keyField: 'hasAnthropicKey' as const },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o', keyField: 'hasOpenaiKey' as const },
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash', keyField: 'hasGeminiKey' as const },
  { id: 'openrouter', label: 'OpenRouter', model: 'anthropic/claude-sonnet-4', keyField: 'hasOpenrouterKey' as const },
];

export function SettingsClient({ settings }: { settings: SettingsData }) {
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleTest() {
    startTransition(async () => {
      setTestMsg(null);
      const r = await testLlmConnection();
      setTestMsg({ ok: r.success, text: r.success ? (r.response || 'OK') : (r.error || 'Erreur') });
    });
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Settings</h1>
        <p className="text-gris-texte text-[16px] mt-1">Config lue depuis <code className="bg-creme px-1 py-0.5 rounded font-mono text-[13px]">.env</code> / <code className="bg-creme px-1 py-0.5 rounded font-mono text-[13px]">admin/.env.local</code></p>
      </div>

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
                      <div className="font-mono text-[12px] text-gris-clair">Modèle : {active && settings.model ? settings.model : p.model}</div>
                    </div>
                    <div className={`font-mono text-[12px] px-2 py-0.5 rounded ${hasKey ? 'bg-vert/10 text-vert' : 'bg-rouge-doux/10 text-rouge-doux'}`}>{hasKey ? 'Clé OK' : 'Pas de clé'}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="font-mono text-[12px] text-gris-clair mt-3">Édite <code className="bg-creme px-1 py-0.5 rounded">LLM_PROVIDER</code> dans .env pour changer</p>
        </div>

        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Configuration</h2>
          <div className="space-y-3">
            <Row label="LLM_PROVIDER" value={settings.provider} />
            <Row label="LLM_MODEL" value={settings.model || '(défaut)'} />
            <Row label="ANTHROPIC_API_KEY" value={settings.hasAnthropicKey ? '••••••••' : '—'} ok={settings.hasAnthropicKey} />
            <Row label="OPENAI_API_KEY" value={settings.hasOpenaiKey ? '••••••••' : '—'} ok={settings.hasOpenaiKey} />
            <Row label="GEMINI_API_KEY" value={settings.hasGeminiKey ? '••••••••' : '—'} ok={settings.hasGeminiKey} />
            <Row label="OPENROUTER_API_KEY" value={settings.hasOpenrouterKey ? '••••••••' : '—'} ok={settings.hasOpenrouterKey} />
          </div>
        </div>

        <div className="bg-blanc rounded-xl border border-gris-chaud p-6 lg:col-span-2">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Test LLM</h2>
          <button onClick={handleTest} disabled={isPending} className="bg-orange text-white font-mono text-[14px] font-bold px-6 py-2.5 rounded-lg hover:opacity-90 cursor-pointer disabled:opacity-50">
            {isPending ? 'Test en cours...' : `Tester ${settings.provider}`}
          </button>
          {testMsg && (
            <div className={`mt-3 font-mono text-[14px] px-4 py-2.5 rounded-lg ${testMsg.ok ? 'bg-vert/10 text-vert' : 'bg-rouge-doux/10 text-rouge-doux'}`}>
              {testMsg.ok ? '✓' : '✗'} {testMsg.text}
            </div>
          )}
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
