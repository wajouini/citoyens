'use client';

import Link from 'next/link';
import type { Une, FaitDuJour, RegardEtranger, RegardsCroises, Couverture, ASurveiller, ChiffreDuJour } from '@/lib/types';
import type { EditionSummary } from '@/lib/local-data';

export function EditionClient({
  une,
  fileDate,
  history = [],
  selectedDate,
}: {
  une: Une | null;
  fileDate: string | null;
  history?: EditionSummary[];
  selectedDate?: string;
}) {
  const currentDate = selectedDate || une?.date;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Édition du jour</h1>
        <p className="text-gris-texte text-[16px] mt-1">
          {une?.date || 'Aucune édition'}{' '}
          {fileDate && <>· modifié {new Date(fileDate).toLocaleString('fr-FR')}</>}
          {une?.meta?.modele && <span className="ml-2 font-mono text-[12px] text-gris-clair">({une.meta.modele})</span>}
        </p>
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {une ? <EditionContent une={une} /> : <EmptyState />}
        </div>

        {/* Historique sidebar */}
        {history.length > 0 && (
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-8">
              <h3 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-3">
                Historique ({history.length})
              </h3>
              <div className="space-y-2">
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

function EditionContent({ une }: { une: Une }) {
  const faits: FaitDuJour[] = une.faits_du_jour || [];
  const regardsCroises: RegardsCroises[] = Array.isArray(une.regards_croises) ? une.regards_croises : une.regards_croises ? [une.regards_croises] : [];
  const regardEtranger: RegardEtranger[] = une.regard_etranger || [];
  const chiffre: ChiffreDuJour | null = une.chiffre_du_jour || null;
  const aSurveiller: ASurveiller[] = une.a_surveiller || [];

  return (
    <>
      {/* Une principale */}
      <div className="bg-blanc rounded-xl border border-gris-chaud p-6 mb-6">
        {une.categorie && <span className="font-mono text-[12px] font-bold uppercase bg-bleu-clair text-bleu-rep px-2 py-0.5 rounded">{une.categorie}</span>}
        <h2 className="font-display text-[24px] font-black text-noir leading-tight mt-2">{une.titre_une}</h2>
        {une.accroche && <p className="text-[16px] text-gris-texte mt-3 leading-relaxed">{une.accroche}</p>}

        {chiffre && (
          <div className="mt-4 bg-creme rounded-lg p-4 flex items-start gap-3">
            <span className="font-display text-[28px] font-black text-rouge-rep leading-none">{chiffre.valeur}</span>
            <div>
              <p className="text-[14px] text-gris-texte">{chiffre.contexte}</p>
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
              <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4">
                <div className="text-[16px] font-medium text-noir">{f.titre}</div>
                {f.categorie && <span className="inline-block mt-1 font-mono text-[11px] font-bold uppercase bg-creme text-gris-texte px-1.5 py-0.5 rounded">{f.categorie}</span>}
                <p className="text-[14px] text-gris-texte mt-2">{f.resume}</p>
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
                  <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4">
                    <div className="text-[16px] font-medium text-noir mb-2">{rc.sujet}</div>
                    {rc.contexte && <p className="text-[14px] text-gris-texte mb-3">{rc.contexte}</p>}

                    {/* Couvertures */}
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
                        {c.auteur && <div className="font-mono text-[11px] text-gris-clair mt-0.5">✍ {c.auteur}</div>}
                        <p className="text-[13px] text-gris-texte mt-1">{c.angle}</p>
                        {c.proprietaire_contexte && <p className="text-[11px] text-gris-clair mt-0.5 font-mono">{c.proprietaire_contexte}</p>}
                        {c.citation_cle && <p className="text-[12px] text-gris-clair italic mt-1">« {c.citation_cle} »</p>}
                      </div>
                    ))}

                    {/* Analyse de cohérence */}
                    {rc.analyse_coherence && (
                      <div className="mt-3 bg-bleu-clair rounded px-3 py-2">
                        <span className="font-mono text-[11px] font-bold text-bleu-rep uppercase">Analyse</span>
                        <p className="text-[13px] text-bleu-rep/80 mt-1 leading-relaxed">{rc.analyse_coherence}</p>
                      </div>
                    )}

                    {/* Biais détectés */}
                    {rc.biais_detectes && rc.biais_detectes.length > 0 && (
                      <div className="mt-2">
                        <span className="font-mono text-[11px] font-bold text-orange uppercase">Biais détectés</span>
                        <ul className="mt-1 space-y-0.5">
                          {rc.biais_detectes.map((b: string, k: number) => (
                            <li key={k} className="text-[12px] text-gris-texte">• {b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Verdict citoyens */}
                    {rc.verdict_citoyens && (
                      <div className="mt-2 bg-vert/5 rounded px-3 py-2">
                        <span className="font-mono text-[11px] font-bold text-vert uppercase">Verdict citoyens</span>
                        <p className="text-[13px] text-vert/80 mt-1">{rc.verdict_citoyens}</p>
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
                  <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-3">
                    <div className="font-mono text-[12px] text-gris-clair">{a.source} · {a.pays}</div>
                    <div className="text-[15px] font-medium text-noir mt-1">{a.titre}</div>
                    {a.titre_original && a.titre_original !== a.titre && (
                      <div className="text-[12px] text-gris-clair italic mt-0.5">{a.titre_original}</div>
                    )}
                    <p className="text-[13px] text-gris-texte mt-1">{a.resume}</p>
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
