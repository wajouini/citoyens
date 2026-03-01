/**
 * generate-fil-update.ts — Incremental hourly update of the fil continu
 *
 * Lightweight alternative to generate-fil.ts, designed to run every hour.
 * Only fetches new RSS articles (last 2h), generates 3-5 new items,
 * and prepends them to the existing fil.json.
 *
 * Does NOT re-run the full pipeline. Exits cleanly if nothing new is found.
 *
 * Usage: npx tsx scripts/generate-fil-update.ts
 */

import Parser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';

const WINDOW_MINUTES = 120; // fetch articles from the last 2 hours
const MAX_NEW_ITEMS = 5;
const MAX_TOTAL_ITEMS = 25;

interface FeedSource {
  nom: string;
  url: string;
  type: string;
  rubrique: string;
  groupe: string | null;
  orientation: string | null;
  active?: boolean;
}

interface GroupeMedia {
  id: string;
  nom: string;
  proprietaires: { nom: string; type: string; fortune_source: string }[];
  orientation: string;
  medias: string[];
}

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

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (m) return m[1].trim();
  const j = text.match(/\{[\s\S]*\}/);
  if (j) return j[0];
  return text;
}

const SYSTEM_PROMPT = `Tu es un journaliste factuel de Citoyens.ai, responsable du fil continu.

## Mission
Produire des mises à jour factuelles courtes (1-2 phrases) sur les dernières informations.
Zéro analyse, zéro opinion — uniquement les faits les plus récents.

## Format JSON attendu
{
  "items": [
    {
      "heure": "HH:MM",
      "texte": "string (1-2 phrases, 200 caractères max)",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "source": "string (nom exact du média)",
      "source_url": "string (URL exacte de l'article)"
    }
  ]
}

## Règles
- 3-5 items maximum, du plus récent au plus ancien
- Uniquement des faits de la dernière heure ou deux
- Ne PAS répéter les faits déjà publiés (liste fournie)
- Utiliser UNIQUEMENT les URLs et sources des articles fournis
- Retourne UNIQUEMENT le JSON`;

