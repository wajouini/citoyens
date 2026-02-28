/**
 * generate-guides.ts — Generate SEO pillar/evergreen guide pages via LLM
 *
 * Analyzes existing éclairages and archives to identify recurring themes,
 * then produces comprehensive guides (2000-3000 words).
 *
 * Usage:
 *   npx tsx scripts/generate-guides.ts                 # Auto-detect themes
 *   npx tsx scripts/generate-guides.ts --topic "Assemblée nationale"
 *   npx tsx scripts/generate-guides.ts --if-needed     # Only run on Sundays or if new content justifies
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { GuideSchema } from './schemas/guide.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '1.0.0';

const SYSTEM_PROMPT = `Tu es l'architecte de contenu de Citoyens.ai, responsable des guides de fond.

## Mission
Produire un guide complet (15-25 min de lecture) sur un grand thème de l'actualité française.
Le guide est une "page pilier" SEO : il couvre le sujet en profondeur et sera la page de référence
sur ce thème. Il doit être mis à jour régulièrement avec de nouvelles informations.

## Principes SEO
- Le titre doit contenir le mot-clé principal et faire 50-70 caractères
- La meta_description doit inciter au clic et faire 120-160 caractères
- Les chapitres (H2) doivent avoir des titres descriptifs incluant des mots-clés secondaires
- Les sous-sections (H3) apportent de la granularité
- Les questions FAQ doivent être formulées comme un internaute les taperait sur Google
- Le contenu doit être factuel, sourcé, accessible, et apporter une vraie valeur ajoutée

## Format de sortie JSON

{
  "slug": "string (URL-friendly, ex: comprendre-reforme-retraites)",
  "titre": "string (50-70 car., contient le mot-clé principal)",
  "meta_description": "string (120-160 car., incite au clic)",
  "rubrique": "politique|economie|tech|science|societe|culture|international|ia",

  "mot_cle_principal": "string (requête cible principale, ex: 'réforme des retraites')",
  "mots_cles_secondaires": ["string (5-10 requêtes associées/variantes)"],

  "date_publication": "YYYY-MM-DD",
  "date_modification": "YYYY-MM-DD",

  "introduction": "string (3-4 paragraphes : pourquoi ce sujet compte, ce que le guide couvre)",

  "chapitres": [
    {
      "titre": "string (H2 descriptif avec mot-clé si naturel)",
      "slug_ancre": "string (URL-friendly pour l'ancre, ex: contexte-historique)",
      "contenu": "string (4-6 paragraphes, 300-500 mots, factuel, sourcé)",
      "sous_sections": [
        {
          "titre": "string (H3)",
          "contenu": "string (2-3 paragraphes)"
        }
      ]
    }
  ],

  "chiffres_cles": [
    {
      "valeur": "string",
      "contexte": "string",
      "source": "string",
      "source_url": "string (URL valide, optionnel)"
    }
  ],

  "faq": [
    {
      "question": "string (question naturelle, comme tapée sur Google)",
      "reponse": "string (réponse concise mais complète, 3-5 phrases)"
    }
  ],

  "lectures_essentielles": [
    {
      "titre": "string",
      "url": "string",
      "type": "interne|externe"
    }
  ],

  "conclusion": "string (2-3 paragraphes de synthèse et perspective)",

  "sources": [
    { "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }
  ]
}

## Règles
- 4-8 chapitres de fond, chacun avec 300-500 mots
- Chaque chapitre peut avoir 0-3 sous-sections
- 4-8 chiffres clés avec sources
- 5-8 questions FAQ
- Minimum 5 sources diversifiées
- Les URLs des sources doivent être des URLs réelles et vérifiables
- Total : 2000-3000 mots de contenu
- Le guide doit être compréhensible par un citoyen non-spécialiste
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

function loadJsonDir<T>(dirUrl: URL): T[] {
  const items: T[] = [];
  try {
    if (!existsSync(dirUrl)) return items;
    for (const f of readdirSync(dirUrl)) {
      if (!f.endsWith('.json')) continue;
      try {
        items.push(JSON.parse(readFileSync(new URL(f, dirUrl), 'utf-8')));
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return items;
}

interface ThemeCandidate {
  theme: string;
  rubrique: string;
  eclairageCount: number;
  archiveCount: number;
  keywords: string[];
  score: number;
}

function detectThemeCandidates(
  eclairages: any[],
  archives: any[],
  existingGuideSlugs: Set<string>,
): ThemeCandidate[] {
  // Count keyword/rubrique frequency across eclairages
  const keywordCounts = new Map<string, { count: number; rubrique: string; keywords: string[] }>();

  for (const e of eclairages) {
    const key = e.mot_cle_principal?.toLowerCase();
    if (!key) continue;
    const entry = keywordCounts.get(key) || { count: 0, rubrique: e.rubrique, keywords: [] };
    entry.count++;
    entry.keywords.push(...(e.mots_cles_secondaires || []));
    keywordCounts.set(key, entry);
  }

  // Count how often topics appear in archives
  const archiveTopics = new Map<string, number>();
  for (const archive of archives) {
    const topics = [
      archive.sujet_du_jour?.titre,
      ...(archive.france || []).map((f: any) => f.titre),
      ...(archive.monde || []).map((m: any) => m.titre),
    ].filter(Boolean);
    for (const t of topics) {
      const key = t.toLowerCase().slice(0, 50);
      archiveTopics.set(key, (archiveTopics.get(key) || 0) + 1);
    }
  }

  const candidates: ThemeCandidate[] = [];
  for (const [theme, data] of keywordCounts) {
    // Find archive mentions with similar keywords
    let archiveCount = 0;
    for (const [archiveTopic, count] of archiveTopics) {
      if (archiveTopic.includes(theme) || theme.includes(archiveTopic.slice(0, 20))) {
        archiveCount += count;
      }
    }

    const slug = slugify(theme);
    if (existingGuideSlugs.has(slug)) continue; // Skip if guide exists

    const score = data.count * 15 + archiveCount * 5;
    if (score >= 15) { // Minimum threshold
      candidates.push({
        theme,
        rubrique: data.rubrique,
        eclairageCount: data.count,
        archiveCount,
        keywords: [...new Set(data.keywords)],
        score,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

async function main() {
  loadEnv();

  const config = resolveConfig();
  const forcedTopic = process.argv.find((a, i) => process.argv[i - 1] === '--topic') || null;
  const ifNeeded = process.argv.includes('--if-needed');
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay(); // 0 = Sunday

  // --if-needed: only run on Sundays unless there's a forced topic
  if (ifNeeded && !forcedTopic && dayOfWeek !== 0) {
    console.log('[guides] --if-needed: not Sunday, skipping.');
    process.exit(0);
  }

  console.log(`[guides] Using LLM: ${config.provider} / ${config.model}`);

  // Load existing data
  const eclairagesDir = new URL('../src/data/eclairages/', import.meta.url);
  const guidesDir = new URL('../src/data/guides/', import.meta.url);
  const archivesDir = new URL('../src/data/archives/', import.meta.url);

  const eclairages = loadJsonDir<any>(eclairagesDir);
  const existingGuides = loadJsonDir<any>(guidesDir);
  const existingGuideSlugs = new Set(existingGuides.map((g: any) => g.slug));

  // Load recent archives (last 30 days)
  const archives: any[] = [];
  try {
    if (existsSync(archivesDir)) {
      const files = readdirSync(archivesDir)
        .filter(f => f.endsWith('.json') && !f.includes('soir'))
        .sort().reverse().slice(0, 30);
      for (const f of files) {
        try {
          archives.push(JSON.parse(readFileSync(new URL(f, archivesDir), 'utf-8')));
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }

  // Load raw articles for context
  let articles: RawArticle[] = [];
  try {
    articles = JSON.parse(readFileSync(
      new URL('../src/data/.pipeline/raw-articles.json', import.meta.url), 'utf-8'
    ));
  } catch { /* ignore - not critical for guides */ }

  console.log(`[guides] ${eclairages.length} eclairages, ${existingGuides.length} guides, ${archives.length} archives`);

  // Determine which guides to generate
  let themesToGenerate: { theme: string; rubrique: string; keywords: string[] }[];

  if (forcedTopic) {
    themesToGenerate = [{
      theme: forcedTopic,
      rubrique: 'politique', // Will be overridden by LLM
      keywords: [],
    }];
  } else {
    const candidates = detectThemeCandidates(eclairages, archives, existingGuideSlugs);
    if (candidates.length === 0) {
      console.log('[guides] No themes with sufficient coverage for a guide. Skipping.');
      process.exit(0);
    }

    themesToGenerate = candidates.slice(0, 1).map(c => ({
      theme: c.theme,
      rubrique: c.rubrique,
      keywords: c.keywords,
    }));

    console.log(`[guides] Theme selected: ${themesToGenerate[0].theme} (score: ${candidates[0].score})`);
  }

  mkdirSync(guidesDir, { recursive: true });

  for (const themeInfo of themesToGenerate) {
    console.log(`\n[guides] Generating guide: ${themeInfo.theme}`);

    // Gather related content for context
    const relatedEclairages = eclairages.filter((e: any) => {
      const text = [e.titre, e.mot_cle_principal, ...(e.mots_cles_secondaires || [])].join(' ').toLowerCase();
      return text.includes(themeInfo.theme.toLowerCase()) ||
             themeInfo.keywords.some(kw => text.includes(kw.toLowerCase()));
    });

    const relatedArticles = articles.filter(a =>
      a.titre.toLowerCase().includes(themeInfo.theme.toLowerCase())
    ).slice(0, 30);

    const eclairageContext = relatedEclairages.map((e: any) => ({
      slug: e.slug,
      titre: e.titre,
      mot_cle: e.mot_cle_principal,
      date: e.date_publication,
    }));

    const articleContext = relatedArticles.map(a => ({
      titre: a.titre,
      source: a.source,
      url: a.url,
      date: a.date,
    }));

    const userMessage = `Date : ${today}

## Thème du guide
${themeInfo.theme}

## Éclairages liés existants (${relatedEclairages.length})
${eclairageContext.length > 0 ? JSON.stringify(eclairageContext, null, 1) : 'Aucun éclairage lié.'}

## Articles récents sur le sujet (${relatedArticles.length})
${articleContext.length > 0 ? JSON.stringify(articleContext, null, 1) : 'Pas d\'articles récents.'}

## Instructions
Produis un guide complet et evergreen sur "${themeInfo.theme}".
Le guide doit rester pertinent pendant des mois, avec des informations de fond et de contexte.
Les éclairages liés seront référencés automatiquement — concentre-toi sur le contenu de fond.`;

    try {
      const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 16000);

      let data: any;
      try {
        data = JSON.parse(extractJson(response));
      } catch {
        console.error('  ✗ LLM returned invalid JSON');
        console.error('  Raw (first 500):', response.slice(0, 500));
        continue;
      }

      // Ensure required fields
      data.date_publication = data.date_publication || today;
      data.date_modification = data.date_modification || today;
      data.slug = data.slug || slugify(data.titre || themeInfo.theme);

      // Link related éclairages
      data.eclairages_lies = relatedEclairages.map((e: any) => e.slug);

      // Auto-generate liens_internes from eclairages
      data.liens_internes = relatedEclairages.map((e: any) => ({
        type: 'eclairage',
        slug: e.slug,
        titre: e.titre,
      }));

      // Pipeline metadata
      data.meta = {
        nb_articles_source: relatedArticles.length,
        modele: `${config.provider}/${config.model}`,
        version_pipeline: PIPELINE_VERSION,
      };

      // Validate
      const validation = GuideSchema.safeParse(data);
      if (!validation.success) {
        console.warn('  ⚠ Zod validation warnings:');
        for (const issue of validation.error.issues) {
          console.warn(`    - ${issue.path.join('.')}: ${issue.message}`);
        }
      }

      // Write output
      const outPath = new URL(`${data.slug}.json`, guidesDir);
      writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

      // Back-link: update eclairages with guide_parent
      for (const e of relatedEclairages) {
        if (!e.guide_parent) {
          e.guide_parent = data.slug;
          const eclairagePath = new URL(`${e.slug}.json`, eclairagesDir);
          writeFileSync(eclairagePath, JSON.stringify(e, null, 2), 'utf-8');
          console.log(`  → Updated eclairage ${e.slug} with guide_parent: ${data.slug}`);
        }
      }

      console.log(`  ✓ Wrote guide: ${data.slug}.json`);
      console.log(`    Titre : ${data.titre}`);
      console.log(`    Mot-clé : ${data.mot_cle_principal}`);
      console.log(`    ${data.chapitres?.length || 0} chapitres, ${data.faq?.length || 0} FAQ, ${data.sources?.length || 0} sources`);
      console.log(`    ${data.eclairages_lies?.length || 0} éclairages liés`);
    } catch (err: any) {
      console.error(`  ✗ Generation failed: ${err.message}`);
      continue;
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Guide generation failed:', err);
  process.exit(1);
});
