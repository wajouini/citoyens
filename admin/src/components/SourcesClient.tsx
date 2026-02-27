'use client';

import { useState, useTransition } from 'react';
import { testFeed } from '@/actions/sources';
import type { FeedWithStats } from '@/actions/sources';

const typeColors: Record<string, string> = {
  investigation: 'bg-orange/10 text-orange',
  mainstream: 'bg-bleu-clair text-bleu-rep',
  'fact-check': 'bg-green-50 text-vert',
  etranger: 'bg-purple-50 text-purple-700',
  institutionnel: 'bg-gray-100 text-gris-texte',
};

const orientationColors: Record<string, string> = {
  'extreme-gauche': 'bg-red-700 text-white',
  'gauche': 'bg-red-500/15 text-red-700',
  'centre-gauche': 'bg-rose-100 text-rose-700',
  'centre': 'bg-gray-100 text-gris-texte',
  'centre-droit': 'bg-blue-100 text-blue-700',
  'droite': 'bg-blue-600/15 text-blue-800',
  'extreme-droite': 'bg-blue-900/15 text-blue-900',
  'variable': 'bg-gray-50 text-gris-clair',
};

const filterLabels = ['Tous', 'Investigation', 'Mainstream', 'Fact-check', 'Étranger', 'Institutionnel'];
const filterMap: Record<string, string | null> = {
  Tous: null, Investigation: 'investigation', Mainstream: 'mainstream',
  'Fact-check': 'fact-check', 'Étranger': 'etranger', Institutionnel: 'institutionnel',
};

