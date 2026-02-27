'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RunLog } from '@/lib/types';

function fmtDuration(s: number): string {
  if (!s) return '—';
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function badge(status: string) {
  const c: Record<string, string> = { success: 'bg-vert/10 text-vert', failed: 'bg-rouge-doux/10 text-rouge-doux', skipped: 'bg-gris-chaud text-gris-texte' };
  return <span className={`text-[12px] font-mono font-bold uppercase px-2 py-0.5 rounded ${c[status] || 'bg-gris-chaud text-gris-texte'}`}>{status}</span>;
}

export function RunsClient({ runs }: { runs: RunLog[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Stats
  const successCount = runs.filter(r => r.status === 'success').length;
  const failedCount = runs.filter(r => r.status === 'failed').length;
  const avgDuration = runs.length > 0 ? runs.reduce((sum, r) => sum + (r.duration_s || 0), 0) / runs.length : 0;
  const totalArticles = runs.length > 0 ? runs[0].stats?.articles_fetched || 0 : 0;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Pipeline Runs</h1>
        <p className="text-gris-texte text-[16px] mt-1">{runs.length > 0 ? `${runs.length} exécution${runs.length > 1 ? 's' : ''}` : 'Historique des exécutions'}</p>
      </div>

      {runs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Total</div>
            <div className="font-mono text-[22px] font-bold text-noir leading-none">{runs.length}</div>
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Succès</div>
            <div className="font-mono text-[22px] font-bold text-vert leading-none">{successCount}</div>
            {failedCount > 0 && <div className="font-mono text-[12px] text-rouge-doux mt-1">{failedCount} échoué{failedCount > 1 ? 's' : ''}</div>}
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Durée moy.</div>
            <div className="font-mono text-[22px] font-bold text-noir leading-none">{fmtDuration(avgDuration)}</div>
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Derniers articles</div>
            <div className="font-mono text-[22px] font-bold text-bleu-rep leading-none">{totalArticles}</div>
          </div>
        </div>
      )}

      {runs.length > 0 ? (
        <div className="bg-blanc rounded-xl border border-gris-chaud overflow-hidden">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-gris-chaud bg-creme/50">
                {['Status', 'Date', 'Durée', 'Articles', 'Feeds', 'LLM', 'Deploy'].map((h) => (
                  <th key={h} className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} expanded={expandedId === run.id} onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6 text-center py-16">
          <div className="text-[48px] opacity-30 mb-3">⚡</div>
          <p className="text-[18px] text-gris-texte font-medium mb-1">Aucun run enregistré</p>
          <p className="text-[15px] text-gris-clair mb-4">Lance une action depuis le Dashboard pour créer le premier run</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-bleu-rep text-white font-mono text-[14px] font-bold px-4 py-2 rounded-lg no-underline hover:opacity-90 transition-opacity">
            📡 Aller au Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}

function RunRow({ run, expanded, onToggle }: { run: RunLog; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-gris-chaud/50 hover:bg-creme/30 cursor-pointer" onClick={onToggle}>
        <td className="py-3 px-4">{badge(run.status)}</td>
        <td className="py-3 px-4 font-mono text-[13px]">
          {run.date}
          <div className="text-gris-clair">{fmtTime(run.started_at)}</div>
        </td>
        <td className="py-3 px-4 font-mono text-[14px]">{fmtDuration(run.duration_s)}</td>
        <td className="py-3 px-4 font-mono text-[14px]">{run.stats?.articles_fetched ?? '—'}</td>
        <td className="py-3 px-4 font-mono text-[14px]">{run.stats ? `${run.stats.feeds_ok}/${run.stats.feeds_total}` : '—'}</td>
        <td className="py-3 px-4 font-mono text-[12px] text-gris-texte">{run.stats?.provider ?? '—'}</td>
        <td className="py-3 px-4">{run.deployed ? <span className="text-[12px] font-mono font-bold text-vert bg-vert/10 px-2 py-0.5 rounded">✓</span> : '—'}</td>
      </tr>
      {expanded && (
        <tr><td colSpan={7} className="bg-creme/50 px-4 py-3">
          <div className="font-mono text-[12px] uppercase tracking-[2px] text-gris-clair mb-2">Étapes</div>
          {run.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              {badge(s.status)}
              <span className="font-mono text-[13px] text-noir flex-1">{s.name}</span>
              <span className="font-mono text-[12px] text-gris-clair">{fmtDuration(s.duration_s)}</span>
              {s.error && <span className="font-mono text-[12px] text-rouge-doux truncate max-w-xs">{s.error}</span>}
            </div>
          ))}
          {run.stats && (
            <div className="mt-2 pt-2 border-t border-gris-chaud/30 flex flex-wrap gap-4 font-mono text-[12px] text-gris-texte">
              <span>📰 {run.stats.articles_fetched} articles</span>
              <span>📡 {run.stats.feeds_ok}/{run.stats.feeds_total} feeds</span>
              <span>📋 {run.stats.faits_du_jour} faits</span>
              <span>🔍 {run.stats.regards_croises} regards</span>
              <span>🌍 {run.stats.regard_etranger} étranger</span>
              {run.stats.model && <span>🤖 {run.stats.model}</span>}
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}
