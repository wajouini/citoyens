/**
 * cluster-topics.ts — Group raw articles into thematic topics via embeddings
 *
 * Pipeline v6: DBSCAN-inspired clustering with coherence-based post-split
 *
 *   1. Embed article titles+descriptions
 *   2. Compute pairwise cosine similarity matrix
 *   3. DBSCAN clustering with strict threshold + min_samples
 *   4. Post-split large/incoherent clusters via hierarchical sub-clustering
 *   5. Score each topic by newsworthiness (with coherence penalty)
 *   6. Auto-detect rubriques from article metadata (majority vote, not keyword soup)
 *   7. Generate representative titles (medoid-based)
 *   8. Compute quality metrics (silhouette, cohesion)
 *   9. Write topics.json + clustering-viz.json + embeddings cache
 *
 * Usage:
 *   npx tsx scripts/cluster-topics.ts            # Normal run (calls embedding API)
 *   npx tsx scripts/cluster-topics.ts --offline   # Re-cluster from cached embeddings
 *
 * @version 6.0.0
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { RawArticle } from './fetch-news.js';
// @ts-ignore
import TSNE from 'tsne-js';

const PIPELINE_VERSION = '6.0.0';

// ---------- Thresholds ----------
// Higher = stricter clustering, fewer mega-clusters
const SIMILARITY_THRESHOLD_OPENAI = 0.62;
const SIMILARITY_THRESHOLD_GEMINI = 0.85;
const EMBEDDING_BATCH_SIZE = 2048;

// DBSCAN-style parameters
const MIN_CLUSTER_SIZE = 2;     // Singletons = noise, not topics
const MIN_SAMPLES = 2;          // Core point needs >= 2 neighbors within threshold
const SOFT_MAX_CLUSTER_SIZE = 12;  // Soft cap — split only if coherence is also low
const HARD_MAX_CLUSTER_SIZE = 40;  // Hard cap — always split above this regardless

// Post-split parameters
const COHERENCE_SPLIT_THRESHOLD = 0.80; // Split clusters with avg pairwise sim below this
const SPLIT_MIN_SIZE = 2;               // Minimum sub-cluster size after split

type EmbeddingProvider = 'openai' | 'gemini';

function resolveEmbeddingConfig(): { provider: EmbeddingProvider; apiKey: string; model: string } {
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'text-embedding-3-small' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'text-embedding-004' };
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
  coherence: number;
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
    quality: {
      avg_silhouette: number;
      avg_coherence: number;
      pct_clustered: number;
      pct_multi_source: number;
    };
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
  const GEMINI_BATCH = 100;

  for (let i = 0; i < texts.length; i += GEMINI_BATCH) {
    const batch = texts.slice(i, i + GEMINI_BATCH);
    const batchNum = Math.floor(i / GEMINI_BATCH) + 1;
    const totalBatches = Math.ceil(texts.length / GEMINI_BATCH);
    if (totalBatches > 1) {
      console.log(`  [embed] Batch ${batchNum}/${totalBatches} (${batch.length} texts)`);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map(text => ({
          model: `models/gemini-embedding-001`,
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

/** Precompute full NxN similarity matrix (symmetric, diagonal = 1) */
function buildSimilarityMatrix(embeddings: number[][]): Float32Array {
  const n = embeddings.length;
  const matrix = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    matrix[i * n + i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      matrix[i * n + j] = sim;
      matrix[j * n + i] = sim;
    }
  }
  return matrix;
}

/** Average pairwise cosine similarity within a set of indices */
function clusterCoherence(indices: number[], simMatrix: Float32Array, n: number): number {
  if (indices.length < 2) return 1.0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      sum += simMatrix[indices[i] * n + indices[j]];
      count++;
    }
  }
  return count > 0 ? sum / count : 1.0;
}

