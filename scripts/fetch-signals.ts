/**
 * fetch-signals.ts — Aggregate trending signals from HackerNews, Reddit, Wikipedia
 *
 * Collects buzz indicators from free APIs to feed into generate-sujets-chauds.ts.
 * These signals help detect trending topics that RSS alone might miss.
 *
 * Usage: npx tsx scripts/fetch-signals.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import Parser from 'rss-parser';

// ---------- Types ----------

interface HNItem {
  titre: string;
  url: string;
  score: number;
  comments: number;
  tags: string[];
}

interface RedditItem {
  titre: string;
  subreddit: string;
  url: string;
  score: number;
  comments: number;
}

interface WikiItem {
  article: string;
  vues_hier: number;
  variation: string;
}

interface SignalsOutput {
  date: string;
  generated_at: string;
  hackernews: HNItem[];
  reddit: RedditItem[];
  wikipedia_trending: WikiItem[];
}

// ---------- Env ----------

function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  try {
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

// ---------- HackerNews ----------

const HN_TOP_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const HN_ITEM_URL = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const HN_MIN_SCORE = 100;
const HN_MAX_ITEMS = 30;

async function fetchHackerNews(): Promise<HNItem[]> {
  console.log('[signals] Fetching HackerNews top stories...');
  try {
    const res = await fetch(HN_TOP_URL);
    if (!res.ok) throw new Error(`HN API ${res.status}`);
    const ids: number[] = await res.json();

    const top = ids.slice(0, 60);
    const items = await Promise.allSettled(
      top.map(async (id) => {
        const r = await fetch(HN_ITEM_URL(id));
        if (!r.ok) return null;
        return r.json();
      })
    );

    const results: HNItem[] = [];
    for (const item of items) {
      if (item.status !== 'fulfilled' || !item.value) continue;
      const v = item.value;
      if ((v.score || 0) < HN_MIN_SCORE) continue;
      if (v.type !== 'story') continue;

      const title = (v.title || '').toLowerCase();
      const tags: string[] = [];
      const tagMap: Record<string, string[]> = {
        ai: ['ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic', 'deepseek', 'gemini', 'machine learning', 'neural'],
        regulation: ['regulation', 'law', 'ban', 'congress', 'eu', 'gdpr', 'antitrust'],
        security: ['hack', 'breach', 'vulnerability', 'security', 'ransomware'],
        crypto: ['crypto', 'bitcoin', 'blockchain', 'ethereum'],
        france: ['france', 'french', 'paris', 'macron'],
        politics: ['trump', 'biden', 'election', 'congress', 'senate', 'government'],
      };
      for (const [tag, keywords] of Object.entries(tagMap)) {
        if (keywords.some(kw => title.includes(kw))) tags.push(tag);
      }

      results.push({
        titre: v.title || '',
        url: v.url || `https://news.ycombinator.com/item?id=${v.id}`,
        score: v.score || 0,
        comments: v.descendants || 0,
        tags,
      });
    }

    results.sort((a, b) => b.score - a.score);
    console.log(`  ✓ ${results.length} HN stories with score >= ${HN_MIN_SCORE}`);
    return results.slice(0, HN_MAX_ITEMS);
  } catch (err: any) {
    console.error(`  ✗ HackerNews failed: ${err.message}`);
    return [];
  }
}

// ---------- Reddit ----------

const REDDIT_SUBS = [
  { sub: 'france', lang: 'fr' },
  { sub: 'worldnews', lang: 'en' },
  { sub: 'technology', lang: 'en' },
  { sub: 'artificial', lang: 'en' },
  { sub: 'europe', lang: 'en' },
  { sub: 'geopolitics', lang: 'en' },
];
const REDDIT_MIN_SCORE = 200;

async function fetchReddit(): Promise<RedditItem[]> {
  console.log('[signals] Fetching Reddit top posts...');
  const parser = new Parser({
    timeout: 15000,
    headers: {
      'User-Agent': 'Citoyens.ai/1.0 (civic tech signal aggregator)',
      Accept: 'application/rss+xml, text/xml, */*',
    },
  });

  const results: RedditItem[] = [];

  for (const { sub } of REDDIT_SUBS) {
    try {
      const feed = await parser.parseURL(`https://www.reddit.com/r/${sub}/hot.rss`);
      for (const item of feed.items || []) {
        const title = item.title || '';
        const url = item.link || '';
        if (!title || !url) continue;

        results.push({
          titre: title,
          subreddit: sub,
          url,
          score: 0,
          comments: 0,
        });
      }
      console.log(`  ✓ r/${sub}: ${(feed.items || []).length} posts`);
    } catch (err: any) {
      console.error(`  ✗ r/${sub} failed: ${err.message}`);
    }
  }

  console.log(`  ✓ ${results.length} Reddit posts total`);
  return results;
}

// ---------- Wikipedia Trending ----------

async function fetchWikipediaTrending(): Promise<WikiItem[]> {
  console.log('[signals] Fetching Wikipedia trending pages...');
  try {
    const yesterday = new Date(Date.now() - 86400000);
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access/${year}/${month}/${day}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Citoyens.ai/1.0 (civic tech signal aggregator)' },
    });
    if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);

    const data = await res.json();
    const articles = data?.items?.[0]?.articles || [];

    const EXCLUDED_PREFIXES = ['Spécial:', 'Wikipédia:', 'Portail:', 'Aide:', 'Catégorie:', 'Modèle:', 'Discussion:'];
    const EXCLUDED_PAGES = ['Page_principale', 'Main_Page', '-'];

    const results: WikiItem[] = [];
    for (const a of articles.slice(0, 100)) {
      const name = a.article || '';
      if (EXCLUDED_PAGES.includes(name)) continue;
      if (EXCLUDED_PREFIXES.some(p => name.startsWith(p))) continue;
      if (a.views < 10000) continue;

      results.push({
        article: name.replace(/_/g, ' '),
        vues_hier: a.views,
        variation: `top ${a.rank}`,
      });
    }

    console.log(`  ✓ ${results.length} Wikipedia trending pages (>10k views)`);
    return results.slice(0, 30);
  } catch (err: any) {
    console.error(`  ✗ Wikipedia trending failed: ${err.message}`);
    return [];
  }
}

// ---------- Main ----------

async function main() {
  loadEnv();

  const today = new Date().toISOString().split('T')[0];
  console.log(`[signals] Fetching signals for ${today}\n`);

  const [hackernews, reddit, wikipedia_trending] = await Promise.all([
    fetchHackerNews(),
    fetchReddit(),
    fetchWikipediaTrending(),
  ]);

  const output: SignalsOutput = {
    date: today,
    generated_at: new Date().toISOString(),
    hackernews,
    reddit,
    wikipedia_trending,
  };

  const outDir = new URL('../src/data/.pipeline/', import.meta.url);
  mkdirSync(outDir, { recursive: true });

  const outPath = new URL('signals.json', outDir);
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✓ Wrote signals.json for ${today}`);
  console.log(`  HackerNews: ${hackernews.length} stories`);
  console.log(`  Reddit: ${reddit.length} posts`);
  console.log(`  Wikipedia: ${wikipedia_trending.length} trending pages`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline fetch-signals failed:', err);
  process.exit(1);
});
