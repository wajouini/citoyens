'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { testFeed, addFeed, updateFeed, toggleFeedActive, deleteFeed, type FeedWithStats } from '@/actions/sources';
import type { FeedSource } from '@/lib/local-data';

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

type SortKey = 'nom' | 'articleCount' | 'fiabilite' | 'type';
type SortDir = 'asc' | 'desc';

const EMPTY_FEED: FeedSource = {
  nom: '', url: '', type: 'mainstream', pays: 'France', langue: 'fr',
  fiabilite: 3, active: true, groupe: null, orientation: null, ligne_editoriale: null,
};

export function SourcesClient({ feeds }: { feeds: FeedWithStats[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('Tous');
  const [groupeFilter, setGroupeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('nom');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ url: string; nom: string; result: any } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingFeed, setEditingFeed] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<FeedSource>>({});
  const [newFeed, setNewFeed] = useState<FeedSource>({ ...EMPTY_FEED });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const groupes = [...new Set(feeds.map(f => f.groupe_nom).filter(Boolean))] as string[];

  const filtered = useMemo(() => {
    let result = feeds;
    if (filter !== 'Tous') result = result.filter(f => f.type === filterMap[filter]);
    if (groupeFilter) result = result.filter(f => f.groupe_nom === groupeFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        f.nom.toLowerCase().includes(q) ||
        f.url.toLowerCase().includes(q) ||
        (f.groupe_nom?.toLowerCase().includes(q)) ||
        (f.pays?.toLowerCase().includes(q))
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'nom') cmp = a.nom.localeCompare(b.nom);
      else if (sortKey === 'articleCount') cmp = a.articleCount - b.articleCount;
      else if (sortKey === 'fiabilite') cmp = a.fiabilite - b.fiabilite;
      else if (sortKey === 'type') cmp = a.type.localeCompare(b.type);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [feeds, filter, groupeFilter, search, sortKey, sortDir]);

  const totalArticles = feeds.reduce((s, f) => s + f.articleCount, 0);
  const activeCount = feeds.filter(f => f.active).length;

  function showToast(type: 'success' | 'error', text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function handleTest(url: string, nom: string) {
    setTestResult({ url, nom, result: null });
    startTransition(async () => {
      const result = await testFeed(url);
      setTestResult({ url, nom, result });
    });
  }

  function handleToggleActive(nom: string) {
    startTransition(async () => {
      const result = await toggleFeedActive(nom);
      if (result.success) { showToast('success', `Source ${nom} modifiée`); router.refresh(); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleDelete(nom: string) {
    if (!window.confirm(`Supprimer la source "${nom}" ?`)) return;
    startTransition(async () => {
      const result = await deleteFeed(nom);
      if (result.success) { showToast('success', `Source "${nom}" supprimée`); router.refresh(); }
      else showToast('error', result.error || 'Erreur');
    });
  }

  function handleAdd() {
    if (!newFeed.nom || !newFeed.url) { showToast('error', 'Nom et URL requis'); return; }
    startTransition(async () => {
      const result = await addFeed(newFeed);
      if (result.success) {
        showToast('success', `Source "${newFeed.nom}" ajoutée`);
        setNewFeed({ ...EMPTY_FEED });
        setShowAddForm(false);
        router.refresh();
      } else showToast('error', result.error || 'Erreur');
    });
  }

  function handleSaveEdit(nom: string) {
    startTransition(async () => {
      const result = await updateFeed(nom, editForm);
      if (result.success) {
        showToast('success', `Source "${nom}" modifiée`);
        setEditingFeed(null);
        setEditForm({});
        router.refresh();
      } else showToast('error', result.error || 'Erreur');
    });
  }

  function startEdit(feed: FeedWithStats) {
    setEditingFeed(feed.nom);
    setEditForm({
      nom: feed.nom, url: feed.url, type: feed.type, pays: feed.pays,
      langue: feed.langue, fiabilite: feed.fiabilite, orientation: feed.orientation,
      ligne_editoriale: feed.ligne_editoriale, groupe: feed.groupe,
    });
  }

  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 font-mono text-[14px] px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-vert text-white' : 'bg-rouge-doux text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Sources RSS</h1>
          <p className="text-gris-texte text-[14px] mt-1">
            {feeds.length} sources ({activeCount} actives) · {totalArticles} articles · {groupes.length} groupes médias
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer transition-colors"
        >
          {showAddForm ? 'Fermer' : '+ Ajouter une source'}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-blanc rounded-xl border border-bleu-rep/30 p-5 mb-6">
          <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Nouvelle source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Nom *</label>
              <input value={newFeed.nom} onChange={e => setNewFeed(f => ({ ...f, nom: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep" placeholder="Le Monde" />
            </div>
            <div className="md:col-span-2">
              <label className="font-mono text-[11px] text-gris-clair block mb-1">URL du flux RSS *</label>
              <input value={newFeed.url} onChange={e => setNewFeed(f => ({ ...f, url: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:border-bleu-rep" placeholder="https://..." />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Type</label>
              <select value={newFeed.type} onChange={e => setNewFeed(f => ({ ...f, type: e.target.value as any }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep">
                <option value="investigation">Investigation</option>
                <option value="mainstream">Mainstream</option>
                <option value="fact-check">Fact-check</option>
                <option value="etranger">Étranger</option>
                <option value="institutionnel">Institutionnel</option>
              </select>
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Pays</label>
              <input value={newFeed.pays} onChange={e => setNewFeed(f => ({ ...f, pays: e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep" placeholder="France" />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Fiabilité (1-5)</label>
              <input type="number" min={1} max={5} value={newFeed.fiabilite} onChange={e => setNewFeed(f => ({ ...f, fiabilite: +e.target.value }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep" />
            </div>
            <div>
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Orientation</label>
              <select value={newFeed.orientation || ''} onChange={e => setNewFeed(f => ({ ...f, orientation: e.target.value || null }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep">
                <option value="">—</option>
                {Object.keys(orientationColors).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="font-mono text-[11px] text-gris-clair block mb-1">Ligne éditoriale</label>
              <input value={newFeed.ligne_editoriale || ''} onChange={e => setNewFeed(f => ({ ...f, ligne_editoriale: e.target.value || null }))} className="w-full border border-gris-chaud rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-bleu-rep" placeholder="Description..." />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAdd} disabled={isPending} className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-vert text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
              {isPending ? 'Ajout...' : 'Ajouter'}
            </button>
            <button onClick={() => { setShowAddForm(false); setNewFeed({ ...EMPTY_FEED }); }} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-gris-chaud text-gris-texte hover:bg-creme cursor-pointer">
              Annuler
            </button>
            {newFeed.url && (
              <button onClick={() => handleTest(newFeed.url, newFeed.nom || 'Test')} disabled={isPending} className="font-mono text-[13px] px-4 py-2 rounded-lg border border-bleu-rep text-bleu-rep hover:bg-bleu-clair cursor-pointer disabled:opacity-50">
                Tester le flux
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une source (nom, URL, groupe, pays)..."
          className="w-full max-w-md border border-gris-chaud rounded-lg px-4 py-2.5 text-[14px] focus:outline-none focus:border-bleu-rep bg-blanc"
        />
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

      {/* Results info */}
      <div className="font-mono text-[12px] text-gris-clair mb-2">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</div>

      <div className="bg-blanc rounded-xl border border-gris-chaud overflow-hidden">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-gris-chaud bg-creme/50">
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4 cursor-pointer hover:text-noir select-none" onClick={() => handleSort('nom')}>Source{sortIcon('nom')}</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Groupe</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Orientation</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4 cursor-pointer hover:text-noir select-none" onClick={() => handleSort('type')}>Type{sortIcon('type')}</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4 cursor-pointer hover:text-noir select-none" onClick={() => handleSort('fiabilite')}>Fiabilité{sortIcon('fiabilite')}</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-right py-3 px-4 cursor-pointer hover:text-noir select-none" onClick={() => handleSort('articleCount')}>Articles{sortIcon('articleCount')}</th>
              <th className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair text-left py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((feed) => (
              <FeedRow
                key={feed.nom}
                feed={feed}
                expanded={expanded === feed.nom}
                onToggleExpand={() => setExpanded(expanded === feed.nom ? null : feed.nom)}
                onTest={() => handleTest(feed.url, feed.nom)}
                onToggleActive={() => handleToggleActive(feed.nom)}
                onDelete={() => handleDelete(feed.nom)}
                onEdit={() => startEdit(feed)}
                isEditing={editingFeed === feed.nom}
                editForm={editForm}
                onEditFormChange={setEditForm}
                onSaveEdit={() => handleSaveEdit(feed.nom)}
                onCancelEdit={() => { setEditingFeed(null); setEditForm({}); }}
                isPending={isPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Test modal */}
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
                <div className="bg-vert/10 text-vert font-mono text-[13px] px-3 py-1.5 rounded mb-3">{testResult.result.articles.length} articles</div>
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
              <div className="bg-rouge-doux/10 text-rouge-doux font-mono text-[13px] px-3 py-2 rounded">{testResult.result.error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedRow({
  feed, expanded, onToggleExpand, onTest, onToggleActive, onDelete, onEdit,
  isEditing, editForm, onEditFormChange, onSaveEdit, onCancelEdit, isPending,
}: {
  feed: FeedWithStats;
  expanded: boolean;
  onToggleExpand: () => void;
  onTest: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onEdit: () => void;
  isEditing: boolean;
  editForm: Partial<FeedSource>;
  onEditFormChange: (f: Partial<FeedSource>) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isPending: boolean;
}) {
  return (
    <>
      <tr className={`border-b border-gris-chaud/50 hover:bg-creme/30 transition-colors ${!feed.active ? 'opacity-50' : ''}`}>
        <td className="py-3 px-4 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${feed.active ? (feed.articleCount > 0 ? 'bg-vert' : 'bg-orange') : 'bg-gris-clair'}`} />
            <div className="min-w-0">
              <div className="font-medium text-noir">{feed.nom}</div>
              <div className="font-mono text-[12px] text-gris-clair truncate max-w-[200px]">{feed.pays}</div>
            </div>
          </div>
        </td>
        <td className="py-3 px-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-noir font-medium">{feed.groupe_nom || '—'}</span>
            {feed.proprietaire && <span className="font-mono text-[11px] text-gris-clair">{feed.proprietaire}</span>}
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
        <td className="py-3 px-4">
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onTest(); }} disabled={isPending} className="font-mono text-[11px] text-bleu-rep bg-bleu-clair px-2 py-1 rounded hover:opacity-80 cursor-pointer disabled:opacity-50">Test</button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="font-mono text-[11px] text-gris-texte bg-creme px-2 py-1 rounded hover:opacity-80 cursor-pointer">Edit</button>
            <button onClick={(e) => { e.stopPropagation(); onToggleActive(); }} disabled={isPending} className={`font-mono text-[11px] px-2 py-1 rounded cursor-pointer disabled:opacity-50 ${feed.active ? 'text-orange bg-orange/10 hover:bg-orange/20' : 'text-vert bg-vert/10 hover:bg-vert/20'}`}>
              {feed.active ? 'Off' : 'On'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} disabled={isPending} className="font-mono text-[11px] text-rouge-doux bg-rouge-doux/10 px-2 py-1 rounded hover:bg-rouge-doux/20 cursor-pointer disabled:opacity-50">✕</button>
          </div>
        </td>
      </tr>
      {/* Expanded: ligne editoriale / edit form */}
      {(expanded || isEditing) && (
        <tr className="border-b border-gris-chaud/50 bg-creme/20">
          <td colSpan={7} className="py-3 px-4">
            {isEditing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="font-mono text-[10px] text-gris-clair block mb-1">URL</label>
                    <input value={editForm.url || ''} onChange={e => onEditFormChange({ ...editForm, url: e.target.value })} className="w-full border border-gris-chaud rounded px-2 py-1.5 text-[13px] font-mono focus:outline-none focus:border-bleu-rep" />
                  </div>
                  <div>
                    <label className="font-mono text-[10px] text-gris-clair block mb-1">Type</label>
                    <select value={editForm.type || ''} onChange={e => onEditFormChange({ ...editForm, type: e.target.value as any })} className="w-full border border-gris-chaud rounded px-2 py-1.5 text-[13px] focus:outline-none focus:border-bleu-rep">
                      <option value="investigation">Investigation</option>
                      <option value="mainstream">Mainstream</option>
                      <option value="fact-check">Fact-check</option>
                      <option value="etranger">Étranger</option>
                      <option value="institutionnel">Institutionnel</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-mono text-[10px] text-gris-clair block mb-1">Fiabilité</label>
                    <input type="number" min={1} max={5} value={editForm.fiabilite || 3} onChange={e => onEditFormChange({ ...editForm, fiabilite: +e.target.value })} className="w-full border border-gris-chaud rounded px-2 py-1.5 text-[13px] focus:outline-none focus:border-bleu-rep" />
                  </div>
                </div>
                <div>
                  <label className="font-mono text-[10px] text-gris-clair block mb-1">Ligne éditoriale</label>
                  <input value={editForm.ligne_editoriale || ''} onChange={e => onEditFormChange({ ...editForm, ligne_editoriale: e.target.value || null })} className="w-full border border-gris-chaud rounded px-2 py-1.5 text-[13px] focus:outline-none focus:border-bleu-rep" />
                </div>
                <div className="flex gap-2">
                  <button onClick={onSaveEdit} disabled={isPending} className="font-mono text-[12px] font-bold px-3 py-1.5 rounded bg-vert text-white hover:opacity-90 cursor-pointer disabled:opacity-50">Enregistrer</button>
                  <button onClick={onCancelEdit} className="font-mono text-[12px] px-3 py-1.5 rounded border border-gris-chaud text-gris-texte hover:bg-creme cursor-pointer">Annuler</button>
                </div>
              </div>
            ) : feed.ligne_editoriale ? (
              <div className="flex items-start gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair shrink-0 pt-0.5">Ligne éditoriale</span>
                <p className="text-[14px] text-gris-texte leading-relaxed">{feed.ligne_editoriale}</p>
              </div>
            ) : (
              <p className="text-[13px] text-gris-clair italic">Aucune ligne éditoriale renseignée</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
