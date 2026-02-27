/**
 * generate-ia.ts — Generate dedicated AI/Tech section via LLM
 *
 * Uses topics.json from clustering to find IA-related topics,
 * then sends full article clusters to the LLM for rich multi-source coverage.
 *
 * Produces 10-15 items organized by sub-section:
 *   - annonces: product launches, new versions
 *   - regulation: AI Act, lawsuits, legislation
 *   - recherche: papers, benchmarks, breakthroughs
 *   - business: fundraising, acquisitions, market
 *   - societe: societal impact, ethics, jobs
 *
 * Usage: npx tsx scripts/generate-ia.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { IASchema } from './schemas/ia.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import type { RawArticle } from './fetch-news.js';
import type { TopicsData, Topic } from './cluster-topics.js';

const PIPELINE_VERSION = '5.0.0';

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
  ligne_editoriale: string | null;
}

const IA_KEYWORDS = [
  'intelligence artificielle', 'ia ', ' ia', 'ai ', ' ai',
  'machine learning', 'deep learning', 'llm', 'gpt', 'claude',
  'gemini', 'openai', 'anthropic', 'mistral', 'deepseek',
  'chatbot', 'génératif', 'generative', 'algorithme',
  'modèle de langage', 'language model', 'neural',
  'automatisation', 'robot', 'deepfake', 'données personnelles',
  'transformer', 'foundation model', 'agi', 'reasoning',
  'benchmark', 'open source ai', 'open-source ai', 'compute',
  'gpu', 'nvidia', 'training run', 'fine-tuning', 'finetuning',
  'rlhf', 'alignment', 'safety', 'llama', 'copilot',
  'diffusion model', 'text-to-image', 'text-to-video',
  'multimodal', 'agentic', 'ai agent', 'rag ',
  'regulation', 'ai act', 'regulat', 'frontier model',
  'artificial intelligence', 'chatgpt', 'perplexity',
  'semiconductor', 'chip', 'data center', 'compute cluster',
  'synthetic data', 'reinforcement learning',
];

const SYSTEM_PROMPT = `Tu es le rédacteur en chef de la section IA & Tech de Citoyens.ai — un journal de référence internationale.

## Mission
Produire une section IA/Tech complète et ambitieuse : 10-15 actualités organisées par sous-section.
L'angle est citoyen : "qu'est-ce que ça change pour les gens, la démocratie, les droits, l'économie".

## Sous-sections obligatoires
Chaque fait doit être classé dans UNE sous-section :
- "annonces" : lancements produit, nouvelles versions, annonces d'entreprise
- "regulation" : AI Act, procès, législation, décisions gouvernementales
- "recherche" : papers, benchmarks, avancées scientifiques
- "business" : levées de fonds, acquisitions, chiffres de marché
- "societe" : impact sur l'emploi, l'éthique, les droits, la culture

## Principes éditoriaux
- Factuel, non-partisan
- Expliquer le "pourquoi ça compte" pour chaque fait
- Transparence sur la propriété des médias sources
- Détecter les doubles standards dans la couverture de l'IA
- MULTI-SOURCES : pour chaque fait, cite TOUTES les sources disponibles (2-3 minimum quand elles existent)
- Utilise UNIQUEMENT les URLs fournies dans les articles

## Format de sortie JSON

{
  "faits_ia": [
    {
      "titre": "string (titre court, max 80 car)",
      "sous_section": "annonces|regulation|recherche|business|societe",
      "resume": "string (2-3 phrases factuelles, en croisant les sources)",
      "pourquoi_ca_compte": "string (1-2 phrases : impact citoyen)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }],
      "lien": "string|null"
    }
  ],

  "regard_croise_ia": {
    "sujet": "string (le sujet IA le plus couvert par des sources différentes)",
    "contexte": "string (faits objectifs, 2-3 phrases)",
    "couvertures": [
      {
        "source": "string",
        "type": "string",
        "angle": "string",
        "ton": "critique|factuel|alarmiste|complaisant|neutre|engage",
        "url": "string (URL valide)",
        "citation_cle": "string"
      }
    ],
    "analyse_coherence": "string (150-200 mots)",
    "biais_detectes": ["string"],
    "ce_quil_faut_retenir": "string"
  }
}

## Règles de volume
- 10-15 faits IA minimum, répartis sur TOUTES les sous-sections
- Le regard croisé IA est OPTIONNEL — ne le génère que si un sujet IA est couvert par 3+ sources avec des angles différents
- Privilégie les sujets couverts par PLUSIEURS sources
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

function isIARelated(article: RawArticle): boolean {
  const text = `${article.titre} ${article.description}`.toLowerCase();
  return IA_KEYWORDS.some(kw => text.includes(kw));
}

function isTopicIARelated(topic: Topic, articlesById: Map<string, RawArticle>): boolean {
  // Check rubriques
  if (topic.rubriques_detectees.some(r => r === 'ia' || r === 'tech')) return true;
  // Check if majority of articles match IA keywords
  const arts = topic.article_ids
    .map(id => articlesById.get(id))
    .filter(Boolean) as RawArticle[];
  const iaCount = arts.filter(isIARelated).length;
  return iaCount >= Math.ceil(arts.length * 0.4);
}

async function main() {
  loadEnv();

  const config = resolveConfig();
  console.log(`[ia] Using LLM: ${config.provider} / ${config.model}`);

  // Load raw articles
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  const articlesById = new Map(articles.map(a => [a.id, a]));

  // Load topics (from clustering)
  const topicsPath = new URL('../src/data/.pipeline/topics.json', import.meta.url);
  let topicsData: TopicsData | null = null;
  try {
    topicsData = JSON.parse(readFileSync(topicsPath, 'utf-8'));
  } catch {
    console.warn('⚠ topics.json not found — falling back to keyword filtering');
  }

  // Identify IA-related topics from clustering
  let iaTopics: Topic[] = [];
  let iaArticles: RawArticle[] = [];

  if (topicsData) {
    iaTopics = topicsData.topics.filter(t => isTopicIARelated(t, articlesById));
    // Collect all articles from IA topics
    const iaArticleIds = new Set<string>();
    for (const t of iaTopics) {
      for (const id of t.article_ids) iaArticleIds.add(id);
    }
    iaArticles = Array.from(iaArticleIds)
      .map(id => articlesById.get(id))
      .filter(Boolean) as RawArticle[];
    console.log(`[ia] Found ${iaTopics.length} IA/tech topics (${iaArticles.length} articles) from clustering`);
  } else {
    iaArticles = articles.filter(isIARelated);
    console.log(`[ia] ${iaArticles.length} IA-related articles (keyword match, no clustering)`);
  }

  // Also add standalone IA articles not in any topic
  if (topicsData) {
    const topicArticleIds = new Set(iaTopics.flatMap(t => t.article_ids));
    const standaloneIA = articles.filter(a => !topicArticleIds.has(a.id) && isIARelated(a));
    if (standaloneIA.length > 0) {
      iaArticles.push(...standaloneIA);
      console.log(`[ia] +${standaloneIA.length} standalone IA articles (not in topics)`);
    }
  }

  if (iaArticles.length < 3) {
    console.warn('⚠ Very few IA articles. Including general tech articles.');
    const techArticles = articles.filter(a => (a as any).rubrique === 'tech');
    iaArticles.push(...techArticles.slice(0, 20));
  }

  console.log(`[ia] Total: ${iaArticles.length} articles for IA section`);

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

  // Find latest IA decryptage
  let latestIADecryptageSlug: string | null = null;
  try {
    const decryptDir = new URL('../src/data/decryptages/', import.meta.url);
    const files = readdirSync(decryptDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const data = JSON.parse(readFileSync(new URL(f, decryptDir), 'utf-8'));
      if (data.rubrique === 'ia') {
        latestIADecryptageSlug = data.slug;
      }
    }
  } catch { /* no decryptages */ }

  // Build ownership context
  const sourcesUsed = Array.from(new Set(iaArticles.map(a => a.source))) as string[];
  const ownershipLines: string[] = [];
  for (const sourceName of sourcesUsed) {
    const feed = feedByName.get(sourceName);
    if (!feed?.groupe) continue;
    const groupe = groupeById.get(feed.groupe);
    if (!groupe) continue;
    const owners = groupe.proprietaires.map(p => `${p.nom} [${p.type}]`).join(', ');
    ownershipLines.push(`- ${sourceName} : ${groupe.nom} (${owners}). Orientation : ${groupe.orientation}`);
  }

  // Build article list — organized by topic if available
  let articlesContext: string;

  if (iaTopics.length > 0) {
    const topicBlocks = iaTopics.slice(0, 25).map(t => {
      const arts = t.article_ids
        .map(id => articlesById.get(id))
        .filter(Boolean) as RawArticle[];
      const artLines = arts.map(a => {
        const auteurStr = a.auteur ? ` | Auteur: ${a.auteur}` : '';
        return `  - [${a.source}] (${a.type}, ${a.pays})${auteurStr}
    Titre: ${a.titre}
    URL: ${a.url}
    Desc: ${a.description.slice(0, 250)}`;
      }).join('\n');
      return `### Topic: ${t.titre} [${t.score.nb_sources} sources, score ${t.score.total}]
${artLines}`;
    }).join('\n\n');

    articlesContext = `## Topics IA/Tech pré-clusterisés (${iaTopics.length} topics)

${topicBlocks}`;
  } else {
    const articleList = iaArticles.slice(0, 80).map(a => ({
      titre: a.titre,
      source: a.source,
      url: a.url,
      type: a.type,
      date: a.date,
      desc: a.description.slice(0, 250),
    }));
    articlesContext = `## Articles IA et tech (${iaArticles.length} articles)
${JSON.stringify(articleList, null, 1)}`;
  }

  const userMessage = `Date : ${today}

## Contexte de propriété des médias
${ownershipLines.join('\n') || 'Aucune donnée disponible'}

${articlesContext}

Génère la section IA/Tech complète : 10-15 faits répartis par sous-section + regard croisé IA si pertinent.
IMPORTANT : cite TOUTES les sources disponibles pour chaque sujet (pas juste 1 lien). Chaque topic a souvent 2-5 articles de sources différentes — exploite cette richesse.`;

  console.log('\n[ia] Generating IA section...');
  const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 12000);

  let data: any;
  try {
    data = JSON.parse(extractJson(response));
  } catch {
    console.error('✗ LLM returned invalid JSON');
    console.error('Raw (first 500):', response.slice(0, 500));
    process.exit(1);
  }

  // Enrich with ownership data
  const enrichSource = (sourceName: string) => {
    const feed = feedByName.get(sourceName);
    const groupe = feed?.groupe ? groupeById.get(feed.groupe) : null;
    if (!groupe) return null;
    return {
      nom: groupe.nom,
      proprietaire: groupe.proprietaires.map(p => p.nom).join(', '),
      type_proprietaire: groupe.proprietaires[0]?.type || 'independant',
      orientation: groupe.orientation,
    };
  };

  for (const fait of data.faits_ia || []) {
    for (const s of fait.sources || []) {
      s.groupe_media = enrichSource(s.nom);
    }
  }

  if (data.regard_croise_ia) {
    for (const c of data.regard_croise_ia.couvertures || []) {
      c.groupe_media = enrichSource(c.source);
    }
  }

  // Build final output
  const iaData = {
    date: today,
    genere_a: new Date().toISOString(),
    faits_ia: data.faits_ia || [],
    regard_croise_ia: data.regard_croise_ia || null,
    dernier_decryptage_slug: latestIADecryptageSlug,
    meta: {
      nb_articles_ia: iaArticles.length,
      nb_topics_ia: iaTopics.length,
      modele: `${config.provider}/${config.model}`,
      version_pipeline: PIPELINE_VERSION,
    },
  };

  // Validate
  const validation = IASchema.safeParse(iaData);
  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // Write
  const iaPath = new URL('../src/data/ia.json', import.meta.url);
  writeFileSync(iaPath, JSON.stringify(iaData, null, 2), 'utf-8');

  // Stats by sub-section
  const bySousSection: Record<string, number> = {};
  for (const f of iaData.faits_ia) {
    const ss = f.sous_section || 'unknown';
    bySousSection[ss] = (bySousSection[ss] || 0) + 1;
  }

  const totalSources = iaData.faits_ia.reduce((sum: number, f: any) => sum + (f.sources?.length || 0), 0);

  console.log(`\n✓ Wrote ia.json for ${today}`);
  console.log(`  ${iaData.faits_ia.length} faits IA (${totalSources} source citations)`);
  console.log(`  Par sous-section: ${Object.entries(bySousSection).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  Regard croisé IA : ${iaData.regard_croise_ia ? iaData.regard_croise_ia.sujet : 'non'}`);
  console.log(`  Dernier décryptage IA : ${latestIADecryptageSlug || 'aucun'}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline generate-ia failed:', err);
  process.exit(1);
});