/** Find the medoid (most central point) of a cluster */
function findMedoid(indices: number[], simMatrix: Float32Array, n: number): number {
  let bestIdx = indices[0];
  let bestAvgSim = -1;
  for (const i of indices) {
    let sumSim = 0;
    for (const j of indices) {
      if (i !== j) sumSim += simMatrix[i * n + j];
    }
    const avgSim = sumSim / (indices.length - 1);
    if (avgSim > bestAvgSim) {
      bestAvgSim = avgSim;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ---------- DBSCAN Clustering ----------

function dbscanCluster(
  simMatrix: Float32Array,
  n: number,
  threshold: number,
  minSamples: number,
): number[] {
  // Build neighbor lists
  const neighbors: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    neighbors[i] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && simMatrix[i * n + j] >= threshold) {
        neighbors[i].push(j);
      }
    }
  }

  // Classify points: core (>= minSamples neighbors) vs border vs noise
  const isCore = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (neighbors[i].length >= minSamples) {
      isCore[i] = 1;
    }
  }

  // BFS expansion from core points
  const labels = new Int32Array(n).fill(-1); // -1 = noise
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (!isCore[i] || labels[i] !== -1) continue;

    // Start new cluster from this core point
    const queue = [i];
    labels[i] = clusterId;

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of neighbors[current]) {
        if (labels[neighbor] !== -1) continue;
        labels[neighbor] = clusterId;
        // Only expand from core points
        if (isCore[neighbor]) {
          queue.push(neighbor);
        }
      }
    }
    clusterId++;
  }

  return Array.from(labels);
}

// ---------- Post-split large/incoherent clusters ----------

/** K-medoids bisecting split: split a cluster in two by finding two medoids and assigning */
function bisectCluster(
  indices: number[],
  simMatrix: Float32Array,
  n: number,
): [number[], number[]] {
  // Find the two most distant points as initial medoids
  let maxDist = Infinity;
  let m1 = 0, m2 = 1;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const sim = simMatrix[indices[i] * n + indices[j]];
      if (sim < maxDist) {
        maxDist = sim;
        m1 = i;
        m2 = j;
      }
    }
  }

  // Assign each point to the closer medoid
  const groupA: number[] = [];
  const groupB: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const simToA = simMatrix[indices[i] * n + indices[m1]];
    const simToB = simMatrix[indices[i] * n + indices[m2]];
    if (simToA >= simToB) {
      groupA.push(indices[i]);
    } else {
      groupB.push(indices[i]);
    }
  }

  return [groupA, groupB];
}

/** Recursively split a cluster until all sub-clusters are <= maxSize */
function splitClusterRecursive(
  indices: number[],
  simMatrix: Float32Array,
  n: number,
  maxSize: number,
  depth: number = 0,
): number[][] {
  if (indices.length <= maxSize || depth > 6) return [indices];

  const [groupA, groupB] = bisectCluster(indices, simMatrix, n);

  // If bisection is degenerate (one side too small), stop splitting
  if (groupA.length < SPLIT_MIN_SIZE || groupB.length < SPLIT_MIN_SIZE) {
    return [indices];
  }

  // Recursively split if still too large
  const results: number[][] = [];
  for (const group of [groupA, groupB]) {
    if (group.length > maxSize) {
      results.push(...splitClusterRecursive(group, simMatrix, n, maxSize, depth + 1));
    } else {
      results.push(group);
    }
  }

  return results;
}

