'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Une, FaitDuJour, RegardEtranger, RegardsCroises, ChiffreDuJour, ASurveiller } from '@/lib/types';
import type { EditionMeta } from '@/lib/local-data';

export function PreviewClient({ une, meta }: { une: Une | null; meta: EditionMeta }) {
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [annotations, setAnnotations] = useState<Record<string, string>>({});
  const [annotationInput, setAnnotationInput] = useState('');
  const [annotationTarget, setAnnotationTarget] = useState<string | null>(null);

  if (!une) {
    return (
      <div className="p-8 text-center py-20">
        <div className="text-[48px] opacity-30 mb-3">📰</div>
        <p className="text-[18px] text-gris-texte">Aucune édition à prévisualiser</p>
        <Link href="/edition" className="font-mono text-[14px] text-bleu-rep mt-2 inline-block no-underline hover:underline">← Retour à l'édition</Link>
      </div>
    );
  }

  const faits = une.faits_du_jour || [];
  const regardsCroises = Array.isArray(une.regards_croises) ? une.regards_croises : une.regards_croises ? [une.regards_croises] : [];
  const regardEtranger = une.regard_etranger || [];
  const chiffre = une.chiffre_du_jour || null;
  const aSurveiller = une.a_surveiller || [];

  const statusLabel = { draft: 'Brouillon', reviewed: 'Relu', published: 'Publié' }[meta.status];
  const statusColor = { draft: 'bg-orange/10 text-orange', reviewed: 'bg-bleu-rep/10 text-bleu-rep', published: 'bg-vert/10 text-vert' }[meta.status];

  function addAnnotation(section: string) {
    if (!annotationInput.trim()) return;
    setAnnotations(prev => ({ ...prev, [section]: prev[section] ? `${prev[section]}\n${annotationInput}` : annotationInput }));
    setAnnotationInput('');
    setAnnotationTarget(null);
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/preview` : '';

  return (
    <div className="min-h-screen bg-creme">
      {/* Preview toolbar */}
      <div className="sticky top-0 z-40 bg-noir text-white py-2 px-6">
        <div className="max-w-[1000px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/edition" className="font-mono text-[12px] text-white/60 no-underline hover:text-white">← Édition</Link>
            <span className="text-white/30">|</span>
            <span className="font-mono text-[13px] font-bold">Prévisualisation</span>
            <span className={`font-mono text-[11px] font-bold uppercase px-2 py-0.5 rounded ${statusColor}`}>{statusLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className={`font-mono text-[12px] px-3 py-1 rounded cursor-pointer ${showAnnotations ? 'bg-orange text-white' : 'bg-white/10 text-white/70 hover:text-white'}`}
            >
              {showAnnotations ? 'Masquer notes' : 'Afficher notes'} ({Object.keys(annotations).length})
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(shareUrl); }}
              className="font-mono text-[12px] px-3 py-1 rounded bg-white/10 text-white/70 hover:text-white cursor-pointer"
            >
              Copier le lien
            </button>
          </div>
        </div>
      </div>

      {/* Public-style preview */}
      <div className="max-w-[800px] mx-auto px-6 py-10">
        {/* Header */}
        <header className="text-center mb-10 pb-6 border-b border-gris-chaud">
          <div className="font-display text-[14px] text-gris-clair uppercase tracking-[4px] mb-2">Citoyens.ai</div>
          <h1 className="font-display text-[36px] md:text-[44px] font-black text-noir leading-tight">{une.titre_une}</h1>
          {une.accroche && <p className="text-[18px] text-gris-texte mt-4 leading-relaxed max-w-[600px] mx-auto">{une.accroche}</p>}
          <div className="flex items-center justify-center gap-3 mt-4 font-mono text-[12px] text-gris-clair">
            {une.categorie && <span className="bg-bleu-clair text-bleu-rep px-2 py-0.5 rounded font-bold uppercase">{une.categorie}</span>}
            <span>{une.date}</span>
          </div>
        </header>

        <AnnotationBlock section="titre" annotations={annotations} show={showAnnotations} target={annotationTarget} input={annotationInput} onSetTarget={setAnnotationTarget} onSetInput={setAnnotationInput} onAdd={addAnnotation} />

        {/* Chiffre du jour */}
        {chiffre && (
          <div className="bg-blanc rounded-xl border border-gris-chaud p-6 mb-8 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-gris-clair mb-2">Chiffre du jour</div>
            <div className="font-display text-[40px] font-black text-rouge-rep">{chiffre.valeur}</div>
            <p className="text-[15px] text-gris-texte mt-2">{chiffre.contexte}</p>
            {chiffre.source && <p className="font-mono text-[12px] text-gris-clair mt-1">Source : {chiffre.source}</p>}
          </div>
        )}

        {/* Faits du jour */}
        {faits.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-[24px] font-black text-noir mb-4 pb-2 border-b-2 border-noir">Faits du jour</h2>
            <AnnotationBlock section="faits" annotations={annotations} show={showAnnotations} target={annotationTarget} input={annotationInput} onSetTarget={setAnnotationTarget} onSetInput={setAnnotationInput} onAdd={addAnnotation} />
            <div className="space-y-6">
              {faits.map((f, i) => (
                <article key={i} className="border-b border-gris-chaud pb-5 last:border-0">
                  <h3 className="text-[19px] font-bold text-noir leading-snug">{f.titre}</h3>
                  {f.categorie && <span className="inline-block mt-1 font-mono text-[11px] font-bold uppercase text-gris-clair">{f.categorie}</span>}
                  <p className="text-[16px] text-gris-texte mt-2 leading-relaxed">{f.resume}</p>
                  {f.sources && f.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {f.sources.map((s, j) => (
                        <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-bleu-rep no-underline hover:underline">{s.nom}</a>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Regards croisés */}
        {regardsCroises.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-[24px] font-black text-noir mb-4 pb-2 border-b-2 border-noir">Regards croisés</h2>
            <AnnotationBlock section="regards" annotations={annotations} show={showAnnotations} target={annotationTarget} input={annotationInput} onSetTarget={setAnnotationTarget} onSetInput={setAnnotationInput} onAdd={addAnnotation} />
            <div className="space-y-8">
              {regardsCroises.map((rc, i) => (
                <div key={i}>
                  <h3 className="text-[19px] font-bold text-noir mb-1">{rc.sujet}</h3>
                  {rc.contexte && <p className="text-[15px] text-gris-texte mb-4">{rc.contexte}</p>}
                  <div className="space-y-3">
                    {rc.couvertures?.map((c, j) => (
                      <div key={j} className="pl-4 border-l-3 border-gris-chaud">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[13px] font-bold text-noir">{c.source}</span>
                          {c.ton && <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            c.ton === 'critique' ? 'bg-rouge-doux/10 text-rouge-doux' :
                            c.ton === 'factuel' ? 'bg-vert/10 text-vert' :
                            c.ton === 'alarmiste' ? 'bg-orange/10 text-orange' :
                            'bg-gris-chaud text-gris-texte'
                          }`}>{c.ton}</span>}
                        </div>
                        <p className="text-[14px] text-gris-texte">{c.angle}</p>
                        {c.citation_cle && <p className="text-[13px] italic text-gris-clair mt-1">{c.citation_cle}</p>}
                      </div>
                    ))}
                  </div>
                  {rc.analyse_coherence && (
                    <div className="mt-4 bg-bleu-clair rounded-lg px-4 py-3">
                      <div className="font-mono text-[11px] font-bold text-bleu-rep uppercase mb-1">Analyse</div>
                      <p className="text-[14px] text-bleu-rep/80">{rc.analyse_coherence}</p>
                    </div>
                  )}
                  {rc.verdict_citoyens && (
                    <div className="mt-3 bg-vert/5 rounded-lg px-4 py-3">
                      <div className="font-mono text-[11px] font-bold text-vert uppercase mb-1">Verdict citoyens</div>
                      <p className="text-[14px] text-vert/80">{rc.verdict_citoyens}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Regard étranger */}
        {regardEtranger.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-[24px] font-black text-noir mb-4 pb-2 border-b-2 border-noir">Regard étranger</h2>
            <div className="space-y-4">
              {regardEtranger.map((a, i) => (
                <div key={i} className="border-b border-gris-chaud pb-4 last:border-0">
                  <div className="font-mono text-[12px] text-gris-clair mb-1">{a.source} · {a.pays}</div>
                  <h3 className="text-[17px] font-bold text-noir">{a.titre}</h3>
                  {a.titre_original && a.titre_original !== a.titre && (
                    <div className="text-[13px] text-gris-clair italic">{a.titre_original}</div>
                  )}
                  <p className="text-[15px] text-gris-texte mt-1">{a.resume}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* À surveiller */}
        {aSurveiller.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-[24px] font-black text-noir mb-4 pb-2 border-b-2 border-noir">À surveiller</h2>
            <div className="space-y-2">
              {aSurveiller.map((e, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <span className="font-mono text-[12px] text-gris-clair whitespace-nowrap mt-0.5">{e.date}</span>
                  <div>
                    <div className="text-[15px] text-noir">{e.evenement}</div>
                    {e.type && <span className="font-mono text-[10px] text-gris-clair uppercase">{e.type}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer meta */}
        <div className="border-t border-gris-chaud pt-4 mt-8 font-mono text-[11px] text-gris-clair text-center">
          {une.meta && (
            <div className="flex items-center justify-center gap-4">
              <span>{une.meta.nb_articles_analyses} articles analysés</span>
              <span>{une.meta.sources_francaises} sources FR</span>
              <span>{une.meta.sources_etrangeres} sources INT</span>
              <span>{une.meta.modele}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnotationBlock({
  section,
  annotations,
  show,
  target,
  input,
  onSetTarget,
  onSetInput,
  onAdd,
}: {
  section: string;
  annotations: Record<string, string>;
  show: boolean;
  target: string | null;
  input: string;
  onSetTarget: (s: string | null) => void;
  onSetInput: (s: string) => void;
  onAdd: (s: string) => void;
}) {
  if (!show) return null;

  return (
    <div className="mb-3">
      {annotations[section] && (
        <div className="bg-orange/5 border border-orange/20 rounded-lg px-3 py-2 mb-2">
          <div className="font-mono text-[10px] uppercase tracking-[2px] text-orange mb-1">Note</div>
          <div className="text-[13px] text-gris-texte whitespace-pre-wrap">{annotations[section]}</div>
        </div>
      )}
      {target === section ? (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => onSetInput(e.target.value)}
            placeholder="Ajouter une note..."
            className="flex-1 border border-orange/30 rounded px-2 py-1 text-[13px] focus:outline-none focus:border-orange"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') onAdd(section); if (e.key === 'Escape') onSetTarget(null); }}
          />
          <button onClick={() => onAdd(section)} className="font-mono text-[11px] bg-orange text-white px-2 py-1 rounded cursor-pointer">OK</button>
          <button onClick={() => onSetTarget(null)} className="font-mono text-[11px] text-gris-clair cursor-pointer">Annuler</button>
        </div>
      ) : (
        <button onClick={() => onSetTarget(section)} className="font-mono text-[11px] text-orange/50 hover:text-orange cursor-pointer">
          + Ajouter une note
        </button>
      )}
    </div>
  );
}
