'use client';

import Link from 'next/link';
import type { EditorialDashboardData, TopicFrequency, WeeklySummary } from '@/actions/editorial';
import type { EditorialAlert } from '@/lib/local-data';

function formatDateFR(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

export function EditorialDashboardClient({ data }: { data: EditorialDashboardData }) {
  const { currentWeek, recurringTopics, blindSpots, coverageByCategory, totalEditions } = data;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-black text-noir tracking-tight">Tableau de bord éditorial</h1>
        <p className="text-gris-texte text-[14px] mt-1">
          Vue d'ensemble de la couverture éditoriale — {totalEditions} éditions analysées
        </p>
      </div>

      {/* Weekly summary */}
      <div className="bg-blanc rounded-xl border border-gris-chaud p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold">
            Ma semaine · {currentWeek.weekLabel}
          </h2>
          <span className="font-mono text-[12px] text-gris-clair">{currentWeek.editionCount} édition{currentWeek.editionCount !== 1 ? 's' : ''}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <WeekKPI label="Faits" value={currentWeek.totalFaits} />
          <WeekKPI label="Regards" value={currentWeek.totalRegards} />
          <WeekKPI label="Étranger" value={currentWeek.totalEtranger} />
          <WeekKPI label="Sources / éd." value={currentWeek.avgSourcesPerEdition} />
          <WeekKPI label="Alertes" value={currentWeek.alerts.length} color={currentWeek.alerts.length > 3 ? 'text-orange' : 'text-vert'} />
        </div>

        {currentWeek.topCategories.length > 0 && (
          <div className="mb-4">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Catégories couvertes</div>
            <div className="flex flex-wrap gap-2">
              {currentWeek.topCategories.map(c => (
                <span key={c.name} className="font-mono text-[12px] bg-creme text-gris-texte px-2.5 py-1 rounded-lg">
                  {c.name} <span className="text-bleu-rep font-bold">{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {currentWeek.topSources.length > 0 && (
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Top sources citées</div>
            <div className="flex flex-wrap gap-2">
              {currentWeek.topSources.slice(0, 8).map(s => (
                <span key={s.name} className="font-mono text-[12px] bg-bleu-clair text-bleu-rep px-2.5 py-1 rounded-lg">
                  {s.name} <span className="font-bold">{s.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Blind spots */}
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">Angles morts</h2>
          {blindSpots.length > 0 ? (
            <div className="space-y-2">
              {blindSpots.map(cat => (
                <div key={cat} className="flex items-center gap-2 bg-orange/5 border border-orange/20 rounded-lg px-3 py-2">
                  <span className="text-orange font-mono text-[14px]">!</span>
                  <span className="text-[14px] text-noir capitalize">{cat}</span>
                  <span className="text-[12px] text-gris-clair ml-auto">Absent des dernières éditions</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-vert/5 rounded-lg p-4 text-center">
              <div className="font-mono text-[14px] text-vert font-bold">Toutes les rubriques sont couvertes</div>
              <p className="text-[13px] text-gris-texte mt-1">Aucun angle mort détecté</p>
            </div>
          )}

          {/* Category coverage breakdown */}
          <div className="mt-4 pt-4 border-t border-gris-chaud">
            <div className="font-mono text-[11px] uppercase tracking-[2px] text-gris-clair mb-2">Couverture par catégorie (total)</div>
            <div className="space-y-1.5">
              {Object.entries(coverageByCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                const max = Math.max(...Object.values(coverageByCategory));
                const pct = max > 0 ? Math.round((count / max) * 100) : 0;
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <div className="w-24 font-mono text-[12px] text-gris-texte truncate capitalize">{cat}</div>
                    <div className="flex-1 bg-creme rounded-full h-2.5 overflow-hidden">
                      <div className="h-full rounded-full bg-bleu-rep" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-8 text-right font-mono text-[12px] text-noir font-bold">{count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Recurring topics */}
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">
            Sujets récurrents ({recurringTopics.length})
          </h2>
          {recurringTopics.length > 0 ? (
            <div className="space-y-3">
              {recurringTopics.map((t) => (
                <div key={t.topic} className="border-b border-gris-chaud/30 pb-2 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[14px] text-noir capitalize leading-snug flex-1">{t.topic}</div>
                    <span className="font-mono text-[13px] text-bleu-rep font-bold shrink-0">{t.count}x</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {t.dates.map(d => (
                      <Link key={d} href={`/edition/${d}`} className="font-mono text-[10px] text-gris-clair bg-creme px-1.5 py-0.5 rounded no-underline hover:text-bleu-rep">
                        {formatDateFR(d)}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-[14px] text-gris-clair">Pas encore assez d'éditions pour détecter des récurrences</p>
            </div>
          )}
        </div>
      </div>

      {/* Week alerts */}
      {currentWeek.alerts.length > 0 && (
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[2px] text-noir font-bold mb-4">
            Alertes de la semaine ({currentWeek.alerts.length})
          </h2>
          <div className="space-y-2">
            {currentWeek.alerts.map((a, i) => (
              <AlertRow key={i} alert={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekKPI({ label, value, color = 'text-noir' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-creme rounded-lg p-3 text-center">
      <div className={`font-mono text-[22px] font-bold leading-none ${color}`}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-gris-clair mt-1">{label}</div>
    </div>
  );
}

function AlertRow({ alert }: { alert: EditorialAlert }) {
  const colorMap = {
    warning: 'text-orange bg-orange/5 border-orange/20',
    error: 'text-rouge-doux bg-rouge-doux/5 border-rouge-doux/20',
    info: 'text-bleu-rep bg-bleu-clair border-bleu-rep/20',
  };
  const iconMap = { warning: '⚠', error: '✗', info: 'i' };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${colorMap[alert.type]}`}>
      <span className="font-mono text-[13px] shrink-0">{iconMap[alert.type]}</span>
      <div>
        <div className="text-[13px] font-medium">{alert.message}</div>
        {alert.detail && <div className="text-[11px] opacity-70 mt-0.5">{alert.detail}</div>}
      </div>
    </div>
  );
}
