'use server';

import { getUne, getUneByDate, getEditionHistory, type EditionSummary } from '@/lib/local-data';
import type { Une } from '@/lib/types';

export interface EditionWithMetrics extends EditionSummary {
  etranger_count: number;
  a_surveiller_count: number;
  source_count: number;
  unique_groups: number;
  categories: string[];
}

export async function loadAllEditions(): Promise<EditionWithMetrics[]> {
  const history = await getEditionHistory();
  const results: EditionWithMetrics[] = [];

  for (const ed of history) {
    const une = await getUneByDate(ed.date);
    if (!une) {
      results.push({
        ...ed,
        etranger_count: 0,
        a_surveiller_count: 0,
        source_count: 0,
        unique_groups: 0,
        categories: [],
      });
      continue;
    }

    const sources = new Set<string>();
    const groups = new Set<string>();
    const categories = new Set<string>();

    for (const f of une.faits_du_jour || []) {
      if (f.categorie) categories.add(f.categorie);
      for (const s of f.sources || []) {
        sources.add(s.nom);
        if (s.groupe_media?.nom) groups.add(s.groupe_media.nom);
      }
    }
    for (const rc of (Array.isArray(une.regards_croises) ? une.regards_croises : [])) {
      for (const c of rc.couvertures || []) {
        sources.add(c.source);
        if (c.groupe_media?.nom) groups.add(c.groupe_media.nom);
      }
    }

    results.push({
      ...ed,
      etranger_count: une.regard_etranger?.length || 0,
      a_surveiller_count: une.a_surveiller?.length || 0,
      source_count: sources.size,
      unique_groups: groups.size,
      categories: [...categories],
    });
  }

  return results;
}

export async function loadEditionForDiff(date: string): Promise<Une | null> {
  return getUneByDate(date);
}
