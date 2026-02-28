/**
 * generate-eclairages.ts — Generate SEO-optimized news synthesis articles via LLM
 *
 * Selects high-SEO-potential topics from clustering output, generates
 * structured articles targeting trending Google queries.
 *
 * Usage:
 *   npx tsx scripts/generate-eclairages.ts
 *   npx tsx scripts/generate-eclairages.ts --topic "Réforme des retraites"
 *   npx tsx scripts/generate-eclairages.ts --max 2
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { EclairageSchema } from './schemas/eclairage.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';
import type { TopicsData, Topic } from './cluster-topics.js';

const PIPELINE_VERSION = '1.0.0';
const MAX_ECLAIRAGES = 4;
const MIN_TOPIC_SCORE = 20;

const SYSTEM_PROMPT = `Tu es le rédacteur SEO de Citoyens.ai, spécialisé en référencement naturel pour l'actualité française.

## Mission
Produire un article "éclairage" optimisé pour le référencement Google sur un sujet d'actualité.
L'éclairage doit capter le trafic de recherche court terme (requêtes trending) tout en étant
un contenu de qualité qui sera indexé durablement.

## Principes SEO
- Le titre doit contenir le mot-clé principal et faire 50-70 caractères
- La meta_description doit inciter au clic et faire 120-160 caractères
- Les titres de sections (H2) doivent inclure des mots-clés secondaires naturellement
- Les questions FAQ doivent être formulées comme un internaute les taperait sur Google
- Le contenu doit être factuel, sourcé, accessible à tous
- Le mot-clé principal doit apparaître naturellement dans l'introduction et le contenu

## Format de sortie JSON

{
  "slug": "string (URL-friendly, inclut le mot-clé, ex: reforme-retraites-2026-calendrier)",
  "titre": "string (50-70 car., contient le mot-clé principal, accrocheur)",
  "meta_description": "string (120-160 car., incite au clic, contient le mot-clé)",
  "rubrique": "politique|economie|tech|science|societe|culture|international|ia",

  "mot_cle_principal": "string (la requête cible, ex: 'réforme des retraites 2026')",
  "mots_cles_secondaires": ["string (3-5 variantes/requêtes associées)"],

  "date_publication": "YYYY-MM-DD",
  "date_modification": "YYYY-MM-DD",

  "introduction": "string (2-3 paragraphes : accroche + contexte + ce que l'article couvre)",

  "sections": [
    {
      "titre": "string (H2 avec mot-clé si naturel)",
      "contenu": "string (2-4 paragraphes, factuel, sourcé, 150-300 mots)"
    }
  ],

  "chiffres_cles": [
    {
      "valeur": "string (le chiffre)",
      "contexte": "string (ce que ça signifie)",
      "source": "string (d'où ça vient)"
    }
  ],

  "faq": [
    {
      "question": "string (question naturelle, comme tapée sur Google)",
      "reponse": "string (réponse concise, 2-4 phrases, factuelle)"
    }
  ],

  "ce_quil_faut_retenir": "string (3-5 phrases de synthèse)",

  "sources": [
    { "nom": "string", "url": "string (URL valide issue des articles fournis)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }
  ]
}

## Règles
- 3-5 sections de fond, chacune avec un H2 descriptif
- 2-4 chiffres clés avec sources
- 3-5 questions FAQ formulées naturellement
- Minimum 3 sources diversifiées
- Les URLs des sources doivent provenir UNIQUEMENT des articles fournis
- Total : 800-1500 mots de contenu
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

function loadExistingEclairages(): Map<string, any> {
  const dir = new URL('../src/data/eclairages/', import.meta.url);
  const map = new Map<string, any>();
  try {
    if (!existsSync(dir)) return map;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(new URL(f, dir), 'utf-8'));
        if (data?.slug) map.set(data.slug, data);
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return map;
}

function loadPersonneSlugs(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const raw = JSON.parse(readFileSync(new URL('../src/data/personnes.json', import.meta.url), 'utf-8'));
    const personnes = Array.isArray(raw) ? raw : (raw.personnes || []);
    for (const p of personnes) {
      if (p.nom_complet && p.slug) map.set(p.nom_complet.toLowerCase(), p.slug);
      if (p.nom && p.slug) map.set(p.nom.toLowerCase(), p.slug);
    }
  } catch { /* ignore */ }
  return map;
}