function splitCluster(
  indices: number[],
  simMatrix: Float32Array,
  n: number,
  threshold: number,
): number[][] {
  if (indices.length <= SPLIT_MIN_SIZE) return [indices];

  // Use a tighter threshold for sub-clustering
  const tighterThreshold = threshold + (1 - threshold) * 0.3;

  // Mini-DBSCAN within this cluster
  const subLabels = new Int32Array(indices.length).fill(-1);
  let subClusterId = 0;

  // Build local neighbor lists with tighter threshold
  const localNeighbors: number[][] = new Array(indices.length);
  for (let li = 0; li < indices.length; li++) {
    localNeighbors[li] = [];
    for (let lj = 0; lj < indices.length; lj++) {
      if (li !== lj && simMatrix[indices[li] * n + indices[lj]] >= tighterThreshold) {
        localNeighbors[li].push(lj);
      }
    }
  }

  // BFS from densest points
  const order = Array.from({ length: indices.length }, (_, i) => i)
    .sort((a, b) => localNeighbors[b].length - localNeighbors[a].length);

  for (const seed of order) {
    if (subLabels[seed] !== -1) continue;
    if (localNeighbors[seed].length === 0) continue;

    const queue = [seed];
    subLabels[seed] = subClusterId;

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of localNeighbors[current]) {
        if (subLabels[neighbor] !== -1) continue;
        subLabels[neighbor] = subClusterId;
        if (localNeighbors[neighbor].length > 0) {
          queue.push(neighbor);
        }
      }
    }
    subClusterId++;
  }

  // Group by sub-label
  const subClusters = new Map<number, number[]>();
  const localNoise: number[] = [];
  for (let li = 0; li < indices.length; li++) {
    const label = subLabels[li];
    if (label === -1) {
      localNoise.push(li);
      continue;
    }
    if (!subClusters.has(label)) subClusters.set(label, []);
    subClusters.get(label)!.push(indices[li]);
  }

  // Assign local noise points to the nearest sub-cluster IF sufficiently similar
  const assignThreshold = threshold * 0.95; // Slightly lower than main threshold
  for (const li of localNoise) {
    let bestLabel = -1;
    let bestSim = -1;
    for (const [label, members] of subClusters) {
      let sumSim = 0;
      for (const m of members) {
        sumSim += simMatrix[indices[li] * n + m];
      }
      const avgSim = sumSim / members.length;
      if (avgSim > bestSim) {
        bestSim = avgSim;
        bestLabel = label;
      }
    }
    if (bestLabel !== -1 && bestSim >= assignThreshold) {
      subClusters.get(bestLabel)!.push(indices[li]);
    }
    // Otherwise: article stays unassigned and will become unclustered
  }

  // Collect results, filtering out sub-clusters that are too small
  const results: number[][] = [];
  for (const [, subIndices] of subClusters) {
    if (subIndices.length >= SPLIT_MIN_SIZE) {
      results.push(subIndices);
    }
  }

  // If DBSCAN-split didn't help, try k-medoids bisection
  if (results.length <= 1) {
    return splitClusterRecursive(indices, simMatrix, n, HARD_MAX_CLUSTER_SIZE);
  }
  return results;
}

function postProcessClusters(
  clusterMap: Map<number, number[]>,
  simMatrix: Float32Array,
  n: number,
  threshold: number,
): Map<number, number[]> {
  const result = new Map<number, number[]>();
  let nextId = 0;

  for (const [, indices] of clusterMap) {
    const coherence = clusterCoherence(indices, simMatrix, n);

    // Split if:
    //   - low coherence (mixed topics in one cluster)
    //   - above soft cap AND coherence isn't great
    //   - above hard cap regardless
    const shouldSplit =
      coherence < COHERENCE_SPLIT_THRESHOLD ||
      (indices.length > SOFT_MAX_CLUSTER_SIZE && coherence < 0.90) ||
      indices.length > HARD_MAX_CLUSTER_SIZE;

    if (shouldSplit) {
      const subClusters = splitCluster(indices, simMatrix, n, threshold);
      for (const sub of subClusters) {
        // Recursively bisect if still above hard cap
        if (sub.length > HARD_MAX_CLUSTER_SIZE) {
          const reSplit = splitClusterRecursive(sub, simMatrix, n, HARD_MAX_CLUSTER_SIZE);
          for (const rs of reSplit) {
            result.set(nextId++, rs);
          }
        } else {
          result.set(nextId++, sub);
        }
      }
    } else {
      result.set(nextId++, indices);
    }
  }

  return result;
}

// ---------- Quality Metrics ----------

