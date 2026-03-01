/**
 * section-data.ts — Helpers for section pages (Politique, Économie, Tech)
 *
 * Provides:
 * - normalizeTitle: lowercases + removes accents
 * - areSimilarTopics: detects overlap between two article titles
 * - dedupBriefings: filters briefings already covered by MDX articles
 * - pickFilItems: returns relevant fil items with fallback to recents
 */

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words too short or too common to be meaningful
const STOP_WORDS = new Set([
  'les', 'des', 'une', 'sur', 'pour', 'dans', 'avec', 'par', 'que', 'qui',
  'est', 'son', 'ses', 'leur', 'aux', 'mais', 'pas', 'tout', 'plus', 'cette',
  'apres', 'avant', 'sous', 'entre', 'vers', 'lors', 'dont', 'sans', 'comme',
  'the', 'and', 'for', 'with', 'from', 'that', 'this',
]);

function keywords(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
  );
}

export function areSimilarTopics(t1: string, t2: string): boolean {
  const k1 = keywords(t1);
  const k2 = keywords(t2);
  if (k1.size === 0 || k2.size === 0) return false;
  let overlap = 0;
  for (const w of k1) {
    if (k2.has(w)) overlap++;
  }
  // 2 shared keywords OR >30% of the smaller set
  return overlap >= 2 || overlap / Math.min(k1.size, k2.size) > 0.3;
}

export interface BriefingItem {
  titre: string;
  resume: string;
  rubrique?: string;
  pays?: string;
  contexte?: string;
  faits?: string[];
  sources?: Array<{ nom: string; url: string; type?: string }>;
}

/**
 * Returns briefings NOT already covered by any of the provided article titles.
 */
export function dedupBriefings(
  briefings: BriefingItem[],
  coveredTitles: string[],
): BriefingItem[] {
  const result: BriefingItem[] = [];
  const usedTitles: string[] = [...coveredTitles];

  for (const b of briefings) {
    if (!b.titre) continue;
    const alreadyCovered = usedTitles.some(t => areSimilarTopics(t, b.titre));
    if (!alreadyCovered) {
      result.push(b);
      usedTitles.push(b.titre);
    }
  }
  return result;
}

/**
 * Deduplicate an array of Astro content collection entries by topic similarity.
 * Keeps the first entry encountered for each topic cluster.
 * Entries with `estUne: true` are prioritized by sorting them first.
 */
export function dedupArticles<T extends { data: { titre: string; estUne?: boolean } }>(
  articles: T[],
): T[] {
  // estUne articles always come first so they're kept over duplicates
  const sorted = [...articles].sort((a, b) =>
    (b.data.estUne ? 1 : 0) - (a.data.estUne ? 1 : 0)
  );
  const result: T[] = [];
  const seenTitles: string[] = [];
  for (const article of sorted) {
    if (!seenTitles.some(t => areSimilarTopics(t, article.data.titre))) {
      result.push(article);
      seenTitles.push(article.data.titre);
    }
  }
  return result;
}

export interface FilItem {
  heure?: string;
  titre?: string;
  texte?: string;
  url?: string;
  source?: string;
  source_url?: string;
  rubrique?: string;
}

/**
 * Returns up to `limit` fil items for a section.
 * First tries rubriques matching the section, then falls back to recents.
 */
export function pickFilItems(
  allItems: FilItem[],
  rubriques: string[],
  limit = 8,
): FilItem[] {
  const matched = allItems.filter(i => i.rubrique && rubriques.includes(i.rubrique));
  if (matched.length >= 4) return matched.slice(0, limit);
  // fallback: fill from all items not already included
  const matchedUrls = new Set(matched.map(i => i.url));
  const extras = allItems.filter(i => !matchedUrls.has(i.url));
  return [...matched, ...extras].slice(0, limit);
}
