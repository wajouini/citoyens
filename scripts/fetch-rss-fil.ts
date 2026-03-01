/**
 * fetch-rss-fil.ts
 *
 * Fetches raw RSS items from active feeds (no AI processing).
 * Writes results to public/data/fil.json for client-side refresh (15-min interval).
 *
 * Usage:  npx tsx scripts/fetch-rss-fil.ts
 * Cron:   every 15 minutes via Vercel cron or external scheduler
 */

import Parser from 'rss-parser';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface Feed {
  nom: string;
  url: string;
  type: string;
  rubrique: string;
  pays: string;
  langue: string;
  fiabilite: number;
  active: boolean;
  groupe: string;
  orientation: string;
}

interface FilItem {
  heure: string;
  titre: string;
  url: string;
  rubrique: string;
  source: string;
  source_url: string;
  pays: string;
  langue: string;
  type: string;
  orientation: string;
  isoDate: string;
}

const RUBRIQUES_CANON: Record<string, string> = {
  generaliste: 'general',
  politique:   'politique',
  economie:    'economie',
  tech:        'tech',
  science:     'science',
  societe:     'societe',
  culture:     'culture',
  international: 'international',
  ia:          'tech',
};

const MAX_ITEMS_PER_FEED = 5;
const MAX_TOTAL_ITEMS    = 80;
const FETCH_TIMEOUT_MS   = 8_000;

async function fetchFeedWithTimeout(parser: Parser, url: string): Promise<Parser.Output<Parser.Item>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const feed = await parser.parseURL(url);
    return feed;
  } finally {
    clearTimeout(timer);
  }
}

function toHeure(dateStr: string | undefined): string {
  if (!dateStr) return '--:--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

function getIso(item: Parser.Item): string {
  return item.isoDate ?? item.pubDate ?? new Date(0).toISOString();
}

async function main() {
  const feedsPath = join(ROOT, 'src/data/feeds.json');
  const feeds: Feed[] = JSON.parse(readFileSync(feedsPath, 'utf-8'));
  const activeFeeds = feeds.filter(f => f.active);

  const parser = new Parser({
    requestOptions: { rejectUnauthorized: false },
    timeout: FETCH_TIMEOUT_MS,
    customFields: {
      item: [['media:content', 'mediaContent'], ['dc:creator', 'creator']],
    },
  });

  const allItems: FilItem[] = [];
  const seenUrls = new Set<string>();

  console.log(`Fetching ${activeFeeds.length} active feeds…`);

  const results = await Promise.allSettled(
    activeFeeds.map(async (feed) => {
      try {
        const parsed = await fetchFeedWithTimeout(parser, feed.url);
        const items = (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FEED);
        return { feed, items };
      } catch (err: any) {
        console.warn(`  ✗ ${feed.nom}: ${err.message ?? err}`);
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { feed, items } = result.value;

    for (const item of items) {
      const url = item.link ?? item.guid ?? '';
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const titre = (item.title ?? '').trim();
      if (!titre) continue;

      const isoDate = getIso(item);
      const rubrique = RUBRIQUES_CANON[feed.rubrique] ?? feed.rubrique;

      allItems.push({
        heure:       toHeure(isoDate),
        titre,
        url,
        rubrique,
        source:      feed.nom,
        source_url:  url,
        pays:        feed.pays,
        langue:      feed.langue,
        type:        feed.type,
        orientation: feed.orientation,
        isoDate,
      });
    }
  }

  // Sort by date descending, then cap
  allItems.sort((a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime());
  const trimmed = allItems.slice(0, MAX_TOTAL_ITEMS);

  const now = new Date().toISOString();
  const output = {
    date:         now.slice(0, 10),
    genere_a:     now,
    derniere_maj: now,
    source:       'rss',
    nb_items:     trimmed.length,
    items:        trimmed,
  };

  // Write to public/ for live client-side refresh
  const publicOutPath = join(ROOT, 'public/data/fil.json');
  mkdirSync(dirname(publicOutPath), { recursive: true });
  writeFileSync(publicOutPath, JSON.stringify(output, null, 2), 'utf-8');

  // Also write to src/data/ for Astro build-time import
  const srcOutPath = join(ROOT, 'src/data/fil.json');
  writeFileSync(srcOutPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✓ ${trimmed.length} items written to public/data/fil.json and src/data/fil.json`);
}

main().catch(err => {
  console.error('fetch-rss-fil failed:', err);
  process.exit(1);
});