function computeSilhouette(
  labels: number[],
  simMatrix: Float32Array,
  n: number,
): number {
  // Silhouette using cosine similarity (higher = better)
  // s(i) = (b(i) - a(i)) / max(a(i), b(i))
  // where a(i) = avg distance to same cluster, b(i) = min avg distance to other clusters
  // We convert similarity to distance: d = 1 - sim

  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (label === -1) continue;
    if (!clusterMap.has(label)) clusterMap.set(label, []);
    clusterMap.get(label)!.push(i);
  }

  const clusterIds = Array.from(clusterMap.keys());
  if (clusterIds.length < 2) return 0;

  let totalSilhouette = 0;
  let count = 0;

  for (const [label, members] of clusterMap) {
    if (members.length < 2) continue;

    for (const i of members) {
      // a(i): avg distance to same cluster members
      let aSum = 0;
      for (const j of members) {
        if (i !== j) aSum += (1 - simMatrix[i * n + j]);
      }
      const a = aSum / (members.length - 1);

      // b(i): min avg distance to other clusters
      let minB = Infinity;
      for (const [otherLabel, otherMembers] of clusterMap) {
        if (otherLabel === label) continue;
        let bSum = 0;
        for (const j of otherMembers) {
          bSum += (1 - simMatrix[i * n + j]);
        }
        const b = bSum / otherMembers.length;
        if (b < minB) minB = b;
      }

      const s = minB === Infinity ? 0 : (minB - a) / Math.max(a, minB);
      totalSilhouette += s;
      count++;
    }
  }

  return count > 0 ? totalSilhouette / count : 0;
}

// ---------- Rubrique Detection (improved: majority vote from metadata) ----------

function detectRubriques(articles: RawArticle[]): string[] {
  const scores: Record<string, number> = {};

  // Primary signal: article metadata rubrique (weighted by count)
  for (const a of articles) {
    if (a.rubrique && a.rubrique !== 'generaliste') {
      scores[a.rubrique] = (scores[a.rubrique] || 0) + 1;
    }
  }

  // Only return rubriques that represent >= 30% of articles in the cluster
  const minCount = Math.max(1, Math.ceil(articles.length * 0.3));

  return Object.entries(scores)
    .filter(([, v]) => v >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2) // Max 2 rubriques per topic
    .map(([k]) => k);
}

// ---------- Title Generation (medoid-based) ----------

function generateTitle(
  articles: RawArticle[],
  indices: number[],
  simMatrix: Float32Array,
  n: number,
): string {
  // Find the medoid article (most representative)
  const medoidIdx = findMedoid(indices, simMatrix, n);
  const medoidArticle = articles[medoidIdx];

  // Prefer French title from most reliable source near the medoid
  if (medoidArticle) {
    let best = medoidArticle.titre;
    if (best.length > 100) {
      best = best.slice(0, 97) + '...';
    }
    return best;
  }

  // Fallback: original heuristic
  const sorted = [...articles].sort((a, b) => {
    if (a.langue === 'fr' && b.langue !== 'fr') return -1;
    if (a.langue !== 'fr' && b.langue === 'fr') return 1;
    return b.fiabilite - a.fiabilite;
  });
  let best = sorted[0].titre;
  if (best.length > 100) best = best.slice(0, 97) + '...';
  return best;
}

// ---------- Scoring (with coherence factor) ----------