async function fetchRecentArticles(feeds: FeedSource[], windowMinutes: number): Promise<RawArticle[]> {
  const parser = new Parser({ timeout: 8000 });
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  const articles: RawArticle[] = [];

  // Only fetch from reliable, fast feeds (fiabilite >= 3, mainstream + investigation)
  const priorityFeeds = feeds
    .filter(f => f.active !== false)
    .slice(0, 30); // cap to avoid too many requests

  await Promise.allSettled(
    priorityFeeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of parsed.items || []) {
          if (!item.title || !item.link) continue;
          const pubDate = item.pubDate || item.isoDate;
          if (!pubDate) continue;
          const date = new Date(pubDate);
          if (date < cutoff) continue;

          articles.push({
            id: item.link,
            titre: item.title.trim(),
            description: (item.contentSnippet || item.content || item.summary || '').slice(0, 300),
            url: item.link,
            source: feed.nom,
            type: feed.type as any,
            rubrique: feed.rubrique as any,
            pays: 'France',
            langue: 'fr',
            date: date.toISOString(),
            fiabilite: 3,
            auteur: item.creator || null,
            groupe: feed.groupe,
          });
        }
      } catch { /* skip failed feeds */ }
    })
  );

  // Sort by date desc, most recent first
  return articles.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function main() {
  loadEnv();

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Load existing fil
  const filPath = new URL('../src/data/fil.json', import.meta.url);
  let existingFil: any = null;
  try {
    existingFil = JSON.parse(readFileSync(filPath, 'utf-8'));
  } catch {
    console.log('[fil-update] No existing fil.json, run generate-fil.ts first');
    process.exit(0);
  }

  // Don't update if fil is from a different day (morning pipeline will handle it)
  if (existingFil.date !== today) {
    console.log(`[fil-update] fil.json is from ${existingFil.date}, today is ${today}. Skipping.`);
    process.exit(0);
  }

  const existingItems: any[] = existingFil.items || [];
  const existingTexts = new Set(existingItems.map((i: any) => i.texte.slice(0, 60).toLowerCase()));

  // Load feeds
  const feeds: FeedSource[] = JSON.parse(
    readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8')
  ).filter((f: any) => f.active !== false);

  // Load ownership data
  let groupes: GroupeMedia[] = [];
  try {
    groupes = JSON.parse(readFileSync(new URL('../src/data/groupes-medias.json', import.meta.url), 'utf-8'));
  } catch { /* proceed without */ }
  const groupeById = new Map(groupes.map(g => [g.id, g]));
  const feedByName = new Map(feeds.map(f => [f.nom, f]));

  console.log(`[fil-update] Fetching articles from last ${WINDOW_MINUTES}min...`);
  const recentArticles = await fetchRecentArticles(feeds, WINDOW_MINUTES);

  if (recentArticles.length === 0) {
    console.log('[fil-update] No new articles found. Updating derniere_maj timestamp only.');
    existingFil.derniere_maj = now.toISOString();
    writeFileSync(filPath, JSON.stringify(existingFil, null, 2), 'utf-8');
    process.exit(0);
  }

  console.log(`[fil-update] Found ${recentArticles.length} recent articles`);

  const config = resolveConfig();
  console.log(`[fil-update] Using LLM: ${config.provider} / ${config.model}`);

  const recentSummary = recentArticles.slice(0, 40).map(a => ({
    titre: a.titre,
    source: a.source,
    url: a.url,
    rubrique: a.rubrique,
    heure: new Date(a.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }));

  const alreadyPublished = existingItems.slice(0, 10).map((i: any) => `- [${i.heure}] ${i.texte.slice(0, 80)}`).join('\n');

  const userMessage = `Date : ${today}, Heure actuelle : ${currentHour}

## Déjà publié aujourd'hui (NE PAS RÉPÉTER)
${alreadyPublished || 'Rien encore'}

## Nouveaux articles (dernières ${WINDOW_MINUTES / 60}h)
${JSON.stringify(recentSummary, null, 1)}

Génère ${MAX_NEW_ITEMS} nouvelles mises à jour factuelles pour le fil continu.
Si aucun article vraiment nouveau ou différent de l'existant, retourne {"items": []}.`;

  const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 1500);

  let data: any;
  try {
    data = JSON.parse(extractJson(response));
  } catch {
    console.error('[fil-update] LLM returned invalid JSON, skipping');
    process.exit(0);
  }

  const newItems: any[] = (data.items || []).filter((item: any) => {
    const key = item.texte?.slice(0, 60)?.toLowerCase();
    return key && !existingTexts.has(key) && item.source_url;
  });

  if (newItems.length === 0) {
    console.log('[fil-update] No genuinely new items generated. Updating timestamp only.');
    existingFil.derniere_maj = now.toISOString();
    writeFileSync(filPath, JSON.stringify(existingFil, null, 2), 'utf-8');
    process.exit(0);
  }

  // Enrich with ownership data
  for (const item of newItems) {
    const feed = feedByName.get(item.source);
    const groupe = feed?.groupe ? groupeById.get(feed.groupe) : null;
    if (groupe) {
      item.groupe_media = {
        nom: groupe.nom,
        proprietaire: groupe.proprietaires.map(p => p.nom).join(', '),
        type_proprietaire: groupe.proprietaires[0]?.type || 'independant',
        orientation: groupe.orientation,
      };
    }
    if (!item.source_type) {
      item.source_type = (feed as any)?.type || 'mainstream';
    }
  }

  // Merge: new items first, then existing, cap at MAX_TOTAL_ITEMS
  const mergedItems = [...newItems, ...existingItems]
    .slice(0, MAX_TOTAL_ITEMS);

  const updatedFil = {
    ...existingFil,
    derniere_maj: now.toISOString(),
    items: mergedItems,
    meta: {
      ...existingFil.meta,
      nb_mises_a_jour: (existingFil.meta?.nb_mises_a_jour || 1) + 1,
    },
  };

  writeFileSync(filPath, JSON.stringify(updatedFil, null, 2), 'utf-8');

  console.log(`\n✓ fil.json updated at ${currentHour}`);
  console.log(`  +${newItems.length} new items (${mergedItems.length} total)`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[fil-update] Failed:', err.message || err);
  process.exit(1);
});
