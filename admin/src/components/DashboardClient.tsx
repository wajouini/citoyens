'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DashboardData } from '@/lib/types';

interface LogLine {
  text: string;
  type: 'log' | 'error' | 'start' | 'done';
  timestamp: string;
}

const quickActions = [
  { label: 'Fetch RSS', desc: 'Récupérer les flux', icon: '📡', color: 'bg-bleu-rep', action: 'fetch' as const },
  { label: 'Générer Une', desc: 'Curation LLM', icon: '✍️', color: 'bg-orange', action: 'generate' as const },
  { label: 'Pipeline complet', desc: 'Fetch + Une + Build', icon: '⚡', color: 'bg-vert', action: 'full' as const },
  { label: 'Pipeline + Deploy', desc: 'Complet + git push', icon: '🚀', color: 'bg-rouge-rep', action: 'deploy' as const },
];

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(s: number): string {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ success: boolean; action: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const successRate = data.totalRuns > 0 ? Math.round((data.successRuns / data.totalRuns) * 100) : null;

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleAction = useCallback(async (action: 'fetch' | 'generate' | 'full' | 'deploy') => {
    if (action === 'deploy') {
      const confirmed = window.confirm(
        'Cette action va lancer le pipeline complet puis déployer en production (git push).\n\nContinuer ?'
      );
      if (!confirmed) return;
    }

    setRunning(action);
    setFinished(null);
    setLogs([]);

    // Abort previous if any
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch('/api/pipeline/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        let errText = 'Erreur réseau';
        try {
          const json = await resp.json();
          errText = json.error || errText;
        } catch {
          errText = await resp.text().catch(() => errText);
        }
        setLogs([{ text: `✗ ${errText}`, type: 'error', timestamp: new Date().toISOString() }]);
        setRunning(null);
        setFinished({ success: false, action });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const dataLine = part.trim();
          if (!dataLine.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(dataLine.slice(6));

            if (event.type === 'done') {
              setRunning(null);
              setFinished({ success: event.exitCode === 0, action });
              if (event.exitCode === 0) {
                setTimeout(() => router.refresh(), 1000);
              }
            } else {
              setLogs(prev => [...prev, {
                text: event.text || '',
                type: event.type,
                timestamp: event.timestamp,
              }]);
            }
          } catch {
            // Ignore malformed events
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setLogs(prev => [...prev, { text: `✗ ${err.message}`, type: 'error', timestamp: new Date().toISOString() }]);
        setRunning(null);
        setFinished({ success: false, action });
      }
    }
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Dashboard</h1>
        <p className="text-gris-texte text-[16px] mt-1">Pipeline local — données lues depuis les fichiers JSON</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <KPI label="Articles RSS" value={String(data.totalArticles)} sub={`${data.feedsWithArticles}/${data.totalFeeds} feeds OK`} color="text-bleu-rep" />
        <KPI label="Dernier fetch" value={fmtDate(data.articlesFileDate)} sub="" color="text-noir" />
        <KPI label="Total runs" value={String(data.totalRuns)} sub={data.totalRuns > 0 ? `${data.successRuns}✓ ${data.failedRuns}✗` : 'Aucun run'} color="text-noir" />
        <KPI label="Taux succès" value={successRate !== null ? `${successRate}%` : '—'} sub="" color={successRate !== null && successRate >= 80 ? 'text-vert' : 'text-gris-clair'} />
        <KPI label="Durée moy." value={fmtDuration(data.avgDuration)} sub="" color="text-noir" />
        <KPI label="LLM" value={data.currentProvider || '—'} sub={data.currentModel || ''} color={data.currentProvider ? 'text-noir' : 'text-gris-clair'} />
      </div>

      {/* Articles by type */}
      {data.totalArticles > 0 && (
        <div className="bg-blanc rounded-xl border border-gris-chaud p-5 mb-8">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">Répartition des articles</h2>
          <div className="space-y-2">
            {Object.entries(data.articlesByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const pct = Math.round((count / data.totalArticles) * 100);
              const colors: Record<string, string> = {
                investigation: 'bg-orange', mainstream: 'bg-bleu-rep', 'fact-check': 'bg-vert', etranger: 'bg-purple-600', institutionnel: 'bg-gris-texte',
              };
              return (
                <div key={type} className="flex items-center gap-3">
                  <div className="w-28 font-mono text-[13px] text-gris-texte capitalize">{type}</div>
                  <div className="flex-1 bg-gris-chaud/50 rounded-full h-4 overflow-hidden">
                    <div className={`h-full rounded-full ${colors[type] || 'bg-gris-texte'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-16 text-right font-mono text-[13px] text-noir font-bold">{count} ({pct}%)</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="mb-4">
        <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Actions rapides</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((qa) => (
            <button
              key={qa.label}
              onClick={() => handleAction(qa.action)}
              disabled={!!running}
              className={`${qa.color} text-white rounded-xl p-4 text-left hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{running === qa.action ? '⏳' : qa.icon}</span>
                <span className="font-mono text-[14px] font-bold">{running === qa.action ? 'En cours...' : qa.label}</span>
              </div>
              <div className="text-[13px] text-white/70">{qa.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Streaming logs console */}
      {(logs.length > 0 || running) && (
        <div className={`mb-8 rounded-xl border overflow-hidden ${
          finished ? (finished.success ? 'border-vert/40' : 'border-rouge-doux/40') : 'border-gris-chaud'
        }`}>
          {/* Header */}
          <div className={`px-4 py-2 flex items-center gap-2 ${
            finished ? (finished.success ? 'bg-vert/10' : 'bg-rouge-doux/10') : 'bg-noir'
          }`}>
            {running && (
              <span className="inline-block w-2 h-2 rounded-full bg-vert animate-pulse" />
            )}
            <span className={`font-mono text-[13px] font-bold uppercase ${
              finished ? (finished.success ? 'text-vert' : 'text-rouge-doux') : 'text-white'
            }`}>
              {running
                ? `${quickActions.find(q => q.action === running)?.label || running} — en cours...`
                : finished
                  ? (finished.success ? '✓ Terminé' : '✗ Erreur')
                  : 'Logs'}
            </span>
          </div>

          {/* Log lines */}
          <div className="bg-noir/95 p-4 max-h-80 overflow-y-auto font-mono text-[13px] leading-relaxed">
            {logs.map((log, i) => (
              <div key={i} className={`${
                log.type === 'error' ? 'text-rouge-doux' :
                log.type === 'start' ? 'text-bleu-clair' :
                log.text.startsWith('✓') ? 'text-vert' :
                log.text.startsWith('✗') ? 'text-rouge-doux' :
                log.text.startsWith('⚠') ? 'text-orange' :
                'text-gray-300'
              }`}>
                <span className="text-gray-500 select-none">[{fmtTime(log.timestamp)}]</span>{' '}
                {log.text}
              </div>
            ))}
            {running && (
              <div className="text-gray-500 animate-pulse">▌</div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Two columns: Une + Top sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold">Édition actuelle</h2>
            {data.une && <Link href="/edition" className="font-mono text-[12px] text-bleu-rep no-underline hover:underline">Voir →</Link>}
          </div>
          {data.une ? (
            <div>
              <div className="font-mono text-[12px] text-gris-clair mb-1">{data.une.date}</div>
              <div className="text-[17px] font-display font-bold text-noir leading-tight mb-2">{data.une.titre_une || '(sans titre)'}</div>
              {data.une.categorie && <span className="font-mono text-[12px] font-bold uppercase bg-bleu-clair text-bleu-rep px-2 py-0.5 rounded">{data.une.categorie}</span>}
              <p className="text-[14px] text-gris-texte mt-2 line-clamp-3">{data.une.accroche}</p>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-[32px] opacity-30 mb-2">📰</div>
              <p className="text-[15px] text-gris-texte">Aucune édition</p>
            </div>
          )}
        </div>

        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold">Top sources</h2>
            <Link href="/sources" className="font-mono text-[12px] text-bleu-rep no-underline hover:underline">Toutes →</Link>
          </div>
          {Object.keys(data.articlesBySrc).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(data.articlesBySrc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([src, count]) => (
                <div key={src} className="flex items-center justify-between py-1.5 border-b border-gris-chaud/30 last:border-0">
                  <span className="text-[15px] text-noir">{src}</span>
                  <span className="font-mono text-[13px] text-bleu-rep font-bold">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-[32px] opacity-30 mb-2">📡</div>
              <p className="text-[15px] text-gris-texte">Aucun article</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
      <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">{label}</div>
      <div className={`font-mono text-[22px] font-bold leading-none ${color}`}>{value}</div>
      {sub && <div className="font-mono text-[12px] text-gris-clair mt-1">{sub}</div>}
    </div>
  );
}
