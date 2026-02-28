'use client';

import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import type { EditionSummary } from '@/lib/local-data';
import type { EditionWithMetrics } from '@/actions/edition-history';
import type { Une } from '@/lib/types';
import { loadEditionForDiff } from '@/actions/edition-history';

function formatDateFR(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function EditionHistoryClient({
  history,
  editions,
}: {
  history: EditionSummary[];
  editions: EditionWithMetrics[];
}) {
  const [search, setSearch] = useState('');
  const [diffDates, setDiffDates] = useState<[string, string] | null>(null);
  const [diffData, setDiffData] = useState<[Une | null, Une | null] | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!search) return editions;
    const q = search.toLowerCase();
    return editions.filter(ed =>
      ed.titre_une.toLowerCase().includes(q) ||
      ed.date.includes(q) ||
      ed.categories.some(c => c.toLowerCase().includes(q)) ||
      ed.categorie?.toLowerCase().includes(q)
    );
  }, [editions, search]);

  // Aggregate metrics
  const avgFaits = editions.length > 0 ? (editions.reduce((s, e) => s + e.faits_count, 0) / editions.length).toFixed(1) : '—';
  const avgRegards = editions.length > 0 ? (editions.reduce((s, e) => s + e.regards_count, 0) / editions.length).toFixed(1) : '—';
  const avgSources = editions.length > 0 ? (editions.reduce((s, e) => s + e.source_count, 0) / editions.length).toFixed(1) : '—';
  const avgGroups = editions.length > 0 ? (editions.reduce((s, e) => s + e.unique_groups, 0) / editions.length).toFixed(1) : '—';

  function handleDiff(dateA: string, dateB: string) {
    setDiffDates([dateA, dateB]);
    startTransition(async () => {
      const [a, b] = await Promise.all([loadEditionForDiff(dateA), loadEditionForDiff(dateB)]);
      setDiffData([a, b]);
    });
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Historique des éditions</h1>
          <p className="text-gris-texte text-[14px] mt-1">{editions.length} édition{editions.length !== 1 ? 's' : ''} archivée{editions.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/edition" className="font-mono text-[13px] text-bleu-rep no-underline hover:underline">
          ← Retour à l'édition courante
        </Link>
      </div>

      {/* Aggregate metrics */}
      {editions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Faits / éd. (moy.)</div>
            <div className="font-mono text-[22px] font-bold text-noir leading-none">{avgFaits}</div>
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Regards / éd. (moy.)</div>
            <div className="font-mono text-[22px] font-bold text-noir leading-none">{avgRegards}</div>
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Sources / éd. (moy.)</div>
            <div className="font-mono text-[22px] font-bold text-bleu-rep leading-none">{avgSources}</div>
          </div>
          <div className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Groupes / éd. (moy.)</div>
            <div className="font-mono text-[22px] font-bold text-noir leading-none">{avgGroups}</div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher dans les éditions (titre, date, catégorie)..."
          className="w-full max-w-md border border-gris-chaud rounded-lg px-4 py-2.5 text-[14px] focus:outline-none focus:border-bleu-rep bg-blanc"
        />
      </div>

      {/* Diff panel */}
      {diffDates && (
        <div className="bg-blanc rounded-xl border border-orange/30 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold">
              Comparaison : {diffDates[0]} vs {diffDates[1]}
            </h3>
            <button onClick={() => { setDiffDates(null); setDiffData(null); }} className="font-mono text-[12px] text-gris-clair hover:text-noir cursor-pointer">Fermer</button>
          </div>
          {isPending ? (
            <div className="text-center py-8 text-gris-clair font-mono text-[14px]">Chargement...</div>
          ) : diffData ? (
            <DiffView a={diffData[0]} b={diffData[1]} dateA={diffDates[0]} dateB={diffDates[1]} />
          ) : null}
        </div>
      )}

      {/* Edition list */}
      <div className="space-y-3">
        {filtered.map((ed, i) => (
          <div key={ed.date} className="bg-blanc rounded-xl border border-gris-chaud p-5 hover:border-bleu-rep/20 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-[13px] font-bold text-bleu-rep">{formatDateFR(ed.date)}</span>
                  {ed.categorie && (
                    <span className="font-mono text-[10px] font-bold uppercase bg-bleu-clair text-bleu-rep px-1.5 py-0.5 rounded">{ed.categorie}</span>
                  )}
                </div>
                <h3 className="text-[17px] font-medium text-noir leading-snug mb-2">{ed.titre_une}</h3>
                {ed.accroche && <p className="text-[14px] text-gris-texte line-clamp-2 mb-2">{ed.accroche}</p>}
                <div className="flex items-center gap-4 font-mono text-[11px] text-gris-clair flex-wrap">
                  <span>{ed.faits_count} faits</span>
                  <span>{ed.regards_count} regards</span>
                  <span>{ed.etranger_count} étranger</span>
                  <span>{ed.source_count} sources</span>
                  <span>{ed.unique_groups} groupes</span>
                  {ed.categories.length > 0 && (
                    <span className="text-gris-texte">{ed.categories.join(', ')}</span>
                  )}
                  {ed.modele && <span>{ed.modele.split('/').pop()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {i < filtered.length - 1 && (
                  <button
                    onClick={() => handleDiff(ed.date, filtered[i + 1].date)}
                    className="font-mono text-[11px] text-orange bg-orange/10 px-2 py-1 rounded hover:bg-orange/20 cursor-pointer"
                  >
                    Diff
                  </button>
                )}
                <Link
                  href={`/edition/${ed.date}`}
                  className="font-mono text-[12px] text-bleu-rep bg-bleu-clair px-3 py-1 rounded no-underline hover:opacity-80"
                >
                  Voir
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6 text-center py-12">
          <div className="text-[40px] opacity-30 mb-3">📚</div>
          <p className="text-[16px] text-gris-texte">Aucune édition trouvée</p>
          {search && <p className="text-[14px] text-gris-clair mt-1">Essayez un autre terme de recherche</p>}
        </div>
      )}
    </div>
  );
}

function DiffView({ a, b, dateA, dateB }: { a: Une | null; b: Une | null; dateA: string; dateB: string }) {
  if (!a || !b) return <p className="text-[14px] text-gris-clair">Impossible de charger les éditions.</p>;

  const faitsA = new Set((a.faits_du_jour || []).map(f => f.titre));
  const faitsB = new Set((b.faits_du_jour || []).map(f => f.titre));
  const newFaits = [...faitsA].filter(t => !faitsB.has(t));
  const removedFaits = [...faitsB].filter(t => !faitsA.has(t));
  const keptFaits = [...faitsA].filter(t => faitsB.has(t));

  const rcA = new Set((Array.isArray(a.regards_croises) ? a.regards_croises : []).map(r => r.sujet));
  const rcB = new Set((Array.isArray(b.regards_croises) ? b.regards_croises : []).map(r => r.sujet));
  const newRC = [...rcA].filter(s => !rcB.has(s));
  const removedRC = [...rcB].filter(s => !rcA.has(s));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-creme rounded-lg p-3">
          <div className="font-mono text-[11px] text-gris-clair mb-1">{dateA} (nouveau)</div>
          <div className="font-mono text-[16px] font-bold text-noir">{a.titre_une}</div>
          <div className="font-mono text-[12px] text-gris-clair mt-1">{a.faits_du_jour?.length || 0} faits · {(Array.isArray(a.regards_croises) ? a.regards_croises : []).length} regards</div>
        </div>
        <div className="bg-creme rounded-lg p-3">
          <div className="font-mono text-[11px] text-gris-clair mb-1">{dateB} (ancien)</div>
          <div className="font-mono text-[16px] font-bold text-noir">{b.titre_une}</div>
          <div className="font-mono text-[12px] text-gris-clair mt-1">{b.faits_du_jour?.length || 0} faits · {(Array.isArray(b.regards_croises) ? b.regards_croises : []).length} regards</div>
        </div>
      </div>

      {a.titre_une !== b.titre_une && (
        <div className="rounded-lg border border-orange/30 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[2px] text-orange mb-1">Titre modifié</div>
          <div className="text-[14px] text-rouge-doux line-through">{b.titre_une}</div>
          <div className="text-[14px] text-vert">{a.titre_une}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {newFaits.length > 0 && (
          <div className="rounded-lg bg-vert/5 border border-vert/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-vert mb-2">Nouveaux faits (+{newFaits.length})</div>
            {newFaits.map((t, i) => <div key={i} className="text-[13px] text-noir py-0.5">+ {t}</div>)}
          </div>
        )}
        {removedFaits.length > 0 && (
          <div className="rounded-lg bg-rouge-doux/5 border border-rouge-doux/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-rouge-doux mb-2">Faits retirés (-{removedFaits.length})</div>
            {removedFaits.map((t, i) => <div key={i} className="text-[13px] text-gris-texte py-0.5 line-through">- {t}</div>)}
          </div>
        )}
        {newRC.length > 0 && (
          <div className="rounded-lg bg-vert/5 border border-vert/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-vert mb-2">Nouveaux regards (+{newRC.length})</div>
            {newRC.map((s, i) => <div key={i} className="text-[13px] text-noir py-0.5">+ {s}</div>)}
          </div>
        )}
        {removedRC.length > 0 && (
          <div className="rounded-lg bg-rouge-doux/5 border border-rouge-doux/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-rouge-doux mb-2">Regards retirés (-{removedRC.length})</div>
            {removedRC.map((s, i) => <div key={i} className="text-[13px] text-gris-texte py-0.5 line-through">- {s}</div>)}
          </div>
        )}
      </div>

      {keptFaits.length > 0 && (
        <div className="text-[12px] text-gris-clair font-mono">{keptFaits.length} fait{keptFaits.length > 1 ? 's' : ''} inchangé{keptFaits.length > 1 ? 's' : ''}</div>
      )}
    </div>
  );
}