export function SourcesClient({ feeds }: { feeds: FeedWithStats[] }) {
  const [filter, setFilter] = useState('Tous');
  const [groupeFilter, setGroupeFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ url: string; nom: string; result: any } | null>(null);
  const [isPending, startTransition] = useTransition();

  const groupes = [...new Set(feeds.map(f => f.groupe_nom).filter(Boolean))] as string[];

  let filtered = filter === 'Tous' ? feeds : feeds.filter((f) => f.type === filterMap[filter]);
  if (groupeFilter) {
    filtered = filtered.filter(f => f.groupe_nom === groupeFilter);
  }
  const totalArticles = feeds.reduce((s, f) => s + f.articleCount, 0);

  function handleTest(url: string, nom: string) {
    setTestResult({ url, nom, result: null });
    startTransition(async () => {
      const result = await testFeed(url);
      setTestResult({ url, nom, result });
    });
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Sources RSS</h1>
        <p className="text-gris-texte text-[16px] mt-1">{feeds.length} sources · {totalArticles} articles en cache · {groupes.length} groupes médias</p>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {filterLabels.map((f) => {
          const typeKey = filterMap[f];
          const count = typeKey ? feeds.filter((fd) => fd.type === typeKey).length : feeds.length;
          return (
            <button key={f} onClick={() => setFilter(f)} className={`font-mono text-[13px] px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${f === filter ? 'bg-noir text-white border-noir' : 'bg-blanc text-gris-texte border-gris-chaud hover:border-noir'}`}>
              {f} ({count})
            </button>
          );
        })}
      </div>

      {/* Groupe filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setGroupeFilter(null)}
          className={`font-mono text-[12px] px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${!groupeFilter ? 'bg-bleu-rep text-white border-bleu-rep' : 'bg-blanc text-gris-texte border-gris-chaud hover:border-bleu-rep'}`}
        >
          Tous les groupes
        </button>
        {groupes.map(g => {
          const count = feeds.filter(f => f.groupe_nom === g).length;
          return (
            <button key={g} onClick={() => setGroupeFilter(g === groupeFilter ? null : g)}
              className={`font-mono text-[12px] px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${g === groupeFilter ? 'bg-bleu-rep text-white border-bleu-rep' : 'bg-blanc text-gris-texte border-gris-chaud hover:border-bleu-rep'}`}>
              {g} ({count})
            </button>
          );
        })}
      </div>

      <div className="bg-blanc rounded-xl border border-gris-chaud overflow-hidden">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-gris-chaud bg-creme/50">
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Source</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Groupe</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Orientation</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Type</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Fiabilité</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-right py-3 px-4">Articles</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Test</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((feed) => (
              <>
                <tr key={feed.nom} className="border-b border-gris-chaud/50 hover:bg-creme/30 transition-colors cursor-pointer" onClick={() => setExpanded(expanded === feed.nom ? null : feed.nom)}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${feed.articleCount > 0 ? 'bg-vert' : 'bg-rouge-doux'}`} />
                      <div className="min-w-0">
                        <div className="font-medium text-noir">{feed.nom}</div>
                        <div className="font-mono text-[12px] text-gris-clair truncate max-w-[200px]">{feed.pays}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] text-noir font-medium">{feed.groupe_nom || '—'}</span>
                      {feed.proprietaire && (
                        <span className="font-mono text-[11px] text-gris-clair">{feed.proprietaire}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {feed.orientation ? (
                      <span className={`text-[12px] font-mono font-bold px-2 py-0.5 rounded-full ${orientationColors[feed.orientation] || 'bg-gray-100 text-gris-texte'}`}>
                        {feed.orientation}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4"><span className={`text-[12px] font-mono font-bold uppercase px-2 py-0.5 rounded ${typeColors[feed.type] || ''}`}>{feed.type}</span></td>
                  <td className="py-3 px-4 font-mono text-[14px]">{'★'.repeat(feed.fiabilite)}{'☆'.repeat(5 - feed.fiabilite)}</td>
                  <td className="py-3 px-4 text-right"><span className={`font-mono text-[15px] font-bold ${feed.articleCount > 0 ? 'text-bleu-rep' : 'text-gris-clair'}`}>{feed.articleCount}</span></td>
                  <td className="py-3 px-4"><button onClick={(e) => { e.stopPropagation(); handleTest(feed.url, feed.nom); }} disabled={isPending} className="font-mono text-[12px] text-bleu-rep bg-bleu-clair px-2 py-1 rounded hover:opacity-80 cursor-pointer disabled:opacity-50">Tester</button></td>
                </tr>
                {expanded === feed.nom && feed.ligne_editoriale && (
                  <tr key={`${feed.nom}-detail`} className="border-b border-gris-chaud/50 bg-creme/20">
                    <td colSpan={7} className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <span className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair shrink-0 pt-0.5">Ligne éditoriale</span>
                        <p className="text-[14px] text-gris-texte leading-relaxed">{feed.ligne_editoriale}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {testResult && (
        <div className="fixed inset-0 bg-noir/50 flex items-center justify-center z-50" onClick={() => setTestResult(null)}>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono text-[14px] font-bold">{testResult.nom}</h3>
              <button onClick={() => setTestResult(null)} className="text-gris-clair hover:text-noir cursor-pointer text-lg">✕</button>
            </div>
            <div className="font-mono text-[12px] text-gris-clair mb-3 break-all">{testResult.url}</div>
            {!testResult.result ? (
              <div className="text-center py-8 text-gris-clair font-mono text-[14px]">Chargement du flux...</div>
            ) : testResult.result.success ? (
              <div>
                <div className="bg-vert/10 text-vert font-mono text-[13px] px-3 py-1.5 rounded mb-3">✓ {testResult.result.articles.length} articles</div>
                <div className="space-y-2">
                  {testResult.result.articles.map((a: any, i: number) => (
                    <div key={i} className="border border-gris-chaud/50 rounded-lg p-3">
                      <div className="text-[15px] font-medium text-noir">{a.title}</div>
                      {a.pubDate && <div className="font-mono text-[12px] text-gris-clair mt-1">{new Date(a.pubDate).toLocaleString('fr-FR')}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-rouge-doux/10 text-rouge-doux font-mono text-[13px] px-3 py-2 rounded">✗ {testResult.result.error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
