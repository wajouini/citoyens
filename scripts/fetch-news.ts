/**
 * fetch-news.ts — Aggregate 25+ RSS feeds for daily news curation
 *
 * Fetches French + international political news, filters last 24h,
 * and writes a normalized intermediate JSON for Claude API processing.
 *
 * Usage: npx tsx scripts/fetch-news.ts
 */

import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ---------- Types ----------

type FeedType = 'investigation' | 'mainstream' | 'fact-check' | 'institutionnel' | 'etranger';
type Rubrique = 'politique' | 'economie' | 'tech' | 'science' | 'societe' | 'culture' | 'international' | 'generaliste';

interface FeedSource {
  nom: string;
  url: string;
  type: FeedType;
  rubrique: Rubrique;
  pays: string;
  langue: 'fr' | 'en' | 'de' | 'es';
  fiabilite: number; // 1-5
  groupe: string | null;
  orientation: string | null;
  ligne_editoriale: string | null;
}

export interface RawArticle {
  id: string;
  titre: string;
  description: string;
  url: string;
  source: string;
  type: FeedType;
  rubrique: Rubrique;
  pays: string;
  langue: string;
  date: string;
  fiabilite: number;
  auteur: string | null;
  groupe: string | null;
}

interface JournalisteEntry {
  nom: string;
  sources_vues: string[];
  nb_articles: number;
  premier_vu: string;
  dernier_vu: string;
}

// ---------- Feed Registry (loaded from shared feeds.json) ----------

const FEEDS: FeedSource[] = JSON.parse(
  readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8')
).filter((f: any) => f.active !== false);

// ---------- France keyword filter for foreign feeds ----------

const FRANCE_KEYWORDS = [
  'france', 'french', 'paris', 'macron', 'elysee', 'élysée',
  'assemblée nationale', 'national assembly', 'sénat', 'senate',
  'marine le pen', 'mélenchon', 'melenchon', 'barnier', 'bayrou',
  'lyon', 'marseille', 'toulouse', 'bordeaux', 'strasbourg',
  'gilets jaunes', 'yellow vest',
  'republique', 'république',
];

function mentionsFrance(text: string): boolean {
  const lower = text.toLowerCase();
  return FRANCE_KEYWORDS.some(kw => lower.includes(kw));
}

// ---------- Utilities ----------

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isWithin24h(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  const pubDate = new Date(dateStr);
  if (isNaN(pubDate.getTime())) return false;
  const now = Date.now();
  const diff = now - pubDate.getTime();
  return diff >= 0 && diff < 24 * 60 * 60 * 1000;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractAuthor(item: any): string | null {
  const raw = item.creator || item['dc:creator'] || item.author || null;
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^par\s+/i, '').replace(/^by\s+/i, '');
  if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return null;
  if (/^(rédaction|la rédaction|reuters|afp|ap|staff|admin)/i.test(cleaned)) return null;
  return cleaned;
}

function updateJournalistIndex(
  index: Record<string, JournalisteEntry>,
  auteur: string,
  source: string,
  date: string,
): void {
  const slug = slugify(auteur);
  if (!slug) return;
  const existing = index[slug];
  if (existing) {
    existing.nb_articles++;
    existing.dernier_vu = date > existing.dernier_vu ? date : existing.dernier_vu;
    if (!existing.sources_vues.includes(source)) existing.sources_vues.push(source);
  } else {
    index[slug] = {
      nom: auteur,
      sources_vues: [source],
      nb_articles: 1,
      premier_vu: date,
      dernier_vu: date,
    };
  }
}

// ---------- Main ----------

async function main() {
  const parser = new Parser({
    timeout: 15000,
    headers: {
      'User-Agent': 'Citoyens.ai/1.0 (civic tech news aggregator)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });

  console.log(`Fetching ${FEEDS.length} RSS feeds...`);

  // Fetch all feeds concurrently (fault-tolerant)
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return { feed, items: parsed.items || [] };
      } catch (err: any) {
        console.error(`  ✗ ${feed.nom}: ${err.message || err}`);
        throw err;
      }
    })
  );

  // Tally successes
  let successCount = 0;
  let totalItems = 0;
  const articles: RawArticle[] = [];

  for (const result of results) {
    if (result.status === 'rejected') continue;

    const { feed, items } = result.value;
    successCount++;

    for (const item of items) {
      const url = item.link || item.guid || '';
      if (!url) continue;

      const dateStr = item.isoDate || item.pubDate || '';
      if (!isWithin24h(dateStr)) continue;

      const titre = stripHtml(item.title || '');
      const description = stripHtml(
        item.contentSnippet || item.content || item.summary || item.description || ''
      ).slice(0, 500);

      if (!titre) continue;

      articles.push({
        id: hashUrl(url),
        titre,
        description,
        url,
        source: feed.nom,
        type: feed.type,
        rubrique: feed.rubrique || 'generaliste',
        pays: feed.pays,
        langue: feed.langue,
        date: new Date(dateStr).toISOString(),
        fiabilite: feed.fiabilite,
        auteur: extractAuthor(item),
        groupe: feed.groupe || null,
      });
      totalItems++;
    }
  }

  console.log(`\n✓ ${successCount}/${FEEDS.length} feeds fetched successfully`);
  console.log(`✓ ${totalItems} articles from the last 24h`);

  // Abort if too few feeds succeeded
  if (successCount < 5) {
    console.error('✗ Too few feeds succeeded (<5). Aborting.');
    process.exit(1);
  }

  // Deduplicate by URL hash
  const seen = new Set<string>();
  const deduped = articles.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Sort by date (newest first), then by reliability
  deduped.sort((a, b) => {
    const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return b.fiabilite - a.fiabilite;
  });

  // Stats by type and rubrique
  const byType: Record<string, number> = {};
  const byRubrique: Record<string, number> = {};
  for (const a of deduped) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    byRubrique[a.rubrique] = (byRubrique[a.rubrique] || 0) + 1;
  }

  console.log(`✓ ${deduped.length} articles after deduplication`);
  console.log(`  By type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  By rubrique: ${Object.entries(byRubrique).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // Build / update journalist index
  const outputDir = new URL('../src/data/.pipeline/', import.meta.url);
  mkdirSync(outputDir, { recursive: true });

  const journalistIndexPath = new URL('journalistes-index.json', outputDir);
  let journalistIndex: Record<string, JournalisteEntry> = {};
  try {
    journalistIndex = JSON.parse(readFileSync(journalistIndexPath, 'utf-8'));
  } catch { /* first run or missing file */ }

  let authorCount = 0;
  for (const a of deduped) {
    if (a.auteur) {
      updateJournalistIndex(journalistIndex, a.auteur, a.source, a.date);
      authorCount++;
    }
  }

  writeFileSync(journalistIndexPath, JSON.stringify(journalistIndex, null, 2), 'utf-8');
  console.log(`✓ ${authorCount} articles with identified author`);
  console.log(`✓ ${Object.keys(journalistIndex).length} journalists in index`);

  // Write output
  const outputPath = new URL('raw-articles.json', outputDir);
  writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf-8');

  console.log(`\n✓ Wrote ${deduped.length} articles to src/data/.pipeline/raw-articles.json`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Pipeline fetch-news failed:', err);
  process.exit(1);
});