function computeScore(
  articleIds: string[],
  articlesById: Map<string, RawArticle>,
  coherence: number,
): TopicScore {
  const arts = articleIds.map(id => articlesById.get(id)).filter(Boolean) as RawArticle[];
  if (arts.length === 0) {
    return { nb_sources: 0, diversite_types: 0, fiabilite_moy: 0, fraicheur_h: 999, couverture_mixte: false, coherence: 0, total: 0 };
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

  // Scoring: sources matter but capped lower, coherence adds a multiplier
  const srcScore = Math.min(sources.length / 5, 1) * 30;   // 30 pts (was 35, capped at 5 not 6)
  const divScore = Math.min(types.length / 3, 1) * 15;      // 15 pts (was 20)
  const fiabScore = (fiabiliteMoy / 5) * 15;                 // 15 pts
  const freshScore = Math.max(0, 1 - fraicheurH / 24) * 20;  // 20 pts
  const mixteBonus = couvertureMixte ? 5 : 0;                 // 5 pts (was 10)
  const coherenceScore = coherence * 15;                      // 15 pts NEW — reward tight clusters

  const total = Math.round(srcScore + divScore + fiabScore + freshScore + mixteBonus + coherenceScore);

  return {
    nb_sources: sources.length,
    diversite_types: types.length,
    fiabilite_moy: +fiabiliteMoy.toFixed(1),
    fraicheur_h: +fraicheurH.toFixed(1),
    couverture_mixte: couvertureMixte,
    coherence: +coherence.toFixed(3),
    total: Math.min(total, 100),
  };
}

// ---------- Main ----------

async function main() {
  loadEnv();

  const isOffline = process.argv.includes('--offline');
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  const outDir = new URL('../src/data/.pipeline/', import.meta.url);
  const embCachePath = new URL('embeddings-cache.json', outDir);

  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`[cluster] Loaded ${articles.length} articles`);

  let embeddings: number[][];
  let modelName: string;

  if (isOffline) {
    // Load cached embeddings
    console.log(`[cluster] Offline mode — loading cached embeddings...`);
    try {
      const cache = JSON.parse(readFileSync(embCachePath, 'utf-8'));
      embeddings = cache.embeddings;
      modelName = cache.model || 'cached';
      console.log(`✓ Loaded ${embeddings.length} cached embeddings (${embeddings[0]?.length || 0}d)`);
    } catch {
      console.error('✗ No cached embeddings found. Run without --offline first.');
      process.exit(1);
    }
  } else {
    let embConfig: ReturnType<typeof resolveEmbeddingConfig>;
    try {
      embConfig = resolveEmbeddingConfig();
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }

    modelName = `${embConfig.provider}/${embConfig.model}`;
    const threshold = embConfig.provider === 'gemini' ? SIMILARITY_THRESHOLD_GEMINI : SIMILARITY_THRESHOLD_OPENAI;
    console.log(`[cluster] Using ${modelName} embeddings (threshold=${threshold})`);

    const textsToEmbed = articles.map(a =>
      `${a.titre} | ${a.description.slice(0, 200)}`
    );

    console.log(`[cluster] Embedding ${articles.length} articles...`);
    const startEmbed = Date.now();
    embeddings = await fetchEmbeddings(textsToEmbed, embConfig.provider, embConfig.apiKey, embConfig.model);
    const embedTime = ((Date.now() - startEmbed) / 1000).toFixed(1);
    console.log(`✓ Embeddings computed in ${embedTime}s (${embeddings[0]?.length || 0} dimensions)`);

    // Cache embeddings for offline re-clustering
    mkdirSync(outDir, { recursive: true });
    writeFileSync(embCachePath, JSON.stringify({
      model: modelName,
      date: new Date().toISOString(),
      article_ids: articles.map(a => a.id),
      embeddings,
    }), 'utf-8');
    console.log(`✓ Embeddings cached to embeddings-cache.json`);
  }

  // Determine threshold based on model
  const isGemini = modelName.includes('gemini');
  const threshold = isGemini ? SIMILARITY_THRESHOLD_GEMINI : SIMILARITY_THRESHOLD_OPENAI;

  const articlesById = new Map(articles.map(a => [a.id, a]));
  const n = embeddings.length;

  // 1. Build similarity matrix
  console.log(`[cluster] Building ${n}x${n} similarity matrix...`);
  const startSim = Date.now();
  const simMatrix = buildSimilarityMatrix(embeddings);
  const simTime = ((Date.now() - startSim) / 1000).toFixed(1);
  console.log(`✓ Similarity matrix in ${simTime}s`);

  // 2. DBSCAN clustering
  console.log(`[cluster] Running DBSCAN (threshold=${threshold}, minSamples=${MIN_SAMPLES})...`);
  const startCluster = Date.now();
  const rawLabels = dbscanCluster(simMatrix, n, threshold, MIN_SAMPLES);
  const clusterTime = ((Date.now() - startCluster) / 1000).toFixed(1);

  // Group by label
  const rawClusterMap = new Map<number, number[]>();
  const noiseIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    const label = rawLabels[i];
    if (label === -1) {
      noiseIndices.push(i);
      continue;
    }
    if (!rawClusterMap.has(label)) rawClusterMap.set(label, []);
    rawClusterMap.get(label)!.push(i);
  }

  console.log(`✓ DBSCAN: ${rawClusterMap.size} clusters, ${noiseIndices.length} noise points (${clusterTime}s)`);

  // 3. Post-process: split oversized or incoherent clusters
  console.log(`[cluster] Post-processing: splitting large/incoherent clusters...`);
  const processedMap = postProcessClusters(rawClusterMap, simMatrix, n, threshold);

  // Filter out sub-clusters that are too small after splitting
  const finalMap = new Map<number, number[]>();
  let finalId = 0;
  const returnedToNoise: number[] = [];
  for (const [, indices] of processedMap) {
    if (indices.length >= MIN_CLUSTER_SIZE) {
      finalMap.set(finalId++, indices);
    } else {
      returnedToNoise.push(...indices);
    }
  }

  // Find any articles lost during sub-clustering (not in any final cluster or initial noise)
  const coveredIndices = new Set<number>(noiseIndices);
  returnedToNoise.forEach(i => coveredIndices.add(i));
  for (const [, indices] of finalMap) {
    for (const idx of indices) coveredIndices.add(idx);
  }
  const lostIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!coveredIndices.has(i)) lostIndices.push(i);
  }

  const allNoise = [...noiseIndices, ...returnedToNoise, ...lostIndices];
  console.log(`✓ Post-split: ${finalMap.size} topics, ${allNoise.length} unclustered (${lostIndices.length} recovered from sub-split noise)`);

  // 4. Compute quality metrics
  const finalLabels = new Int32Array(n).fill(-1);
  for (const [label, indices] of finalMap) {
    for (const idx of indices) {
      finalLabels[idx] = label;
    }
  }
  const silhouette = computeSilhouette(Array.from(finalLabels), simMatrix, n);

  // 5. Build Topic objects
  const topics: Topic[] = [];
  const unclustered: string[] = allNoise.map(i => articles[i].id);

  for (const [, indices] of finalMap) {
    const articleIds = indices.map(i => articles[i].id);
    const arts = indices.map(i => articles[i]);
    const sources = Array.from(new Set(arts.map(a => a.source)));
    const types = Array.from(new Set(arts.map(a => a.type)));
    const pays = Array.from(new Set(arts.map(a => a.pays)));
    const rubriques = detectRubriques(arts);
    const coherence = clusterCoherence(indices, simMatrix, n);

    topics.push({
      id: '', // assigned after sort
      titre: generateTitle(articles, indices, simMatrix, n),
      article_ids: articleIds,
      sources,
      types,
      rubriques_detectees: rubriques,
      pays_concernes: pays,
      score: computeScore(articleIds, articlesById, coherence),
    });
  }

  // Sort by score
  topics.sort((a, b) => b.score.total - a.score.total);

  // Assign IDs
  for (let i = 0; i < topics.length; i++) {
    topics[i].id = `topic-${String(i + 1).padStart(3, '0')}`;
  }

  // 6. t-SNE Projection for admin viz
  console.log(`[cluster] Running t-SNE projection for 2D visualization...`);
  const tsneStart = Date.now();
  const tsneModel = new TSNE({
    dim: 2,
    perplexity: Math.min(30, Math.floor(n / 3)),
    earlyExaggeration: 4.0,
    learningRate: 100.0,
    nIter: 500,
    metric: 'euclidean'
  });

  tsneModel.init({ data: embeddings, type: 'dense' });
  tsneModel.run();
  const coords = tsneModel.getOutputScaled();
  const tsneTime = ((Date.now() - tsneStart) / 1000).toFixed(1);
  console.log(`✓ t-SNE projection done in ${tsneTime}s`);

  // Map article to topic for viz
  const articleToTopic = new Map<string, { id: string; titre: string; coherence: number }>();
  for (const t of topics) {
    for (const aId of t.article_ids) {
      articleToTopic.set(aId, { id: t.id, titre: t.titre, coherence: t.score.coherence });
    }
  }

  const vizData = articles.map((a, i) => {
    const topic = articleToTopic.get(a.id);
    return {
      id: a.id,
      titre: a.titre,
      source: a.source,
      rubrique: a.rubrique,
      type: a.type,
      topic_id: topic ? topic.id : null,
      topic_titre: topic ? topic.titre : null,
      coherence: topic ? topic.coherence : null,
      x: coords[i][0],
      y: coords[i][1],
    };
  });

  const avgCoherence = topics.length > 0
    ? topics.reduce((s, t) => s + t.score.coherence, 0) / topics.length
    : 0;
  const multiSrcTopics = topics.filter(t => t.score.nb_sources >= 2).length;
  const articlesInTopics = topics.reduce((s, t) => s + t.article_ids.length, 0);
  const clusteredPct = articlesInTopics / n * 100;

  const today = new Date().toISOString().split('T')[0];
  const output: TopicsData = {
    date: today,
    generated_at: new Date().toISOString(),
    topics,
    unclustered_ids: unclustered,
    meta: {
      nb_articles: n,
      nb_topics: topics.length,
      nb_unclustered: allNoise.length,
      modele: modelName,
      version_pipeline: PIPELINE_VERSION,
      quality: {
        avg_silhouette: +silhouette.toFixed(3),
        avg_coherence: +avgCoherence.toFixed(3),
        pct_clustered: +clusteredPct.toFixed(1),
        pct_multi_source: +(multiSrcTopics / Math.max(topics.length, 1) * 100).toFixed(1),
      },
    },
  };

  mkdirSync(outDir, { recursive: true });

  const outPath = new URL('topics.json', outDir);
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  const vizPath = new URL('clustering-viz.json', outDir);
  writeFileSync(vizPath, JSON.stringify(vizData, null, 2), 'utf-8');

  console.log(`\n✓ Wrote topics.json for ${today} (pipeline v${PIPELINE_VERSION})`);
  console.log(`  ${topics.length} topics (${allNoise.length} unclustered — ${clusteredPct.toFixed(0)}% clustered)`);
  console.log(`  ${multiSrcTopics} topics with 2+ sources`);
  console.log(`\n  Quality metrics:`);
  console.log(`    Avg silhouette:  ${silhouette.toFixed(3)}`);
  console.log(`    Avg coherence:   ${avgCoherence.toFixed(3)}`);
  console.log(`\n  Top 15 topics by score:`);
  for (const t of topics.slice(0, 15)) {
    console.log(`    [${t.score.total}] coh=${t.score.coherence.toFixed(2)} ${t.article_ids.length} art | ${t.score.nb_sources} src | ${t.rubriques_detectees.join(',') || '-'} | ${t.titre.slice(0, 70)}`);
  }

  // Size distribution
  const sizeHist: Record<string, number> = {};
  for (const t of topics) {
    const bucket = t.article_ids.length <= 5 ? `${t.article_ids.length}` : t.article_ids.length <= 10 ? '6-10' : '11-15';
    sizeHist[bucket] = (sizeHist[bucket] || 0) + 1;
  }
  console.log(`\n  Size distribution:`);
  for (const [k, v] of Object.entries(sizeHist).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${k} articles: ${v} topics`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline cluster-topics failed:', err);
  process.exit(1);
});
