/**
 * generate-fil.ts — Generate continuous news ticker via LLM
 *
 * Lightweight factual updates, 1-2 sentences each.
 * Designed to run 3-4 times per day with a fast/cheap model.
 *
 * Usage: npx tsx scripts/generate-fil.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { FilSchema } from './schemas/fil.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '3.0.0';

interface GroupeMedia {
  id: string;
  nom: string;
  proprietaires: { nom: string; type: string; fortune_source: string }[];
  orientation: string;
  medias: string[];
}

interface FeedMeta {
  nom: string;
  groupe: string | null;
  orientation: string | null;
}

const SYSTEM_PROMPT = `Tu es un journaliste factuel de Citoyens.ai, responsable du fil continu.

## Mission
Produire des mises à jour factuelles courtes (1-2 phrases chacune) sur l'actualité du moment.
Zéro analyse, zéro opinion — uniquement les faits.

## Format de sortie JSON

{
  "items": [
    {
      "heure": "HH:MM",
      "texte": "string (1-2 phrases factuelles, 200 caractères max)",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "source": "string (nom du média source)",
      "source_url": "string (URL exacte de l'article)"
    }
  ]
}

## Règles
- 5-8 items, triés du plus récent au plus ancien
- Chaque item = 1-2 phrases FACTUELLES, pas d'opinion
- Couvrir des rubriques variées
- Ne pas répéter un même fait sous différents angles
- Utiliser UNIQUEMENT les URLs fournies dans les articles
- Retourne UNIQUEMENT le JSON`;

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (m) return m[1].trim();
  const j = text.match(/\{[\s\S]*\}/);
  if (j) return j[0];
  return text;
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

async function main() {
  loadEnv();

  const config = resolveConfig();
  console.log(`[fil] Using LLM: ${config.provider} / ${config.model}`);

  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`[fil] Loaded ${articles.length} articles`);

  // Load existing fil to append (avoid repeats)
  let existingItems: any[] = [];
  try {
    const existing = JSON.parse(readFileSync(new URL('../src/data/fil.json', import.meta.url), 'utf-8'));
    existingItems = existing.items || [];
  } catch { /* first run */ }

  // Load ownership data
  let groupes: GroupeMedia[] = [];
  let feedsMeta: FeedMeta[] = [];
  try {
    groupes = JSON.parse(readFileSync(new URL('../src/data/groupes-medias.json', import.meta.url), 'utf-8'));
    feedsMeta = JSON.parse(readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8'));
  } catch { /* proceed without */ }

  const groupeById = new Map(groupes.map(g => [g.id, g]));
  const feedByName = new Map(feedsMeta.map(f => [f.nom, f]));

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const currentHour = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const recentArticles = articles.slice(0, 80).map(a => ({
    titre: a.titre,
    source: a.source,
    url: a.url,
    rubrique: (a as any).rubrique || 'generaliste',
    desc: a.description.slice(0, 150),
  }));

  const existingContext = existingItems.length > 0
    ? `\n## Déjà publié (NE PAS RÉPÉTER)\n${existingItems.map(i => `- ${i.texte}`).join('\n')}`
    : '';

  const userMessage = `Date : ${today}, Heure actuelle : ${currentHour}
${existingContext}

## Articles récents (${articles.length} total)
${JSON.stringify(recentArticles, null, 1)}

Génère 5-8 mises à jour factuelles pour le fil continu.`;

  console.log('\n[fil] Generating ticker...');
  const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 3000);

  let data: any;
  try {
    data = JSON.parse(extractJson(response));
  } catch {
    console.error('✗ LLM returned invalid JSON');
    console.error('Raw (first 500):', response.slice(0, 500));
    process.exit(1);
  }

  // Enrich with ownership data
  for (const item of data.items || []) {
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
      const feedMeta = feedByName.get(item.source);
      item.source_type = (feedMeta as any)?.type || 'mainstream';
    }
  }

  // Merge with existing items (newest first), dedup by text similarity
  const mergedItems = [...(data.items || []), ...existingItems];
  const seen = new Set<string>();
  const dedupedItems = mergedItems.filter(item => {
    const key = item.texte.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);

  const filData = {
    date: today,
    genere_a: new Date().toISOString(),
    items: dedupedItems,
    meta: {
      nb_articles_analyses: articles.length,
      modele: `${config.provider}/${config.model}`,
      version_pipeline: PIPELINE_VERSION,
    },
  };

  // Validate
  const validation = FilSchema.safeParse(filData);
  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // Write
  const filPath = new URL('../src/data/fil.json', import.meta.url);
  writeFileSync(filPath, JSON.stringify(filData, null, 2), 'utf-8');

  console.log(`\n✓ Wrote fil.json for ${today}`);
  console.log(`  ${dedupedItems.length} items (${(data.items || []).length} new)`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline generate-fil failed:', err);
  process.exit(1);
});
