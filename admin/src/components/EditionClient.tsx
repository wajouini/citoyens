'use client';

import { useState, useTransition, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Une, FaitDuJour, RegardEtranger, RegardsCroises, Couverture, ASurveiller, ChiffreDuJour } from '@/lib/types';
import type { EditionSummary, EditionMeta, EditorialAlert } from '@/lib/local-data';
import { saveEditionEdits, publishEdition, revertToDraft } from '@/actions/edition';

// ─── Inline editable text ───

function Editable({
  value,
  onChange,
  editing,
  tag = 'span',
  className = '',
  multiline = false,
}: {
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  tag?: 'span' | 'p' | 'h2' | 'div';
  className?: string;
  multiline?: boolean;
}) {
  if (!editing) {
    const Tag = tag;
    return <Tag className={className}>{value}</Tag>;
  }
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} w-full bg-orange/5 border border-orange/30 rounded px-2 py-1 resize-y min-h-[60px] focus:outline-none focus:border-orange`}
        rows={3}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${className} w-full bg-orange/5 border border-orange/30 rounded px-2 py-1 focus:outline-none focus:border-orange`}
    />
  );
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: EditionMeta['status'] }) {
  const styles = {
    draft: 'bg-orange/10 text-orange border-orange/30',
    reviewed: 'bg-bleu-rep/10 text-bleu-rep border-bleu-rep/30',
    published: 'bg-vert/10 text-vert border-vert/30',
  };
  const labels = { draft: 'Brouillon', reviewed: 'Relu', published: 'Publié' };
  return (
    <span className={`font-mono text-[12px] font-bold uppercase px-2.5 py-1 rounded-lg border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── Editorial Alerts Panel ───

function AlertsPanel({ alerts }: { alerts: EditorialAlert[] }) {
  if (alerts.length === 0) return null;
  const iconMap = { warning: '⚠', error: '✗', info: 'ℹ' };
  const colorMap = {
    warning: 'text-orange bg-orange/5 border-orange/20',
    error: 'text-rouge-doux bg-rouge-doux/5 border-rouge-doux/20',
    info: 'text-bleu-rep bg-bleu-clair border-bleu-rep/20',
  };
  return (
    <div className="mb-6">
      <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">
        Alertes éditoriales ({alerts.length})
      </h3>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${colorMap[a.type]}`}>
            <span className="font-mono text-[14px] shrink-0 mt-0.5">{iconMap[a.type]}</span>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{a.message}</div>
              {a.detail && <div className="text-[12px] opacity-70 mt-0.5">{a.detail}</div>}
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-50">{a.category}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───

export function EditionClient({
  une: initialUne,
  fileDate,
  history = [],
  selectedDate,
  meta: initialMeta,
  alerts = [],
}: {
  une: Une | null;
  fileDate: string | null;
  history?: EditionSummary[];
  selectedDate?: string;
  meta?: EditionMeta;
  alerts?: EditorialAlert[];
}) {
  const router = useRouter();
  const [une, setUne] = useState<Une | null>(initialUne);
  const [meta, setMeta] = useState<EditionMeta>(initialMeta || { status: 'draft', generatedAt: '', lastEditedAt: null, publishedAt: null, editHistory: [] });
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const currentDate = selectedDate || une?.date;
  const isCurrentEdition = !selectedDate;

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Deep-clone helper for immutable updates
  function updateUne(updater: (draft: Une) => void) {
    if (!une) return;
    const draft = JSON.parse(JSON.stringify(une)) as Une;
    updater(draft);
    setUne(draft);
  }

  function handleSave() {
    if (!une) return;
    startTransition(async () => {
      const result = await saveEditionEdits(une);
      if (result.success) {
        setMeta(prev => ({ ...prev, status: 'reviewed', lastEditedAt: new Date().toISOString() }));
        setEditing(false);
        showToast('success', 'Modifications sauvegardées');
        router.refresh();
      } else {
        showToast('error', result.error || 'Erreur lors de la sauvegarde');
      }
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const result = await publishEdition();
      if (result.success) {
        setMeta(prev => ({ ...prev, status: 'published', publishedAt: new Date().toISOString() }));
        showToast('success', 'Édition publiée');
        router.refresh();
      } else {
        showToast('error', result.error || 'Erreur lors de la publication');
      }
    });
  }

  function handleRevert() {
    startTransition(async () => {
      const result = await revertToDraft();
      if (result.success) {
        setMeta(prev => ({ ...prev, status: 'draft', publishedAt: null }));
        showToast('success', 'Repassée en brouillon');
        router.refresh();
      }
    });
  }

  function handleMoveFait(index: number, direction: -1 | 1) {
    updateUne(draft => {
      const arr = draft.faits_du_jour;
      const target = index + direction;
      if (target < 0 || target >= arr.length) return;
      [arr[index], arr[target]] = [arr[target], arr[index]];
    });
  }

  function handleDeleteFait(index: number) {
    updateUne(draft => { draft.faits_du_jour.splice(index, 1); });
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Édition du jour</h1>
            {isCurrentEdition && <StatusBadge status={meta.status} />}
          </div>
          <p className="text-gris-texte text-[14px]">
            {une?.date || 'Aucune édition'}{' '}
            {fileDate && <>· modifié {new Date(fileDate).toLocaleString('fr-FR')}</>}
            {une?.meta?.modele && <span className="ml-2 font-mono text-[12px] text-gris-clair">({une.meta.modele})</span>}
            {meta.lastEditedAt && <span className="ml-2 font-mono text-[12px] text-orange">· édité {new Date(meta.lastEditedAt).toLocaleString('fr-FR')}</span>}
          </p>
        </div>

        {/* Action buttons (only for current edition) */}
        {isCurrentEdition && une && (
          <div className="flex items-center gap-2 flex-wrap">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg border border-orange text-orange hover:bg-orange/5 cursor-pointer transition-colors"
              >
                Modifier
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setEditing(false); setUne(initialUne); }}
                  className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg border border-gris-chaud text-gris-texte hover:bg-creme cursor-pointer transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-bleu-rep text-white hover:opacity-90 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </>
            )}
            {!editing && meta.status !== 'published' && (
              <button
                onClick={handlePublish}
                disabled={isPending}
                className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg bg-vert text-white hover:opacity-90 cursor-pointer disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Publication...' : 'Bon à tirer'}
              </button>
            )}
            {!editing && meta.status === 'published' && (
              <button
                onClick={handleRevert}
                disabled={isPending}
                className="font-mono text-[13px] font-bold px-4 py-2 rounded-lg border border-rouge-doux text-rouge-doux hover:bg-rouge-doux/5 cursor-pointer disabled:opacity-50 transition-colors"
              >
                Repasser en brouillon
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 font-mono text-[14px] px-4 py-3 rounded-lg shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-vert text-white' : 'bg-rouge-doux text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Editorial alerts */}
          {isCurrentEdition && <AlertsPanel alerts={alerts} />}

          {une ? (
            <EditionContent
              une={une}
              editing={editing}
              onUpdate={updateUne}
              onMoveFait={handleMoveFait}
              onDeleteFait={handleDeleteFait}
            />
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Historique sidebar */}
        {history.length > 0 && (
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-8">
              <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">
                Historique ({history.length})
              </h3>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {history.map((ed) => {
                  const isActive = currentDate === ed.date;
                  return (
                    <Link
                      key={ed.date}
                      href={ed.date === history[0]?.date ? '/edition' : `/edition/${ed.date}`}
                      className={`block rounded-xl border p-3 no-underline transition-colors ${
                        isActive
                          ? 'bg-bleu-rep/5 border-bleu-rep/30'
                          : 'bg-blanc border-gris-chaud hover:border-bleu-rep/20 hover:bg-creme/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-mono text-[13px] font-bold ${isActive ? 'text-bleu-rep' : 'text-noir'}`}>
                          {formatDateFR(ed.date)}
                        </span>
                        {ed.categorie && (
                          <span className="font-mono text-[10px] font-bold uppercase bg-bleu-clair text-bleu-rep px-1.5 py-0.5 rounded">
                            {ed.categorie}
                          </span>
                        )}
                      </div>
                      <div className={`text-[14px] leading-tight line-clamp-2 ${isActive ? 'text-noir font-medium' : 'text-gris-texte'}`}>
                        {ed.titre_une}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 font-mono text-[11px] text-gris-clair">
                        <span>{ed.faits_count} faits</span>
                        <span>{ed.regards_count} regards</span>
                        {ed.modele && <span className="truncate">{ed.modele.split('/').pop()}</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-blanc rounded-xl border border-gris-chaud p-6 text-center py-16">
      <div className="text-[48px] opacity-30 mb-3">📰</div>
      <p className="text-[18px] text-gris-texte font-medium mb-1">Aucune édition générée</p>
      <p className="text-[15px] text-gris-clair">Lance &quot;Générer Une&quot; depuis le Dashboard</p>
    </div>
  );
}

function EditionContent({
  une,
  editing,
  onUpdate,
  onMoveFait,
  onDeleteFait,
}: {
  une: Une;
  editing: boolean;
  onUpdate: (updater: (draft: Une) => void) => void;
  onMoveFait: (index: number, direction: -1 | 1) => void;
  onDeleteFait: (index: number) => void;
}) {
  const faits: FaitDuJour[] = une.faits_du_jour || [];
  const regardsCroises: RegardsCroises[] = Array.isArray(une.regards_croises) ? une.regards_croises : une.regards_croises ? [une.regards_croises] : [];
  const regardEtranger: RegardEtranger[] = une.regard_etranger || [];
  const chiffre: ChiffreDuJour | null = une.chiffre_du_jour || null;
  const aSurveiller: ASurveiller[] = une.a_surveiller || [];

  return (
    <>
      {/* Une principale */}
      <div className={`bg-blanc rounded-xl border p-6 mb-6 ${editing ? 'border-orange/40 ring-1 ring-orange/20' : 'border-gris-chaud'}`}>
        {editing && <div className="font-mono text-[10px] uppercase tracking-[2px] text-orange mb-3 font-bold">Mode édition</div>}
        {une.categorie && <span className="font-mono text-[12px] font-bold uppercase bg-bleu-clair text-bleu-rep px-2 py-0.5 rounded">{une.categorie}</span>}
        <Editable
          value={une.titre_une}
          onChange={(v) => onUpdate(d => { d.titre_une = v; })}
          editing={editing}
          tag="h2"
          className="font-display text-[24px] font-black text-noir leading-tight mt-2"
        />
        <Editable
          value={une.accroche || ''}
          onChange={(v) => onUpdate(d => { d.accroche = v; })}
          editing={editing}
          tag="p"
          className="text-[16px] text-gris-texte mt-3 leading-relaxed"
          multiline
        />

        {chiffre && (
          <div className="mt-4 bg-creme rounded-lg p-4 flex items-start gap-3">
            <Editable
              value={chiffre.valeur}
              onChange={(v) => onUpdate(d => { d.chiffre_du_jour.valeur = v; })}
              editing={editing}
              className="font-display text-[28px] font-black text-rouge-rep leading-none shrink-0"
            />
            <div className="flex-1">
              <Editable
                value={chiffre.contexte}
                onChange={(v) => onUpdate(d => { d.chiffre_du_jour.contexte = v; })}
                editing={editing}
                tag="p"
                className="text-[14px] text-gris-texte"
                multiline
              />
              {chiffre.source && <p className="font-mono text-[12px] text-gris-clair mt-1">Source : {chiffre.source}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonne gauche : Faits */}
        <div>
          <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">Faits ({faits.length})</h3>
          <div className="space-y-3">
            {faits.map((f, i) => (
              <div key={i} className={`bg-blanc rounded-xl border p-4 ${editing ? 'border-orange/30' : 'border-gris-chaud'}`}>
                {editing && (
                  <div className="flex items-center gap-1 mb-2 -mt-1">
                    <button onClick={() => onMoveFait(i, -1)} disabled={i === 0} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-creme text-gris-texte hover:bg-gris-chaud cursor-pointer disabled:opacity-30">↑</button>
                    <button onClick={() => onMoveFait(i, 1)} disabled={i === faits.length - 1} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-creme text-gris-texte hover:bg-gris-chaud cursor-pointer disabled:opacity-30">↓</button>
                    <span className="flex-1" />
                    <button onClick={() => onDeleteFait(i)} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-rouge-doux/10 text-rouge-doux hover:bg-rouge-doux/20 cursor-pointer">Supprimer</button>
                  </div>
                )}
                <Editable
                  value={f.titre}
                  onChange={(v) => onUpdate(d => { d.faits_du_jour[i].titre = v; })}
                  editing={editing}
                  tag="div"
                  className="text-[16px] font-medium text-noir"
                />
                {f.categorie && <span className="inline-block mt-1 font-mono text-[11px] font-bold uppercase bg-creme text-gris-texte px-1.5 py-0.5 rounded">{f.categorie}</span>}
                <Editable
                  value={f.resume}
                  onChange={(v) => onUpdate(d => { d.faits_du_jour[i].resume = v; })}
                  editing={editing}
                  tag="p"
                  className="text-[14px] text-gris-texte mt-2"
                  multiline
                />
                {f.sources && f.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.sources.map((s, j) => (
                      <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-bleu-rep bg-bleu-clair px-1.5 py-0.5 rounded no-underline hover:underline">{s.nom}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Colonne droite : Regards croisés + Regard étranger + À surveiller */}
        <div className="space-y-6">
          {regardsCroises.length > 0 && (
            <div>
              <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">Regards croisés ({regardsCroises.length})</h3>
              <div className="space-y-4">
                {regardsCroises.map((rc, i) => (
                  <div key={i} className={`bg-blanc rounded-xl border p-4 ${editing ? 'border-orange/30' : 'border-gris-chaud'}`}>
                    <Editable
                      value={rc.sujet}
                      onChange={(v) => onUpdate(d => { const arr = Array.isArray(d.regards_croises) ? d.regards_croises : [d.regards_croises]; arr[i].sujet = v; })}
                      editing={editing}
                      tag="div"
                      className="text-[16px] font-medium text-noir mb-2"
                    />
                    {rc.contexte && (
                      <Editable
                        value={rc.contexte}
                        onChange={(v) => onUpdate(d => { const arr = Array.isArray(d.regards_croises) ? d.regards_croises : [d.regards_croises]; arr[i].contexte = v; })}
                        editing={editing}
                        tag="p"
                        className="text-[14px] text-gris-texte mb-3"
                        multiline
                      />
                    )}

                    {rc.couvertures?.map((c, j) => (
                      <div key={j} className="pl-3 border-l-2 border-gris-chaud mb-3 last:mb-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[12px] font-bold text-gris-texte uppercase">{c.source}</span>
                          {c.ton && <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            c.ton === 'critique' ? 'bg-rouge-doux/10 text-rouge-doux' :
                            c.ton === 'alarmiste' ? 'bg-orange/10 text-orange' :
                            c.ton === 'complaisant' ? 'bg-orange/10 text-orange' :
                            c.ton === 'engage' ? 'bg-bleu-rep/10 text-bleu-rep' :
                            'bg-gris-chaud text-gris-texte'
                          }`}>{c.ton}</span>}
                          {c.orientation_source && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gris-texte">{c.orientation_source}</span>}
                        </div>
                        {c.groupe_media && (
                          <div className="font-mono text-[11px] text-gris-clair mt-0.5">{c.groupe_media.nom} — {c.groupe_media.proprietaire} [{c.groupe_media.type_proprietaire}]</div>
                        )}
                        {c.auteur && <div className="font-mono text-[11px] text-gris-clair mt-0.5">{c.auteur}</div>}
                        <Editable
                          value={c.angle}
                          onChange={(v) => onUpdate(d => {
                            const arr = Array.isArray(d.regards_croises) ? d.regards_croises : [d.regards_croises];
                            arr[i].couvertures[j].angle = v;
                          })}
                          editing={editing}
                          tag="p"
                          className="text-[13px] text-gris-texte mt-1"
                          multiline
                        />
                        {c.proprietaire_contexte && <p className="text-[11px] text-gris-clair mt-0.5 font-mono">{c.proprietaire_contexte}</p>}
                        {c.citation_cle && <p className="text-[12px] text-gris-clair italic mt-1">{c.citation_cle}</p>}
                      </div>
                    ))}

                    {rc.analyse_coherence && (
                      <div className="mt-3 bg-bleu-clair rounded px-3 py-2">
                        <span className="font-mono text-[11px] font-bold text-bleu-rep uppercase">Analyse</span>
                        <Editable
                          value={rc.analyse_coherence}
                          onChange={(v) => onUpdate(d => {
                            const arr = Array.isArray(d.regards_croises) ? d.regards_croises : [d.regards_croises];
                            arr[i].analyse_coherence = v;
                          })}
                          editing={editing}
                          tag="p"
                          className="text-[13px] text-bleu-rep/80 mt-1 leading-relaxed"
                          multiline
                        />
                      </div>
                    )}

                    {rc.biais_detectes && rc.biais_detectes.length > 0 && (
                      <div className="mt-2">
                        <span className="font-mono text-[11px] font-bold text-orange uppercase">Biais détectés</span>
                        <ul className="mt-1 space-y-0.5">
                          {rc.biais_detectes.map((b: string, k: number) => (
                            <li key={k} className="text-[12px] text-gris-texte">{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {rc.verdict_citoyens && (
                      <div className="mt-2 bg-vert/5 rounded px-3 py-2">
                        <span className="font-mono text-[11px] font-bold text-vert uppercase">Verdict citoyens</span>
                        <Editable
                          value={rc.verdict_citoyens}
                          onChange={(v) => onUpdate(d => {
                            const arr = Array.isArray(d.regards_croises) ? d.regards_croises : [d.regards_croises];
                            arr[i].verdict_citoyens = v;
                          })}
                          editing={editing}
                          tag="p"
                          className="text-[13px] text-vert/80 mt-1"
                          multiline
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {regardEtranger.length > 0 && (
            <div>
              <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">Regard étranger ({regardEtranger.length})</h3>
              <div className="space-y-2">
                {regardEtranger.map((a, i) => (
                  <div key={i} className={`bg-blanc rounded-xl border p-3 ${editing ? 'border-orange/30' : 'border-gris-chaud'}`}>
                    <div className="font-mono text-[12px] text-gris-clair">{a.source} · {a.pays}</div>
                    <Editable
                      value={a.titre}
                      onChange={(v) => onUpdate(d => { d.regard_etranger[i].titre = v; })}
                      editing={editing}
                      tag="div"
                      className="text-[15px] font-medium text-noir mt-1"
                    />
                    {a.titre_original && a.titre_original !== a.titre && (
                      <div className="text-[12px] text-gris-clair italic mt-0.5">{a.titre_original}</div>
                    )}
                    <Editable
                      value={a.resume}
                      onChange={(v) => onUpdate(d => { d.regard_etranger[i].resume = v; })}
                      editing={editing}
                      tag="p"
                      className="text-[13px] text-gris-texte mt-1"
                      multiline
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {aSurveiller.length > 0 && (
            <div>
              <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">À surveiller ({aSurveiller.length})</h3>
              <div className="space-y-2">
                {aSurveiller.map((e, i) => (
                  <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-3 flex items-start gap-3">
                    <span className="font-mono text-[12px] text-gris-clair whitespace-nowrap">{e.date}</span>
                    <div>
                      <div className="text-[14px] text-noir">{e.evenement}</div>
                      {e.type && <span className="font-mono text-[10px] text-gris-clair uppercase">{e.type}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function formatDateFR(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}