function loadExistingGuides(): { slug: string; titre: string; mots_cles: string[] }[] {
  const dir = new URL('../src/data/guides/', import.meta.url);
  const guides: any[] = [];
  try {
    if (!existsSync(dir)) return guides;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(new URL(f, dir), 'utf-8'));
        if (data?.slug) guides.push({
          slug: data.slug,
          titre: data.titre,
          mots_cles: [data.mot_cle_principal, ...(data.mots_cles_secondaires || [])],
        });
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return guides;
}

function detectLiensInternes(
  text: string,
  personnes: Map<string, string>,
  guides: { slug: string; titre: string; mots_cles: string[] }[],
): { type: string; slug: string; titre: string }[] {
  const liens: { type: string; slug: string; titre: string }[] = [];
  const seen = new Set<string>();

  // Match person names
  const textLower = text.toLowerCase();
  for (const [nom, slug] of personnes) {
    if (textLower.includes(nom) && !seen.has(`fiche:${slug}`)) {
      // Capitalize name for display
      const titre = nom.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      liens.push({ type: 'fiche', slug, titre });
      seen.add(`fiche:${slug}`);
      if (liens.length >= 5) break;
    }
  }

  // Match guides by keywords
  for (const g of guides) {
    for (const kw of g.mots_cles) {
      if (textLower.includes(kw.toLowerCase()) && !seen.has(`guide:${g.slug}`)) {
        liens.push({ type: 'guide', slug: g.slug, titre: g.titre });
        seen.add(`guide:${g.slug}`);
        break;
      }
    }
  }

  return liens;
}

function scoreTopicSEO(topic: Topic, existingSlugs: Set<string>): number {
  let score = topic.score.total;

  // Boost for multi-source coverage
  if (topic.score.nb_sources >= 5) score += 15;
  else if (topic.score.nb_sources >= 3) score += 8;

  // Boost for freshness
  if (topic.score.fraicheur_h <= 12) score += 10;
  else if (topic.score.fraicheur_h <= 24) score += 5;

  // Boost for diverse source types
  if (topic.score.diversite_types >= 3) score += 10;

  // Penalty if we already have an eclairage on this exact topic title
  const slug = slugify(topic.titre);
  if (existingSlugs.has(slug)) score -= 20;

  return score;
}

