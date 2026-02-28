'use server';

import { getEditionHistory, getUneByDate, computeEditorialAlerts, type EditorialAlert } from '@/lib/local-data';
import type { Une } from '@/lib/types';

export interface TopicFrequency {
  topic: string;
  count: number;
  dates: string[];
  lastSeen: string;
}

export interface WeeklySummary {
  weekLabel: string;
  editionCount: number;
  totalFaits: number;
  totalRegards: number;
  totalEtranger: number;
  avgSourcesPerEdition: number;
  topCategories: Array<{ name: string; count: number }>;
  topSources: Array<{ name: string; count: number }>;
  alerts: EditorialAlert[];
}

export interface EditorialDashboardData {
  currentWeek: WeeklySummary;
  recurringTopics: TopicFrequency[];
  blindSpots: string[];
  coverageByCategory: Record<string, number>;
  totalEditions: number;
}

export async function loadEditorialDashboard(): Promise<EditorialDashboardData> {
  const history = await getEditionHistory();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStr = `${oneWeekAgo.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;

  const thisWeekEditions = history.filter(e => new Date(e.date + 'T12:00:00') >= oneWeekAgo);

  // Load full editions for deeper analysis
  const fullEditions: Array<{ date: string; une: Une }> = [];
  for (const ed of history.slice(0, 14)) {
    const une = await getUneByDate(ed.date);
    if (une) fullEditions.push({ date: ed.date, une });
  }

  // Build topic frequency
  const topicMap = new Map<string, { count: number; dates: string[] }>();
  for (const { date, une } of fullEditions) {
    for (const f of une.faits_du_jour || []) {
      const key = f.titre.toLowerCase().slice(0, 60);
      const existing = topicMap.get(key);
      if (existing) {
        existing.count++;
        existing.dates.push(date);
      } else {
        topicMap.set(key, { count: 1, dates: [date] });
      }
    }
    for (const rc of (Array.isArray(une.regards_croises) ? une.regards_croises : [])) {
      const key = rc.sujet.toLowerCase().slice(0, 60);
      const existing = topicMap.get(key);
      if (existing) {
        existing.count++;
        existing.dates.push(date);
      } else {
        topicMap.set(key, { count: 1, dates: [date] });
      }
    }
  }

  const recurringTopics: TopicFrequency[] = [...topicMap.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([topic, v]) => ({
      topic,
      count: v.count,
      dates: v.dates,
      lastSeen: v.dates.sort().pop() || '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Coverage by category
  const categoryCount: Record<string, number> = {};
  for (const { une } of fullEditions) {
    for (const f of une.faits_du_jour || []) {
      if (f.categorie) categoryCount[f.categorie] = (categoryCount[f.categorie] || 0) + 1;
    }
  }

  // Compute blind spots (expected categories that are absent)
  const expectedCategories = ['politique', 'economie', 'societe', 'international', 'ecologie', 'culture', 'justice', 'sante', 'numerique'];
  const coveredCategories = new Set(Object.keys(categoryCount).map(c => c.toLowerCase()));
  const blindSpots = expectedCategories.filter(c => !coveredCategories.has(c));

  // Weekly summary
  let weekTotalFaits = 0;
  let weekTotalRegards = 0;
  let weekTotalEtranger = 0;
  let weekTotalSources = 0;
  const weekCats: Record<string, number> = {};
  const weekSources: Record<string, number> = {};
  let weekAlerts: EditorialAlert[] = [];

  for (const ed of thisWeekEditions) {
    const une = fullEditions.find(f => f.date === ed.date)?.une;
    if (!une) continue;

    weekTotalFaits += une.faits_du_jour?.length || 0;
    weekTotalRegards += (Array.isArray(une.regards_croises) ? une.regards_croises : []).length;
    weekTotalEtranger += une.regard_etranger?.length || 0;

    for (const f of une.faits_du_jour || []) {
      if (f.categorie) weekCats[f.categorie] = (weekCats[f.categorie] || 0) + 1;
      for (const s of f.sources || []) {
        weekSources[s.nom] = (weekSources[s.nom] || 0) + 1;
        weekTotalSources++;
      }
    }

    const alerts = await computeEditorialAlerts(une);
    weekAlerts = weekAlerts.concat(alerts);
  }

  const currentWeek: WeeklySummary = {
    weekLabel: weekStr,
    editionCount: thisWeekEditions.length,
    totalFaits: weekTotalFaits,
    totalRegards: weekTotalRegards,
    totalEtranger: weekTotalEtranger,
    avgSourcesPerEdition: thisWeekEditions.length > 0 ? Math.round(weekTotalSources / thisWeekEditions.length) : 0,
    topCategories: Object.entries(weekCats).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    topSources: Object.entries(weekSources).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    alerts: weekAlerts,
  };

  return {
    currentWeek,
    recurringTopics,
    blindSpots,
    coverageByCategory: categoryCount,
    totalEditions: history.length,
  };
}
