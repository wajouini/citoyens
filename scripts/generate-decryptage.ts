/**
 * generate-decryptage.ts — Generate a weekly deep-dive article via LLM
 *
 * Analyzes the week's articles to identify the most complex/recurring topic,
 * then produces a long-form décryptage.
 *
 * Usage:
 *   npx tsx scripts/generate-decryptage.ts
 *   npx tsx scripts/generate-decryptage.ts --topic "Intelligence artificielle et emploi"
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { DecryptageSchema } from './schemas/decryptage.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '3.0.0';

const SYSTEM_PROMPT = `Tu es le rédacteur en chef de Citoyens.ai, responsable des décryptages hebdomadaires.

## Mission
Produire un article de fond (5-10 min de lecture) sur un sujet complexe d'actualité.
Le décryptage doit donner au lecteur les clés pour comprendre un sujet en profondeur :
contexte historique, enjeux, acteurs, perspectives, chiffres clés.

## Principes
- Factuel, non-partisan, honnête sur ce qu'on sait et ce qu'on ne sait pas
- Accessible à tous (pas de jargon, ou expliqué)
- Sources citées pour chaque affirmation importante
- Chiffres vérifiables avec source

## Format de sortie JSON

{
  "slug": "string (URL-friendly, ex: ia-et-emploi-en-france)",
  "titre": "string (titre accrocheur, 60-80 caractères)",
  "sous_titre": "string (1 phrase de contexte)",
  "rubrique": "politique|economie|tech|science|societe|culture|international",
  "date": "YYYY-MM-DD",

  "introduction": "string (2-3 paragraphes d'accroche qui posent le sujet)",

  "sections": [
    {
      "titre": "string (titre de section)",
      "contenu": "string (2-4 paragraphes, factuel, sourcé)"
    }
  ],

  "chiffres_cles": [
    {
      "valeur": "string (le chiffre)",
      "contexte": "string (ce que ça signifie)",
      "source": "string (d'où ça vient)"
    }
  ],

  "ce_quil_faut_retenir": "string (3-5 phrases de synthèse)",

  "sources": [
    { "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }
  ]
}

## Règles
- 4-6 sections de fond
- 3-5 chiffres clés avec sources
- Introduction qui donne envie de lire
- "ce_quil_faut_retenir" = synthèse actionnable
- Minimum 5 sources diversifiées
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function main() {
  loadEnv();

  const config = resolveConfig();
  const forcedTopic = process.argv.find((a, i) => process.argv[i - 1] === '--topic') || null;
  const today = new Date().toISOString().split('T')[0];

  console.log(`[decryptage] Using LLM: ${config.provider} / ${config.model}`);

  // Load recent articles
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  // Also load recent archives to find recurring themes
  const archiveDir = new URL('../src/data/archives/', import.meta.url);
  const recentEditions: any[] = [];
  try {
    const files = readdirSync(archiveDir).filter(f => f.endsWith('.json') && !f.includes('soir')).sort().reverse().slice(0, 7);
    for (const f of files) {
      try {
        recentEditions.push(JSON.parse(readFileSync(new URL(f, archiveDir), 'utf-8')));
      } catch { /* skip */ }
    }
  } catch { /* no archives */ }

  console.log(`[decryptage] ${articles.length} articles, ${recentEditions.length} recent editions`);

  // Build context about the week
  const weekTopics = recentEditions.map(e => {
    const topics = [e.sujet_du_jour?.titre, ...(e.essentiels || []).map((es: any) => es.titre)].filter(Boolean);
    return { date: e.date, topics };
  });

  const articleSummaries = articles.slice(0, 100).map(a => ({
    titre: a.titre,
    source: a.source,
    rubrique: (a as any).rubrique || 'generaliste',
    desc: a.description.slice(0, 150),
  }));

  const topicInstruction = forcedTopic
    ? `Le sujet imposé est : "${forcedTopic}". Écris le décryptage sur ce sujet.`
    : `Choisis le sujet le plus complexe/récurrent de la semaine qui mérite un décryptage approfondi. Évite les sujets trop éphémères.`;

  const userMessage = `Date : ${today}

## Sujets traités cette semaine
${weekTopics.map(w => `${w.date}: ${w.topics.join(' | ')}`).join('\n')}

## Articles récents (${articles.length} total, échantillon de 100)
${JSON.stringify(articleSummaries, null, 1)}

## Instructions
${topicInstruction}

Produis un décryptage complet au format JSON.`;

  console.log('\n[decryptage] Generating...');
  const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 10000);

  let data: any;
  try {
    data = JSON.parse(extractJson(response));
  } catch {
    console.error('✗ LLM returned invalid JSON');
    console.error('Raw (first 500):', response.slice(0, 500));
    process.exit(1);
  }

  // Ensure required fields
  data.date = data.date || today;
  data.slug = data.slug || slugify(data.titre || 'decryptage');
  data.meta = {
    nb_articles_source: articles.length,
    modele: `${config.provider}/${config.model}`,
    version_pipeline: PIPELINE_VERSION,
  };

  // Validate
  const validation = DecryptageSchema.safeParse(data);
  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // Write to decryptages directory
  const outDir = new URL('../src/data/decryptages/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const outPath = new URL(`${data.slug}.json`, outDir);
  writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`\n✓ Wrote decryptage: ${data.slug}.json`);
  console.log(`  Titre : ${data.titre}`);
  console.log(`  Rubrique : ${data.rubrique}`);
  console.log(`  ${data.sections?.length || 0} sections, ${data.chiffres_cles?.length || 0} chiffres clés`);
  console.log(`  ${data.sources?.length || 0} sources`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Décryptage generation failed:', err);
  process.exit(1);
});
