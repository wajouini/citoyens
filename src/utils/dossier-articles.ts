/**
 * dossier-articles.ts
 *
 * Scans edition archives and matches articles to dossiers by keyword.
 * Used on dossier pages to display "Dans l'actualité récente".
 *
 * Each archive entry can come from the morning edition (une.json shape)
 * or the evening edition (soir.json shape).
 */

export interface ArticleLie {
  date: string;
  titre: string;
  resume?: string;
  rubrique?: string;
  edition: 'matin' | 'soir';
  /** Link to the archive page */
  href: string;
}

interface EditionMatinItem {
  titre?: string;
  resume?: string;
  rubrique?: string;
  pourquoi_important?: string;
  contexte?: string;
}

interface EditionMatin {
  date: string;
  sujet_du_jour?: EditionMatinItem;
  france?: EditionMatinItem[];
  monde?: EditionMatinItem[];
}

interface EditionSoir {
  date: string;
  analyse_approfondie?: { sujet?: string; contexte_long?: string; rubrique?: string };
  bilan_journee?: { resume?: string; faits_marquants?: string[] };
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents for matching
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const normText = normalise(text);
  return keywords.some(kw => normText.includes(normalise(kw)));
}

function extractMatinItems(data: EditionMatin): EditionMatinItem[] {
  const items: EditionMatinItem[] = [];
  if (data.sujet_du_jour) items.push(data.sujet_du_jour);
  if (data.france) items.push(...data.france);
  if (data.monde) items.push(...data.monde);
  return items;
}

/**
 * Returns articles from archives that match the given keywords.
 * Sorted by date descending (most recent first).
 * Capped at `limit` results.
 */
export async function getArticlesLies(
  mots_cles: string[],
  limit = 6
): Promise<ArticleLie[]> {
  if (!mots_cles || mots_cles.length === 0) return [];

  const results: ArticleLie[] = [];

  // Dynamically import all archive files
  const archives = import.meta.glob('/src/data/archives/*.json', { eager: true });

  for (const [path, module] of Object.entries(archives)) {
    const data = (module as any).default ?? module;
    if (!data || typeof data !== 'object') continue;

    // Extract date and edition type from filename
    // e.g. /src/data/archives/2026-02-28-soir.json
    const filename = path.split('/').pop() ?? '';
    const isSoir = filename.includes('-soir');
    const date = filename.replace('-soir', '').replace('.json', '');
    const href = isSoir ? `/edition/${date}-soir` : `/edition/${date}`;

    if (isSoir) {
      const soir = data as EditionSoir;
      const textToSearch = [
        soir.analyse_approfondie?.sujet ?? '',
        soir.analyse_approfondie?.contexte_long ?? '',
        soir.bilan_journee?.resume ?? '',
        ...(soir.bilan_journee?.faits_marquants ?? []),
      ].join(' ');

      if (matchesKeywords(textToSearch, mots_cles)) {
        results.push({
          date,
          titre: soir.analyse_approfondie?.sujet ?? `Bilan du soir — ${date}`,
          resume: soir.bilan_journee?.resume?.slice(0, 160),
          rubrique: soir.analyse_approfondie?.rubrique,
          edition: 'soir',
          href,
        });
      }
    } else {
      const matin = data as EditionMatin;
      const items = extractMatinItems(matin);

      for (const item of items) {
        const textToSearch = [
          item.titre ?? '',
          item.resume ?? '',
          item.pourquoi_important ?? '',
          item.contexte ?? '',
        ].join(' ');

        if (matchesKeywords(textToSearch, mots_cles)) {
          results.push({
            date,
            titre: item.titre ?? `Édition du ${date}`,
            resume: (item.resume ?? item.pourquoi_important ?? '').slice(0, 160),
            rubrique: item.rubrique,
            edition: 'matin',
            href,
          });
          // Only one match per morning edition to avoid duplicates
          break;
        }
      }
    }
  }

  // Sort by date descending, cap at limit
  return results
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