async function main() {
  loadEnv();

  const config = resolveConfig();
  const forcedTopic = process.argv.find((a, i) => process.argv[i - 1] === '--topic') || null;
  const maxArg = process.argv.find((a, i) => process.argv[i - 1] === '--max');
  const maxEclairages = maxArg ? parseInt(maxArg, 10) : MAX_ECLAIRAGES;
  const today = new Date().toISOString().split('T')[0];

  console.log(`[eclairages] Using LLM: ${config.provider} / ${config.model}`);

  // Load raw articles
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  // Load topics from clustering
  const topicsPath = new URL('../src/data/.pipeline/topics.json', import.meta.url);
  let topicsData: TopicsData;
  try {
    topicsData = JSON.parse(readFileSync(topicsPath, 'utf-8'));
  } catch {
    console.error('✗ topics.json not found. Run cluster-topics.ts first.');
    process.exit(1);
  }

  // Load existing data for dedup and linking
  const existingEclairages = loadExistingEclairages();
  const existingSlugs = new Set(existingEclairages.keys());
  const personnes = loadPersonneSlugs();
  const guides = loadExistingGuides();

  console.log(`[eclairages] ${articles.length} articles, ${topicsData.topics.length} topics, ${existingSlugs.size} existing eclairages`);

  // Build article lookup by id
  const articleById = new Map(articles.map(a => [a.id, a]));

  // Select topics to generate eclairages for
  let selectedTopics: Topic[];

  if (forcedTopic) {
    // If a topic is forced, find matching topic or create a virtual one
    const match = topicsData.topics.find(t =>
      t.titre.toLowerCase().includes(forcedTopic.toLowerCase())
    );
    if (match) {
      selectedTopics = [match];
    } else {
      console.error(`✗ No topic matching "${forcedTopic}" found in clustering output.`);
      process.exit(1);
    }
  } else {
    // Score and rank topics by SEO potential
    const scored = topicsData.topics
      .filter(t => t.score.total >= MIN_TOPIC_SCORE && t.article_ids.length >= 2)
      .map(t => ({ topic: t, seoScore: scoreTopicSEO(t, existingSlugs) }))
      .sort((a, b) => b.seoScore - a.seoScore);

    selectedTopics = scored.slice(0, maxEclairages).map(s => s.topic);

    if (selectedTopics.length === 0) {
      console.log('[eclairages] No topics with sufficient SEO potential. Skipping.');
      process.exit(0);
    }

    console.log(`[eclairages] Selected ${selectedTopics.length} topics:`);
    scored.slice(0, maxEclairages).forEach((s, i) =>
      console.log(`  ${i + 1}. [SEO: ${s.seoScore}] ${s.topic.titre} (${s.topic.sources.length} sources)`)
    );
  }

  // Generate eclairages
  const outDir = new URL('../src/data/eclairages/', import.meta.url);
  mkdirSync(outDir, { recursive: true });

  let generated = 0;

  for (const topic of selectedTopics) {
    console.log(`\n[eclairages] Generating: ${topic.titre}`);

    // Gather articles for this topic
    const topicArticles = topic.article_ids
      .map(id => articleById.get(id))
      .filter((a): a is RawArticle => !!a)
      .slice(0, 20);

    const articleContext = topicArticles.map(a => ({
      titre: a.titre,
      description: a.description,
      source: a.source,
      type: a.type,
      url: a.url,
      date: a.date,
    }));

    // Build context about existing content for internal linking
    const guideContext = guides.length > 0
      ? `\n\n## Guides existants (pour guide_parent)\n${guides.map(g => `- ${g.slug}: ${g.titre}`).join('\n')}`
      : '';

    const userMessage = `Date : ${today}

## Sujet
${topic.titre}
Rubrique détectée : ${topic.rubriques_detectees.join(', ')}
Score éditorial : ${topic.score.total}

## Articles sources (${topicArticles.length})
${JSON.stringify(articleContext, null, 1)}
${guideContext}

## Instructions
Génère un éclairage SEO complet sur ce sujet au format JSON.
Le mot-clé principal doit correspondre à ce que les internautes recherchent sur Google à propos de ce sujet.`;

    try {
      const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 10000);

      let data: any;
      try {
        data = JSON.parse(extractJson(response));
      } catch {
        console.error('  ✗ LLM returned invalid JSON');
        console.error('  Raw (first 300):', response.slice(0, 300));
        continue;
      }

      // Ensure required fields
      data.date_publication = data.date_publication || today;
      data.date_modification = data.date_modification || today;
      data.slug = data.slug || slugify(data.titre || topic.titre);

      // Check if this is an update to an existing eclairage
      if (existingEclairages.has(data.slug)) {
        const existing = existingEclairages.get(data.slug);
        data.date_publication = existing.date_publication; // Keep original publish date
        data.date_modification = today;
        console.log(`  → Updating existing eclairage: ${data.slug}`);
      }

      // Auto-detect internal links
      const allText = [
        data.introduction || '',
        ...(data.sections || []).map((s: any) => s.contenu || ''),
        data.ce_quil_faut_retenir || '',
      ].join(' ');
      const autoLiens = detectLiensInternes(allText, personnes, guides);
      data.liens_internes = [...(data.liens_internes || []), ...autoLiens];

      // Set guide_parent if a matching guide exists
      if (!data.guide_parent && guides.length > 0) {
        const matched = guides.find(g =>
          g.mots_cles.some(kw => allText.toLowerCase().includes(kw.toLowerCase()))
        );
        if (matched) data.guide_parent = matched.slug;
      }

      // Pipeline metadata
      data.meta = {
        nb_articles_source: topicArticles.length,
        modele: `${config.provider}/${config.model}`,
        version_pipeline: PIPELINE_VERSION,
      };

      // Validate
      const validation = EclairageSchema.safeParse(data);
      if (!validation.success) {
        console.warn('  ⚠ Zod validation warnings:');
        for (const issue of validation.error.issues) {
          console.warn(`    - ${issue.path.join('.')}: ${issue.message}`);
        }
      }

      // Write output
      const outPath = new URL(`${data.slug}.json`, outDir);
      writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

      console.log(`  ✓ Wrote: ${data.slug}.json`);
      console.log(`    Titre : ${data.titre}`);
      console.log(`    Mot-clé : ${data.mot_cle_principal}`);
      console.log(`    ${data.sections?.length || 0} sections, ${data.faq?.length || 0} FAQ, ${data.sources?.length || 0} sources`);
      console.log(`    ${data.liens_internes?.length || 0} liens internes`);

      generated++;
    } catch (err: any) {
      console.error(`  ✗ Generation failed: ${err.message}`);
      continue;
    }
  }

  console.log(`\n✓ Generated ${generated} eclairage(s)`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Eclairage generation failed:', err);
  process.exit(1);
});
