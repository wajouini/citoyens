/**
 * cluster-topics.ts — Group raw articles into thematic topics via embeddings
 *
 * Step 1 of the editorial pipeline:
 *   1. Embed article titles+descriptions with OpenAI text-embedding-3-small
 *   2. Compute pairwise cosine similarity
 *   3. Agglomerative clustering with threshold
 *   4. Score each topic by newsworthiness
 *   5. Auto-detect rubriques from article metadata
 *   6. Write topics.json for downstream scripts
 *
 * Usage: npx tsx scripts/cluster-topics.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '5.0.0';
const SIMILARITY_THRESHOLD_OPENAI = 0.58;
const SIMILARITY_THRESHOLD_GEMINI = 0.80;
const EMBEDDING_BATCH_SIZE = 2048;
const MIN_CLUSTER_SIZE = 1;

type EmbeddingProvider = 'openai' | 'gemini';

function resolveEmbeddingConfig(): { provider: EmbeddingProvider; apiKey: string; model: string } {
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'text-embedding-3-small' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-embedding-001' };
  }
  throw new Error('No embedding API key found. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
}

// ---------- Types ----------

export interface TopicScore {
  nb_sources: number;
  diversite_types: number;
  fiabilite_moy: number;
  fraicheur_h: number;
  couverture_mixte: boolean;
  total: number;
}

export interface Topic {
  id: string;
  titre: string;
  article_ids: string[];
  sources: string[];
  types: string[];
  rubriques_detectees: string[];
  pays_concernes: string[];
  score: TopicScore;
}

export interface TopicsData {
  date: string;
  generated_at: string;
  topics: Topic[];
  unclustered_ids: string[];
  meta: {
    nb_articles: number;
    nb_topics: number;
    nb_unclustered: number;
    modele: string;
    version_pipeline: string;
  };
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

// ---------- Embedding APIs ----------

async function fetchOpenAIEmbeddings(texts: string[], apiKey: string, model: string): Promise<number[][]> {
  const allEmbeddings: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);
    if (totalBatches > 1) {
      console.log(`  [embed] Batch ${batchNum}/${totalBatches} (${batch.length} texts)`);
    }

    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenAI embeddings API error ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json() as { data: { embedding: number[]; index: number }[] };
    for (const item of data.data) {
      allEmbeddings[i + item.index] = item.embedding;
    }
  }
  return allEmbeddings;
}

async function fetchGeminiEmbeddings(texts: string[], apiKey: string, model: string): Promise<number[][]> {
  const allEmbeddings: number[][] = new Array(texts.length);
  const GEMINI_BATCH = 100; // Gemini batch embed limit

  for (let i = 0; i < texts.length; i += GEMINI_BATCH) {
    const batch = texts.slice(i, i + GEMINI_BATCH);
    const batchNum = Math.floor(i / GEMINI_BATCH) + 1;
    const totalBatches = Math.ceil(texts.length / GEMINI_BATCH);
    if (totalBatches > 1) {
      console.log(`  [embed] Batch ${batchNum}/${totalBatches} (${batch.length} texts)`);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map(text => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: 'CLUSTERING',
        })),
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Gemini embeddings API error ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json() as { embeddings: { values: number[] }[] };
    for (let j = 0; j < data.embeddings.length; j++) {
      allEmbeddings[i + j] = data.embeddings[j].values;
    }
  }
  return allEmbeddings;
}

async function fetchEmbeddings(texts: string[], provider: EmbeddingProvider, apiKey: string, model: string): Promise<number[][]> {
  if (provider === 'gemini') return fetchGeminiEmbeddings(texts, apiKey, model);
  return fetchOpenAIEmbeddings(texts, apiKey, model);
}

// ---------- Math ----------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------- Clustering ----------

const MAX_CLUSTER_SIZE = 30;

function clusterArticles(
  embeddings: number[][],
  threshold: number,
): number[] {
  const n = embeddings.length;

  // Build neighbor lists: for each article, track which others are above threshold
  // Use sorted edge list approach for efficiency
  const neighbors: number[][] = new Array(n);
  for (let i = 0; i < n; i++) neighbors[i] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim >= threshold) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  // Greedy clustering: pick seeds with most neighbors, grow clusters
  const assigned = new Int32Array(n).fill(-1);
  let clusterId = 0;

  // Sort articles by descending neighbor count (densest first)
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => neighbors[b].length - neighbors[a].length);

  for (const seed of order) {
    if (assigned[seed] !== -1) continue;

    // Start new cluster with this seed
    const cluster = [seed];
    assigned[seed] = clusterId;

    // Add neighbors that are mutually close to MOST existing cluster members
    const candidates = neighbors[seed]
      .filter(j => assigned[j] === -1)
      .sort((a, b) => {
        // prefer candidates with higher similarity to seed
        return cosineSimilarity(embeddings[b], embeddings[seed])
             - cosineSimilarity(embeddings[a], embeddings[seed]);
      });

    for (const cand of candidates) {
      if (assigned[cand] !== -1) continue;
      if (cluster.length >= MAX_CLUSTER_SIZE) break;

      // Average-linkage check: candidate must be similar to >=60% of cluster
      let closeCount = 0;
      for (const m of cluster) {
        if (cosineSimilarity(embeddings[cand], embeddings[m]) >= threshold) {
          closeCount++;
        }
      }
      if (closeCount >= cluster.length * 0.6) {
        cluster.push(cand);
        assigned[cand] = clusterId;
      }
    }

    clusterId++;
  }

  // Assign any remaining unassigned as individual clusters
  for (let i = 0; i < n; i++) {
    if (assigned[i] === -1) {
      assigned[i] = clusterId++;
    }
  }

  return Array.from(assigned);
}

// ---------- Rubrique Detection ----------

const RUBRIQUE_KEYWORDS: Record<string, string[]> = {
  politique: ['politique', 'gouvernement', 'parlement', 'assemblée', 'sénat', 'député', 'ministre', 'président', 'élection', 'vote', 'loi', 'réforme', 'opposition', 'parti', 'politics', 'parliament', 'election'],
  economie: ['économie', 'économique', 'PIB', 'inflation', 'budget', 'marché', 'bourse', 'entreprise', 'croissance', 'dette', 'economy', 'market', 'gdp', 'recession', 'trade'],
  tech: ['tech', 'numérique', 'startup', 'logiciel', 'application', 'données', 'cyber', 'digital', 'software', 'hardware', 'smartphone', 'internet', 'computing'],
  ia: ['intelligence artificielle', ' ia ', ' ai ', 'machine learning', 'deep learning', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic', 'mistral', 'chatbot', 'génératif', 'generative', 'neural', 'transformer', 'foundation model', 'alignment', 'rlhf', 'diffusion model', 'multimodal', 'agentic'],
  science: ['science', 'scientifique', 'recherche', 'étude', 'découverte', 'espace', 'climat', 'environnement', 'santé', 'médecine', 'research', 'study', 'climate', 'health', 'vaccine'],
  societe: ['société', 'social', 'éducation', 'immigration', 'sécurité', 'justice', 'droits', 'manifestation', 'grève', 'logement', 'society', 'education', 'immigration', 'crime', 'protest'],
  culture: ['culture', 'cinéma', 'musique', 'film', 'livre', 'art', 'exposition', 'festival', 'césar', 'cannes', 'movie', 'music', 'book', 'award'],
  international: ['international', 'guerre', 'conflit', 'diplomatie', 'ONU', 'OTAN', 'NATO', 'war', 'conflict', 'diplomacy', 'sanctions', 'treaty', 'invasion', 'occupation'],
};

function detectRubriques(articles: RawArticle[]): string[] {
  const scores: Record<string, number> = {};

  // Count from article metadata
  for (const a of articles) {
    if (a.rubrique && a.rubrique !== 'generaliste') {
      scores[a.rubrique] = (scores[a.rubrique] || 0) + 2;
    }
  }

  // Keyword analysis on titles
  const allText = articles.map(a => `${a.titre} ${a.description}`).join(' ').toLowerCase();
  for (const [rubrique, keywords] of Object.entries(RUBRIQUE_KEYWORDS)) {
    for (const kw of keywords) {
      if (allText.includes(kw.toLowerCase())) {
        scores[rubrique] = (scores[rubrique] || 0) + 1;
      }
    }
  }

  return Object.entries(scores)
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

// ---------- Title Generation ----------

function generateTitle(articles: RawArticle[]): string {
  // Pick the most representative title: prefer French, from highest-reliability source
  const sorted = [...articles].sort((a, b) => {
    if (a.langue === 'fr' && b.langue !== 'fr') return -1;
    if (a.langue !== 'fr' && b.langue === 'fr') return 1;
    return b.fiabilite - a.fiabilite;
  });

  let best = sorted[0].titre;
  // Truncate to ~80 chars if needed
  if (best.length > 100) {
    best = best.slice(0, 97) + '...';
  }
  return best;
}

// ---------- Scoring ----------

function computeScore(
  articleIds: string[],
  articlesById: Map<string, RawArticle>,
): TopicScore {
  const arts = articleIds.map(id => articlesById.get(id)).filter(Boolean) as RawArticle[];
  if (arts.length === 0) {
    return { nb_sources: 0, diversite_types: 0, fiabilite_moy: 0, fraicheur_h: 999, couverture_mixte: false, total: 0 };
  }

  const sources = Array.from(new Set(arts.map(a => a.source)));
  const types = Array.from(new Set(arts.map(a => a.type)));
  const fiabilites = arts.map(a => a.fiabilite);
  const fiabiliteMoy = fiabilites.reduce((s, v) => s + v, 0) / fiabilites.length;

  const newest = Math.max(...arts.map(a => new Date(a.date).getTime()));
  const fraicheurH = Math.max(0, (Date.now() - newest) / 3600000);

  const hasFr = arts.some(a => a.type !== 'etranger');
  const hasIntl = arts.some(a => a.type === 'etranger');
  const couvertureMixte = hasFr && hasIntl;

  const srcScore = Math.min(sources.length / 6, 1) * 35;
  const divScore = Math.min(types.length / 4, 1) * 20;
  const fiabScore = (fiabiliteMoy / 5) * 15;
  const freshScore = Math.max(0, 1 - fraicheurH / 24) * 20;
  const mixteBonus = couvertureMixte ? 10 : 0;

  const total = Math.round(srcScore + divScore + fiabScore + freshScore + mixteBonus);

  return {
    nb_sources: sources.length,
    diversite_types: types.length,
    fiabilite_moy: +fiabiliteMoy.toFixed(1),
    fraicheur_h: +fraicheurH.toFixed(1),
    couverture_mixte: couvertureMixte,
    total: Math.min(total, 100),
  };
}

// ---------- Main ----------

async function main() {
  loadEnv();

  let embConfig: ReturnType<typeof resolveEmbeddingConfig>;
  try {
    embConfig = resolveEmbeddingConfig();
  } catch (e: any) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`[cluster] Loaded ${articles.length} articles`);
  const threshold = embConfig.provider === 'gemini' ? SIMILARITY_THRESHOLD_GEMINI : SIMILARITY_THRESHOLD_OPENAI;
  console.log(`[cluster] Using ${embConfig.provider}/${embConfig.model} embeddings + agglomerative clustering (threshold=${threshold})`);

  const articlesById = new Map(articles.map(a => [a.id, a]));

  // 1. Build text to embed: title + truncated description
  const textsToEmbed = articles.map(a =>
    `${a.titre} | ${a.description.slice(0, 200)}`
  );

  // 2. Fetch embeddings
  console.log(`[cluster] Embedding ${articles.length} articles...`);
  const startEmbed = Date.now();
  const embeddings = await fetchEmbeddings(textsToEmbed, embConfig.provider, embConfig.apiKey, embConfig.model);
  const embedTime = ((Date.now() - startEmbed) / 1000).toFixed(1);
  console.log(`✓ Embeddings computed in ${embedTime}s (${embeddings[0]?.length || 0} dimensions)`);

  // 3. Agglomerative clustering
  console.log(`[cluster] Running agglomerative clustering...`);
  const startCluster = Date.now();
  const labels = clusterArticles(embeddings, threshold);
  const clusterTime = ((Date.now() - startCluster) / 1000).toFixed(1);

  // 4. Group articles by cluster label
  const clusterMap = new Map<number, string[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!clusterMap.has(label)) clusterMap.set(label, []);
    clusterMap.get(label)!.push(articles[i].id);
  }

  console.log(`✓ Clustering done in ${clusterTime}s — ${clusterMap.size} raw clusters`);

  // 5. Build Topic objects
  const topics: Topic[] = [];
  const unclustered: string[] = [];
  let topicIdx = 0;

  for (const [, articleIds] of Array.from(clusterMap.entries())) {
    if (articleIds.length < MIN_CLUSTER_SIZE) {
      unclustered.push(...articleIds);
      continue;
    }

    const arts = articleIds.map(id => articlesById.get(id)!);
    const sources = Array.from(new Set(arts.map(a => a.source))) as string[];
    const types = Array.from(new Set(arts.map(a => a.type))) as string[];
    const pays = Array.from(new Set(arts.map(a => a.pays))) as string[];
    const rubriques = detectRubriques(arts);

    topicIdx++;
    topics.push({
      id: `topic-${String(topicIdx).padStart(3, '0')}`,
      titre: generateTitle(arts),
      article_ids: articleIds,
      sources,
      types,
      rubriques_detectees: rubriques,
      pays_concernes: pays,
      score: computeScore(articleIds, articlesById),
    });
  }

  // Sort by score
  topics.sort((a, b) => b.score.total - a.score.total);

  // Re-number after sort
  for (let i = 0; i < topics.length; i++) {
    topics[i].id = `topic-${String(i + 1).padStart(3, '0')}`;
  }

  const today = new Date().toISOString().split('T')[0];
  const output: TopicsData = {
    date: today,
    generated_at: new Date().toISOString(),
    topics,
    unclustered_ids: unclustered,
    meta: {
      nb_articles: articles.length,
      nb_topics: topics.length,
      nb_unclustered: unclustered.length,
      modele: `${embConfig.provider}/${embConfig.model}`,
      version_pipeline: PIPELINE_VERSION,
    },
  };

  const outDir = new URL('../src/data/.pipeline/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const outPath = new URL('topics.json', outDir);
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  const multiSrcTopics = topics.filter(t => t.score.nb_sources >= 2).length;
  const clusteredPct = ((articles.length - unclustered.length) / articles.length * 100).toFixed(0);

  console.log(`\n✓ Wrote topics.json for ${today}`);
  console.log(`  ${topics.length} topics (${unclustered.length} unclustered — ${clusteredPct}% clustered)`);
  console.log(`  ${multiSrcTopics} topics with 2+ sources`);
  console.log(`\n  Top 10 topics by score:`);
  for (const t of topics.slice(0, 10)) {
    console.log(`    [${t.score.total}] ${t.titre.slice(0, 70)} (${t.score.nb_sources} src, ${t.article_ids.length} art)`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline cluster-topics failed:', err);
  process.exit(1);
});
