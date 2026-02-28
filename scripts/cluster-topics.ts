/**
 * cluster-topics.ts — Group raw articles into thematic topics via embeddings
 *
 * Pipeline v7.1: Star Clustering + LLM post-processing + editorial scoring
 *
 *   1. Embed article titles+descriptions (richer semantic signal)
 *   2. Compute pairwise cosine similarity matrix
 *   3. Star Clustering: medoid-centric, non-transitive
 *   4. Post-split large/incoherent clusters
 *   5. Outlier pruning (medoid-sim)
 *   6. Noise recovery: assign unclustered to nearest cluster
 *   7. LLM cleanup: verify each cluster's articles are on-topic (remove off-topic)
 *   8. LLM titles: generate meaningful cluster titles
 *   9. Reassign orphans to thematic catch-all clusters
 *  10. Score, detect rubriques, compute quality metrics
 *  11. Write topics.json + clustering-viz.json + embeddings cache
 *
 * Usage:
 *   npx tsx scripts/cluster-topics.ts            # Normal run (calls embedding + LLM APIs)
 *   npx tsx scripts/cluster-topics.ts --offline   # Re-cluster from cached embeddings
 *   npx tsx scripts/cluster-topics.ts --no-llm    # Skip LLM post-processing
 *
 * @version 7.1.0
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { RawArticle } from './fetch-news.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
// @ts-ignore
import TSNE from 'tsne-js';

const PIPELINE_VERSION = '7.1.0';

// ---------- Thresholds ----------
// Star Clustering thresholds (title+description embeddings, non-transitive)
const SIMILARITY_THRESHOLD_OPENAI = 0.65;   // OpenAI text-embedding-3-small
const SIMILARITY_THRESHOLD_GEMINI = 0.84;   // Gemini — title+desc embeddings
const EMBEDDING_BATCH_SIZE = 2048;

// Noise recovery — assign unclustered articles to nearest cluster (lower threshold)
const NOISE_RECOVERY_THRESHOLD_OPENAI = 0.60;
const NOISE_RECOVERY_THRESHOLD_GEMINI = 0.83;

// DBSCAN-style parameters
const MIN_CLUSTER_SIZE = 2;     // Singletons = noise, not topics
const MIN_SAMPLES = 2;          // Core point needs >= 2 neighbors within threshold
const SOFT_MAX_CLUSTER_SIZE = 10;
const HARD_MAX_CLUSTER_SIZE = 15;

// Post-split parameters
const COHERENCE_SPLIT_THRESHOLD = 0.87; // tight coherence requirement
const SPLIT_MIN_SIZE = 2;               // Minimum sub-cluster size after split

// Outlier pruning: remove articles that don't belong after clustering
const OUTLIER_MEDOID_MIN_SIM = 0.82;    // Article must be >= this sim to cluster medoid
const OUTLIER_K_RATIO = 0.5;            // Check against 50% of cluster members

export type EmbeddingProvider = 'openai' | 'gemini';

export function resolveEmbeddingConfig(): { provider: EmbeddingProvider; apiKey: string; model: string } {
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'text-embedding-3-small' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'text-embedding-004' };
  }
  throw new Error('No embedding API key found. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
}

// ---------- Types ----------

export type EditorialFlag =
  | 'droit_international' | 'justice_sociale' | 'colonialisme'
  | 'imperialisme' | 'laicite' | 'equite_economique'
  | 'droits_humains' | 'ecologie_sociale' | 'double_standard' | 'antifascisme';

interface FeedMeta {
  nom: string;
  groupe: string | null;
  orientation: string | null;
  type: string;
}

interface GroupeMediaData {
  id: string;
  axes: Record<string, number>;
  medias: string[];
}

export interface TopicScore {
  nb_sources: number;
  diversite_types: number;
  fiabilite_moy: number;
  fraicheur_h: number;
  couverture_mixte: boolean;
  coherence: number;
  investigation_bonus: number;
  axes_alignment: number;
  pluralite: number;
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
  editorial_flags: string[];
  axes_profile: Record<string, number>;
  orientations: string[];
  has_investigation_source: boolean;
  tag?: string;
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
    nb_signal_faible: number;
    nb_solo_investigation: number;
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

// ---------- Editorial data loaders ----------

function loadEditorialData(): {
  feedByName: Map<string, FeedMeta>;
  groupeById: Map<string, GroupeMediaData>;
} {
  const feedsPath = new URL('../src/data/feeds.json', import.meta.url);
  const groupesPath = new URL('../src/data/groupes-medias.json', import.meta.url);

  let feeds: FeedMeta[] = [];
  let groupes: GroupeMediaData[] = [];

  try { feeds = JSON.parse(readFileSync(feedsPath, 'utf-8')); } catch { /* ignore */ }
  try { groupes = JSON.parse(readFileSync(groupesPath, 'utf-8')); } catch { /* ignore */ }

  return {
    feedByName: new Map(feeds.map(f => [f.nom, f])),
    groupeById: new Map(groupes.map(g => [g.id, g])),
  };
}

export function computeEditorialMeta(
  articleIds: string[],
  articlesById: Map<string, RawArticle>,
  feedByName: Map<string, FeedMeta>,
  groupeById: Map<string, GroupeMediaData>,
): {
  orientations: string[];
  has_investigation_source: boolean;
  axes_profile: Record<string, number>;
  pluralite_score: number;
} {
  const arts = articleIds.map(id => articlesById.get(id)).filter(Boolean) as RawArticle[];

  // Collect orientations
  const orientationSet = new Set<string>();
  for (const a of arts) {
    const feed = feedByName.get(a.source);
    if (feed?.orientation) orientationSet.add(feed.orientation);
  }

  // Check for investigation sources
  const hasInvestigation = arts.some(a => a.type === 'investigation' || a.type === 'fact-check');

  // Compute average axes profile across source groups
  const axesSums: Record<string, number> = {};
  const axesCounts: Record<string, number> = {};
  const seenGroups = new Set<string>();

  for (const a of arts) {
    const feed = feedByName.get(a.source);
    if (!feed?.groupe || seenGroups.has(feed.groupe)) continue;
    seenGroups.add(feed.groupe);
    const groupe = groupeById.get(feed.groupe);
    if (!groupe?.axes) continue;
    for (const [axe, val] of Object.entries(groupe.axes)) {
      axesSums[axe] = (axesSums[axe] || 0) + val;
      axesCounts[axe] = (axesCounts[axe] || 0) + 1;
    }
  }

  const axesProfile: Record<string, number> = {};
  for (const [axe, sum] of Object.entries(axesSums)) {
    axesProfile[axe] = +(sum / axesCounts[axe]).toFixed(1);
  }

  // Pluralite score: how diverse are the orientations (0-1)
  const orientations = [...orientationSet];
  const hasLeft = orientations.some(o => o.includes('gauche'));
  const hasRight = orientations.some(o => o.includes('droit'));
  const hasCenter = orientations.some(o => o === 'centre');
  const diversityCount = [hasLeft, hasRight, hasCenter].filter(Boolean).length;
  const pluraliteScore = Math.min(diversityCount / 3 + orientations.length / 6, 1);

  return {
    orientations,
    has_investigation_source: hasInvestigation,
    axes_profile: axesProfile,
    pluralite_score: +pluraliteScore.toFixed(2),
  };
}

function classifyUnclustered(
  unclusteredIndices: number[],
  articles: RawArticle[],
  feedByName: Map<string, FeedMeta>,
): { signal_faible: number[]; solo_investigation: number[]; standard: number[] } {
  const result = {
    signal_faible: [] as number[],
    solo_investigation: [] as number[],
    standard: [] as number[],
  };

  for (const idx of unclusteredIndices) {
    const a = articles[idx];
    const feed = feedByName.get(a.source);
    const isInvestigation = a.type === 'investigation' || a.type === 'fact-check';
    const isProgressiveSource = feed?.orientation === 'gauche' || feed?.orientation === 'centre-gauche';

    if (isInvestigation && a.fiabilite >= 4) {
      result.solo_investigation.push(idx);
    } else if (isProgressiveSource && a.fiabilite >= 4) {
      result.signal_faible.push(idx);
    } else {
      result.standard.push(idx);
    }
  }

  return result;
}

// ---------- Env ----------

export function loadEnv() {
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

export async function fetchEmbeddings(texts: string[], provider: EmbeddingProvider, apiKey: string, model: string): Promise<number[][]> {
  if (provider === 'gemini') return fetchGeminiEmbeddings(texts, apiKey, model);
  return fetchOpenAIEmbeddings(texts, apiKey, model);
}

// ---------- Math ----------

export function cosineSimilarity(a: number[], b: number[]): number {
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
export function buildSimilarityMatrix(embeddings: number[][]): Float32Array {
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
export function clusterCoherence(indices: number[], simMatrix: Float32Array, n: number): number {
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
export function findMedoid(indices: number[], simMatrix: Float32Array, n: number): number {
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

// ---------- DBSCAN Clustering (kept for Phase 3 noise recovery) ----------

function dbscanCluster(
  simMatrix: Float32Array,
  n: number,
  threshold: number,
  minSamples: number,
): number[] {
  const neighbors: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    neighbors[i] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && simMatrix[i * n + j] >= threshold) {
        neighbors[i].push(j);
      }
    }
  }
  const isCore = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (neighbors[i].length >= minSamples) isCore[i] = 1;
  }
  const labels = new Int32Array(n).fill(-1);
  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (!isCore[i] || labels[i] !== -1) continue;
    const queue = [i];
    labels[i] = clusterId;
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of neighbors[current]) {
        if (labels[neighbor] !== -1) continue;
        labels[neighbor] = clusterId;
        if (isCore[neighbor]) queue.push(neighbor);
      }
    }
    clusterId++;
  }
  return Array.from(labels);
}

// ---------- Star Clustering (non-transitive, medoid-centric) ----------
// Unlike DBSCAN, Star Clustering avoids transitive chaining.
// Each cluster has a clear center (medoid), and EVERY article in the cluster
// must have direct similarity >= threshold to the medoid.
//
// Algorithm:
//   1. Find the article pair with highest mutual similarity → seed a cluster
//   2. Greedily add articles that have sim >= threshold to the current medoid
//   3. Recompute medoid after additions
//   4. Verify all members still pass the medoid check; remove those that don't
//   5. Mark this cluster as done, repeat from step 1 with remaining articles

function starCluster(
  simMatrix: Float32Array,
  n: number,
  threshold: number,
  minSize: number,
): Map<number, number[]> {
  const assigned = new Uint8Array(n); // 0 = unassigned, 1 = assigned
  const clusters = new Map<number, number[]>();
  let nextId = 0;

  // Precompute: for each article, count how many others are >= threshold
  const density = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j && simMatrix[i * n + j] >= threshold) count++;
    }
    density[i] = count;
  }

  // Iterate: find densest unassigned point as seed
  for (;;) {
    // Find unassigned point with most unassigned neighbors >= threshold
    let bestSeed = -1;
    let bestDensity = 0;
    for (let i = 0; i < n; i++) {
      if (assigned[i]) continue;
      let count = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i && !assigned[j] && simMatrix[i * n + j] >= threshold) count++;
      }
      if (count > bestDensity) {
        bestDensity = count;
        bestSeed = i;
      }
    }

    if (bestSeed === -1 || bestDensity < minSize - 1) break; // No more viable seeds

    // Grow cluster from seed: add all unassigned articles with sim >= threshold to medoid
    let members = [bestSeed];
    let medoid = bestSeed;

    // Iterative grow + refine medoid (3 rounds)
    for (let round = 0; round < 3; round++) {
      // Collect candidates: unassigned with sim >= threshold to medoid
      const candidates: { idx: number; sim: number }[] = [];
      for (let i = 0; i < n; i++) {
        if (assigned[i] || members.includes(i)) continue;
        const sim = simMatrix[i * n + medoid];
        if (sim >= threshold) {
          candidates.push({ idx: i, sim });
        }
      }

      if (candidates.length === 0 && round === 0) break; // Nothing to add

      // Add candidates sorted by similarity (highest first)
      candidates.sort((a, b) => b.sim - a.sim);
      for (const c of candidates) {
        if (!members.includes(c.idx)) {
          members.push(c.idx);
        }
      }

      // Cap cluster size
      if (members.length > HARD_MAX_CLUSTER_SIZE) {
        // Keep only the closest to medoid
        const withSim = members.map(m => ({ idx: m, sim: simMatrix[m * n + medoid] }));
        withSim.sort((a, b) => b.sim - a.sim);
        members = withSim.slice(0, HARD_MAX_CLUSTER_SIZE).map(w => w.idx);
      }

      // Recompute medoid
      medoid = findMedoid(members, simMatrix, n);

      // Verify: remove members below threshold to new medoid
      members = members.filter(m =>
        m === medoid || simMatrix[m * n + medoid] >= threshold
      );
    }

    if (members.length >= minSize) {
      for (const m of members) assigned[m] = 1;
      clusters.set(nextId++, members);
    } else {
      // Seed and its neighbors don't form a viable cluster
      // Mark seed as assigned to prevent infinite loop
      assigned[bestSeed] = 1;
    }
  }

  return clusters;
}

// ---------- Post-split large/incoherent clusters ----------

/** K-medoids bisecting split: split a cluster in two by finding two medoids and assigning.
 *  Uses iterative refinement (Lloyd-style) to avoid degenerate single-point splits. */
function bisectCluster(
  indices: number[],
  simMatrix: Float32Array,
  n: number,
): [number[], number[]] {
  // Find the two most distant points as initial medoids
  let minSim = Infinity;
  let m1 = 0, m2 = 1;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const sim = simMatrix[indices[i] * n + indices[j]];
      if (sim < minSim) {
        minSim = sim;
        m1 = i;
        m2 = j;
      }
    }
  }

  // Iterative assignment + medoid update (3 rounds max)
  let medoid1 = indices[m1];
  let medoid2 = indices[m2];
  let groupA: number[] = [];
  let groupB: number[] = [];

  for (let round = 0; round < 3; round++) {
    groupA = [];
    groupB = [];
    for (const idx of indices) {
      const simToA = simMatrix[idx * n + medoid1];
      const simToB = simMatrix[idx * n + medoid2];
      if (simToA >= simToB) {
        groupA.push(idx);
      } else {
        groupB.push(idx);
      }
    }

    // Ensure neither group is empty
    if (groupA.length === 0 || groupB.length === 0) break;

    // Update medoids to the actual medoid of each group
    medoid1 = findMedoid(groupA, simMatrix, n);
    medoid2 = findMedoid(groupB, simMatrix, n);
  }

  // If degenerate (one side < 2), force a balanced split based on similarity to medoid1
  if (groupA.length < 2 || groupB.length < 2) {
    const medoid = findMedoid(indices, simMatrix, n);
    const sorted = [...indices].sort((a, b) =>
      simMatrix[a * n + medoid] - simMatrix[b * n + medoid]
    );
    const half = Math.floor(sorted.length / 2);
    groupA = sorted.slice(0, half);
    groupB = sorted.slice(half);
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

export function computeSilhouette(
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

export function detectRubriques(articles: RawArticle[]): string[] {
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

export function generateTitle(
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

// ---------- Scoring (with editorial weighting) ----------

export function computeScore(
  articleIds: string[],
  articlesById: Map<string, RawArticle>,
  coherence: number,
  feedByName?: Map<string, FeedMeta>,
  groupeById?: Map<string, GroupeMediaData>,
): TopicScore {
  const arts = articleIds.map(id => articlesById.get(id)).filter(Boolean) as RawArticle[];
  if (arts.length === 0) {
    return {
      nb_sources: 0, diversite_types: 0, fiabilite_moy: 0, fraicheur_h: 999,
      couverture_mixte: false, coherence: 0,
      investigation_bonus: 0, axes_alignment: 0, pluralite: 0, total: 0,
    };
  }

  const sources: string[] = Array.from(new Set(arts.map(a => a.source)));
  const types: string[] = Array.from(new Set(arts.map(a => a.type)));
  const fiabilites = arts.map(a => a.fiabilite);
  const fiabiliteMoy = fiabilites.reduce((s, v) => s + v, 0) / fiabilites.length;

  const newest = Math.max(...arts.map(a => new Date(a.date).getTime()));
  const fraicheurH = Math.max(0, (Date.now() - newest) / 3600000);

  const hasFr = arts.some(a => a.type !== 'etranger');
  const hasIntl = arts.some(a => a.type === 'etranger');
  const couvertureMixte = hasFr && hasIntl;

  // --- Core dimensions (rebalanced for editorial space) ---
  const srcScore = Math.min(sources.length / 5, 1) * 20;    // 20 pts (was 30)
  const divScore = Math.min(types.length / 3, 1) * 10;      // 10 pts (was 15)
  const fiabScore = (fiabiliteMoy / 5) * 15;                 // 15 pts (unchanged)
  const freshScore = Math.max(0, 1 - fraicheurH / 24) * 15;  // 15 pts (was 20)
  const mixteBonus = couvertureMixte ? 5 : 0;                 // 5 pts (unchanged)
  const coherenceScore = coherence * 10;                      // 10 pts (was 15)

  // --- NEW: Editorial dimensions ---

  // Investigation bonus: +10 if topic has investigation or fact-check sources
  const hasInvestigation = types.includes('investigation') || types.includes('fact-check');
  const investigationBonus = hasInvestigation ? 10 : 0;

  // Axes alignment: sources with universalist axes (1-2) = higher bonus
  let axesAlignmentRaw = 0;
  if (feedByName && groupeById) {
    const axesScores: number[] = [];
    const seenGroups = new Set<string>();
    for (const a of arts) {
      const feed = feedByName.get(a.source);
      if (!feed?.groupe || seenGroups.has(feed.groupe)) continue;
      seenGroups.add(feed.groupe);
      const groupe = groupeById.get(feed.groupe);
      if (!groupe?.axes) continue;
      const axeValues = Object.values(groupe.axes);
      const avgAxe = axeValues.reduce((s, v) => s + v, 0) / axeValues.length;
      axesScores.push(avgAxe);
    }
    if (axesScores.length > 0) {
      const avgAxes = axesScores.reduce((s, v) => s + v, 0) / axesScores.length;
      // avgAxes 1-5; lower = better; transform: (5 - avg) / 4 → 0 to 1
      axesAlignmentRaw = Math.max(0, (5 - avgAxes) / 4);
    }
  }
  const axesScore = +(axesAlignmentRaw * 10).toFixed(1); // 0-10 pts

  // Pluralite: diversity of editorial orientations
  let pluraliteScore = 0;
  if (feedByName) {
    const orientations = new Set<string>();
    for (const a of arts) {
      const feed = feedByName.get(a.source);
      if (feed?.orientation) orientations.add(feed.orientation);
    }
    pluraliteScore = +((Math.min(orientations.size / 3, 1)) * 5).toFixed(1); // 0-5 pts
  }

  const total = Math.round(
    srcScore + divScore + fiabScore + freshScore + mixteBonus +
    coherenceScore + investigationBonus + axesScore + pluraliteScore
  );

  return {
    nb_sources: sources.length,
    diversite_types: types.length,
    fiabilite_moy: +fiabiliteMoy.toFixed(1),
    fraicheur_h: +fraicheurH.toFixed(1),
    couverture_mixte: couvertureMixte,
    coherence: +coherence.toFixed(3),
    investigation_bonus: investigationBonus,
    axes_alignment: axesScore,
    pluralite: pluraliteScore,
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

    // v7: Embed title + description for richer semantic signal.
    // Higher thresholds compensate for inflated baselines.
    // LLM post-processing cleans up any off-topic articles.
    const textsToEmbed = articles.map(a => {
      const desc = (a.description || '').slice(0, 200);
      return desc ? `${a.titre} | ${desc}` : a.titre;
    });

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
  const { feedByName, groupeById } = loadEditorialData();
  console.log(`[editorial] Loaded ${feedByName.size} feeds, ${groupeById.size} media groups`);
  const n = embeddings.length;

  // 1. Build similarity matrix
  console.log(`[cluster] Building ${n}x${n} similarity matrix...`);
  const startSim = Date.now();
  const simMatrix = buildSimilarityMatrix(embeddings);
  const simTime = ((Date.now() - startSim) / 1000).toFixed(1);
  console.log(`✓ Similarity matrix in ${simTime}s`);

  // 2. Star Clustering (non-transitive, medoid-centric)
  console.log(`[cluster] Running Star Clustering (threshold=${threshold}, minSize=${MIN_CLUSTER_SIZE})...`);
  const startCluster = Date.now();
  const rawClusterMap = starCluster(simMatrix, n, threshold, MIN_CLUSTER_SIZE);
  const clusterTime = ((Date.now() - startCluster) / 1000).toFixed(1);

  // Find unclustered articles
  const clustered = new Set<number>();
  for (const [, indices] of rawClusterMap) {
    for (const idx of indices) clustered.add(idx);
  }
  const noiseIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!clustered.has(i)) noiseIndices.push(i);
  }

  console.log(`✓ Star Clustering: ${rawClusterMap.size} clusters, ${noiseIndices.length} noise points (${clusterTime}s)`);

  // 3. Post-process: split oversized or incoherent clusters
  console.log(`[cluster] Post-processing: splitting large/incoherent clusters...`);
  const processedMap = postProcessClusters(rawClusterMap, simMatrix, n, threshold);

  // Filter out sub-clusters that are too small after splitting
  const preFinalMap = new Map<number, number[]>();
  let preFinalId = 0;
  const returnedToNoise: number[] = [];
  for (const [, indices] of processedMap) {
    if (indices.length >= MIN_CLUSTER_SIZE) {
      preFinalMap.set(preFinalId++, indices);
    } else {
      returnedToNoise.push(...indices);
    }
  }

  // Find any articles lost during sub-clustering (not in any final cluster or initial noise)
  const coveredIndices = new Set<number>(noiseIndices);
  returnedToNoise.forEach(i => coveredIndices.add(i));
  for (const [, indices] of preFinalMap) {
    for (const idx of indices) coveredIndices.add(idx);
  }
  const lostIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!coveredIndices.has(i)) lostIndices.push(i);
  }

  const postSplitNoise = [...noiseIndices, ...returnedToNoise, ...lostIndices];
  console.log(`✓ Post-split: ${preFinalMap.size} topics, ${postSplitNoise.length} unclustered (${lostIndices.length} recovered from sub-split noise)`);

  // 4. Outlier pruning: remove articles that don't genuinely belong to their cluster.
  //    An article must satisfy:
  //      - similarity to cluster medoid >= OUTLIER_MEDOID_MIN_SIM
  //    This is the single, strict criterion. The medoid is the most central point,
  //    so any article that's far from the medoid is topically off.
  //    We iteratively prune + recompute medoid since removing outliers changes the center.
  // 4. Outlier pruning: post-split, enforce medoid-sim check.
  //    Star clustering guarantees this invariant, but post-split may have
  //    created sub-clusters where some articles don't meet the threshold
  //    relative to the NEW medoid.
  console.log(`[cluster] Outlier pruning: enforcing medoid-sim after post-split...`);
  let outliersPruned = 0;

  const prunedNoise: number[] = [];

  for (let round = 0; round < 5; round++) {
    let roundPruned = 0;

    for (const [cid, indices] of preFinalMap) {
      if (indices.length <= 2) continue;

      const medoid = findMedoid(indices, simMatrix, n);
      const kept: number[] = [];
      let clusterPruned = 0;

      for (const idx of indices) {
        if (idx === medoid) { kept.push(idx); continue; }
        const medoidSim = simMatrix[idx * n + medoid];
        if (medoidSim < OUTLIER_MEDOID_MIN_SIM) {
          prunedNoise.push(idx);
          clusterPruned++;
        } else {
          kept.push(idx);
        }
      }

      if (clusterPruned > 0) {
        preFinalMap.set(cid, kept);
        roundPruned += clusterPruned;
      }
    }

    outliersPruned += roundPruned;
    if (roundPruned === 0) break;
  }

  // Remove clusters that became too small after pruning
  const pruneRemoved: number[] = [];
  for (const [cid, indices] of preFinalMap) {
    if (indices.length < MIN_CLUSTER_SIZE) {
      pruneRemoved.push(...indices);
      preFinalMap.delete(cid);
    }
  }

  const preRecoveryNoise = [...postSplitNoise, ...prunedNoise, ...pruneRemoved];
  console.log(`✓ Outlier pruning: ${outliersPruned} articles removed from clusters, ${preRecoveryNoise.length} total unclustered`);

  // 5. Noise recovery: try to assign unclustered articles to nearest cluster
  //    Uses a lower threshold than DBSCAN — we're adding to existing clean clusters,
  //    not forming new ones, so it's safe to be more permissive.
  const noiseRecoveryThreshold = isGemini ? NOISE_RECOVERY_THRESHOLD_GEMINI : NOISE_RECOVERY_THRESHOLD_OPENAI;
  console.log(`[cluster] Noise recovery: trying to assign ${preRecoveryNoise.length} unclustered articles (threshold=${noiseRecoveryThreshold})...`);

  // Pre-compute medoids for each cluster
  const clusterMedoids = new Map<number, number>();
  for (const [cid, indices] of preFinalMap) {
    clusterMedoids.set(cid, findMedoid(indices, simMatrix, n));
  }

  let recovered = 0;
  const stillNoise: number[] = [];
  for (const noiseIdx of preRecoveryNoise) {
    // Find the best cluster for this noise point.
    // STRICT criteria to prevent off-topic pollution:
    //   1. Sim to cluster medoid >= recovery threshold (ensures topical relevance)
    //   2. Avg sim to top-K nearest members >= recovery threshold
    //      where K = max(3, ceil(cluster_size * 0.3)) — larger clusters need more matches
    //   3. Cluster not already at hard cap
    let bestClusterId = -1;
    let bestAvgTopK = -1;

    for (const [cid, indices] of preFinalMap) {
      // Skip clusters that are already at hard cap
      if (indices.length >= HARD_MAX_CLUSTER_SIZE) continue;

      // Gate 1: similarity to medoid must pass threshold
      const medoid = clusterMedoids.get(cid)!;
      const medoidSim = simMatrix[noiseIdx * n + medoid];
      if (medoidSim < noiseRecoveryThreshold) continue;

      // Gate 2: avg similarity to top-K nearest members
      const memberSims = indices.map(m => simMatrix[noiseIdx * n + m]).sort((a, b) => b - a);
      const topK = Math.max(3, Math.ceil(indices.length * 0.3));
      const k = Math.min(topK, memberSims.length);
      const avgTopK = memberSims.slice(0, k).reduce((s, v) => s + v, 0) / k;

      if (avgTopK < noiseRecoveryThreshold) continue;

      if (avgTopK > bestAvgTopK) {
        bestAvgTopK = avgTopK;
        bestClusterId = cid;
      }
    }

    if (bestClusterId !== -1) {
      preFinalMap.get(bestClusterId)!.push(noiseIdx);
      recovered++;
    } else {
      stillNoise.push(noiseIdx);
    }
  }

  console.log(`✓ Noise recovery (phase 1): ${recovered} articles assigned to existing topics, ${stillNoise.length} remain unclustered`);

  // Phase 3: Try to form NEW clusters among remaining noise at the lower threshold
  //          This catches pairs/triples of articles on the same topic that weren't
  //          connected to any existing cluster but are connected to each other.
  console.log(`[cluster] Phase 3: forming new clusters among ${stillNoise.length} remaining articles (threshold=${noiseRecoveryThreshold})...`);

  // Mini-DBSCAN on just the noise indices, using the global similarity matrix
  const noiseSet = new Set(stillNoise);
  const noiseNeighbors = new Map<number, number[]>();
  for (const i of stillNoise) {
    const neighbors: number[] = [];
    for (const j of stillNoise) {
      if (i !== j && simMatrix[i * n + j] >= noiseRecoveryThreshold) {
        neighbors.push(j);
      }
    }
    noiseNeighbors.set(i, neighbors);
  }

  // BFS clustering on noise only
  const noiseClusterLabels = new Map<number, number>();
  let noiseClusterId = 0;
  for (const seed of stillNoise) {
    if (noiseClusterLabels.has(seed)) continue;
    const neighbors = noiseNeighbors.get(seed)!;
    if (neighbors.length < 1) continue; // Relaxed: pairs are OK for noise recovery

    // Start new cluster
    const queue = [seed];
    noiseClusterLabels.set(seed, noiseClusterId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of noiseNeighbors.get(current)!) {
        if (noiseClusterLabels.has(neighbor)) continue;
        noiseClusterLabels.set(neighbor, noiseClusterId);
        // Expand from core points only
        if ((noiseNeighbors.get(neighbor)?.length || 0) >= 1) {
          queue.push(neighbor);
        }
      }
    }
    noiseClusterId++;
  }

  // Group by cluster
  const noiseClusterMap = new Map<number, number[]>();
  const finallyUnclustered: number[] = [];
  for (const idx of stillNoise) {
    const label = noiseClusterLabels.get(idx);
    if (label === undefined) {
      finallyUnclustered.push(idx);
      continue;
    }
    if (!noiseClusterMap.has(label)) noiseClusterMap.set(label, []);
    noiseClusterMap.get(label)!.push(idx);
  }

  // Add valid new clusters to the map
  let newClusters = 0;
  for (const [, indices] of noiseClusterMap) {
    if (indices.length >= MIN_CLUSTER_SIZE) {
      preFinalMap.set(preFinalId++, indices);
      newClusters++;
    } else {
      finallyUnclustered.push(...indices);
    }
  }

  console.log(`✓ Phase 3: ${newClusters} new clusters formed, ${finallyUnclustered.length} truly unclustered`);

  // Final outlier pruning: enforce medoid-centric constraint on all clusters.
  // Every article must have sim >= OUTLIER_MEDOID_MIN_SIM to the cluster medoid.
  // This is the key invariant of Star Clustering — noise recovery may have broken it.
  console.log(`[cluster] Final outlier pruning: enforcing medoid-sim constraint on all clusters...`);
  let finalPruned = 0;
  const finalPrunedNoise: number[] = [];

  for (let round = 0; round < 5; round++) {
    let roundPruned = 0;

    for (const [cid, indices] of preFinalMap) {
      if (indices.length <= 2) continue;

      const medoid = findMedoid(indices, simMatrix, n);
      const kept: number[] = [];
      let clusterPruned = 0;

      for (const idx of indices) {
        if (idx === medoid) { kept.push(idx); continue; }

        const medoidSim = simMatrix[idx * n + medoid];
        if (medoidSim < OUTLIER_MEDOID_MIN_SIM) {
          finalPrunedNoise.push(idx);
          clusterPruned++;
        } else {
          kept.push(idx);
        }
      }

      if (clusterPruned > 0) {
        preFinalMap.set(cid, kept);
        roundPruned += clusterPruned;
      }
    }

    finalPruned += roundPruned;
    if (roundPruned === 0) break;
  }

  // Remove clusters that became too small
  for (const [cid, indices] of preFinalMap) {
    if (indices.length < MIN_CLUSTER_SIZE) {
      finalPrunedNoise.push(...indices);
      preFinalMap.delete(cid);
    }
  }

  finallyUnclustered.push(...finalPrunedNoise);
  console.log(`✓ Final outlier pruning: ${finalPruned} articles removed, ${finallyUnclustered.length} truly unclustered`);

  // Build final map with clean IDs
  let finalMap = new Map<number, number[]>();
  let finalId = 0;
  for (const [, indices] of preFinalMap) {
    finalMap.set(finalId++, indices);
  }

  let allNoise = [...finallyUnclustered];

  // ============================================================
  // LLM POST-PROCESSING (skip with --no-llm)
  // ============================================================
  const skipLLM = process.argv.includes('--no-llm');
  const llmTitles = new Map<number, string>(); // cluster id → LLM-generated title
  const llmEditorialFlags = new Map<number, string[]>(); // cluster id → editorial flags

  if (!skipLLM) {
    let llmConfig: ReturnType<typeof resolveConfig>;
    try {
      llmConfig = resolveConfig();
      console.log(`\n[llm] Using ${llmConfig.provider}/${llmConfig.model} for post-processing`);
    } catch (e: any) {
      console.warn(`[llm] Skipping LLM post-processing: ${e.message}`);
      // Fall through — llmConfig will be undefined and we skip
      llmConfig = null as any;
    }

    if (llmConfig) {
      // --- Phase A: LLM cleanup + title generation (batched) ---
      // Process clusters in batches of 5 to reduce API calls
      console.log(`[llm] Phase A: Verifying ${finalMap.size} clusters + generating titles...`);
      const clusterEntries = Array.from(finalMap.entries());
      const LLM_CLUSTER_BATCH = 5;
      let totalEvicted = 0;

      for (let i = 0; i < clusterEntries.length; i += LLM_CLUSTER_BATCH) {
        const batch = clusterEntries.slice(i, i + LLM_CLUSTER_BATCH);
        const batchNum = Math.floor(i / LLM_CLUSTER_BATCH) + 1;
        const totalBatches = Math.ceil(clusterEntries.length / LLM_CLUSTER_BATCH);

        // Build prompt with all clusters in this batch
        const clustersPayload = batch.map(([cid, indices]) => {
          const arts = indices.map(idx => ({
            idx,
            titre: articles[idx].titre,
            source: articles[idx].source,
          }));
          return { cluster_id: cid, articles: arts };
        });

        const systemPrompt = `Tu es un éditeur en chef qui vérifie la cohérence thématique de clusters d'articles de presse.

Pour CHAQUE cluster fourni :
1. Détermine le sujet central du cluster
2. Identifie les articles qui ne parlent PAS de ce sujet (hors-sujet)
3. Génère un titre court et clair pour le cluster (pas un titre d'article, un TITRE DE SUJET : 5-10 mots max)
4. Attribue des drapeaux éditoriaux parmi : droit_international, justice_sociale, colonialisme, imperialisme, laicite, equite_economique, droits_humains, ecologie_sociale, double_standard, antifascisme
   - Ne flag que si le sujet TOUCHE DIRECTEMENT à ces thèmes
   - Un sujet peut avoir 0 drapeau (actualité neutre) ou plusieurs

Réponds UNIQUEMENT en JSON valide :
{
  "clusters": [
    {
      "cluster_id": <id>,
      "titre": "<titre de sujet court et clair>",
      "hors_sujet": [<indices des articles hors-sujet, liste vide si tous OK>],
      "editorial_flags": ["flag1", "flag2"]
    }
  ]
}

Règles :
- Le titre doit décrire le SUJET, pas reformuler un titre d'article
- Exemples de bons titres : "Frappes américaines en Iran", "Affaire Epstein", "Salon de l'agriculture 2025", "IA et politique américaine"
- Un article est hors-sujet SEULEMENT s'il parle d'un sujet CLAIREMENT DIFFÉRENT
- Sois strict mais juste : un article connexe au sujet principal reste dans le cluster
- Les drapeaux éditoriaux servent à identifier les sujets critiques — sois précis, ne flag que si c'est directement pertinent`;

        const userMessage = JSON.stringify({ clusters: clustersPayload }, null, 0);

        try {
          const response = await callLLMWithRetry(llmConfig, systemPrompt, userMessage, 4000, 2);

          // Parse response
          let cleaned = response.trim();
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          }
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

          if (parsed.clusters && Array.isArray(parsed.clusters)) {
            for (const result of parsed.clusters) {
              const cid = result.cluster_id;
              if (result.titre && typeof result.titre === 'string') {
                llmTitles.set(cid, result.titre);
              }
              // Parse editorial flags
              if (result.editorial_flags && Array.isArray(result.editorial_flags)) {
                llmEditorialFlags.set(cid, result.editorial_flags as string[]);
              }
              if (result.hors_sujet && Array.isArray(result.hors_sujet) && result.hors_sujet.length > 0) {
                const currentIndices = finalMap.get(cid);
                if (currentIndices) {
                  const evictSet = new Set(result.hors_sujet as number[]);
                  const kept = currentIndices.filter(idx => !evictSet.has(idx));
                  const evicted = currentIndices.filter(idx => evictSet.has(idx));
                  if (kept.length >= MIN_CLUSTER_SIZE) {
                    finalMap.set(cid, kept);
                    allNoise.push(...evicted);
                    totalEvicted += evicted.length;
                  }
                }
              }
            }
          }

          console.log(`  [llm] batch ${batchNum}/${totalBatches} ✓`);
        } catch (err: any) {
          console.warn(`  [llm] batch ${batchNum}/${totalBatches} failed: ${err.message.slice(0, 100)}`);
        }
      }

      // Remove clusters that became too small after eviction
      for (const [cid, indices] of finalMap) {
        if (indices.length < MIN_CLUSTER_SIZE) {
          allNoise.push(...indices);
          finalMap.delete(cid);
        }
      }

      console.log(`✓ LLM cleanup: ${totalEvicted} articles evicted, ${finalMap.size} clusters remain`);

      // Orphaned articles stay unclustered — no forced catch-all groups
      console.log(`  ${allNoise.length} articles remain unclustered (not forced into catch-all groups)`);
    }
  } else {
    console.log(`[llm] Skipping LLM post-processing (--no-llm flag)`);
  }

  // ============================================================
  // BUILD FINAL TOPICS
  // ============================================================

  // Remove any clusters that are now too small
  for (const [cid, indices] of finalMap) {
    if (indices.length < MIN_CLUSTER_SIZE) {
      allNoise.push(...indices);
      finalMap.delete(cid);
    }
  }

  // Compute quality metrics
  const finalLabels = new Int32Array(n).fill(-1);
  let labelIdx = 0;
  for (const [, indices] of finalMap) {
    for (const idx of indices) {
      finalLabels[idx] = labelIdx;
    }
    labelIdx++;
  }
  const silhouette = computeSilhouette(Array.from(finalLabels), simMatrix, n);

  // Build Topic objects
  const topics: Topic[] = [];
  const unclustered: string[] = allNoise.map(i => articles[i].id);

  for (const [cid, indices] of finalMap) {
    const articleIds = indices.map(i => articles[i].id);
    const arts = indices.map(i => articles[i]);
    const sources: string[] = Array.from(new Set(arts.map(a => a.source)));
    const types: string[] = Array.from(new Set(arts.map(a => a.type)));
    const pays: string[] = Array.from(new Set(arts.map(a => a.pays)));
    const rubriques = detectRubriques(arts);
    const coherence = clusterCoherence(indices, simMatrix, n);

    // Use LLM-generated title if available, otherwise medoid-based fallback
    const titre = llmTitles.get(cid) || generateTitle(articles, indices, simMatrix, n);

    // Compute editorial metadata
    const editMeta = computeEditorialMeta(articleIds, articlesById, feedByName, groupeById);

    topics.push({
      id: '',
      titre,
      article_ids: articleIds,
      sources,
      types,
      rubriques_detectees: rubriques,
      pays_concernes: pays,
      score: computeScore(articleIds, articlesById, coherence, feedByName, groupeById),
      editorial_flags: llmEditorialFlags.get(cid) || [],
      axes_profile: editMeta.axes_profile,
      orientations: editMeta.orientations,
      has_investigation_source: editMeta.has_investigation_source,
    });
  }

  // --- Classify unclustered articles and create virtual topics ---
  const classified = classifyUnclustered(allNoise, articles, feedByName);
  console.log(`\n[editorial] Unclustered classification:`);
  console.log(`  ${classified.solo_investigation.length} solo investigation`);
  console.log(`  ${classified.signal_faible.length} signal faible`);
  console.log(`  ${classified.standard.length} standard noise`);

  // Create virtual topics for solo_investigation articles
  for (const idx of classified.solo_investigation) {
    const a = articles[idx];
    const freshH = Math.max(0, (Date.now() - new Date(a.date).getTime()) / 3600000);
    topics.push({
      id: '',
      titre: a.titre.slice(0, 80),
      article_ids: [a.id],
      sources: [a.source],
      types: [a.type],
      rubriques_detectees: [a.rubrique],
      pays_concernes: [a.pays],
      score: {
        nb_sources: 1, diversite_types: 1, fiabilite_moy: a.fiabilite,
        fraicheur_h: +freshH.toFixed(1), couverture_mixte: false, coherence: 1,
        investigation_bonus: 10, axes_alignment: 10, pluralite: 0,
        total: 35,
      },
      editorial_flags: [],
      axes_profile: {},
      orientations: [],
      has_investigation_source: true,
      tag: 'solo_investigation',
    });
  }

  // Create virtual topics for signal_faible articles
  for (const idx of classified.signal_faible) {
    const a = articles[idx];
    const freshH = Math.max(0, (Date.now() - new Date(a.date).getTime()) / 3600000);
    topics.push({
      id: '',
      titre: a.titre.slice(0, 80),
      article_ids: [a.id],
      sources: [a.source],
      types: [a.type],
      rubriques_detectees: [a.rubrique],
      pays_concernes: [a.pays],
      score: {
        nb_sources: 1, diversite_types: 1, fiabilite_moy: a.fiabilite,
        fraicheur_h: +freshH.toFixed(1), couverture_mixte: false, coherence: 1,
        investigation_bonus: a.type === 'investigation' ? 10 : 0,
        axes_alignment: 7.5, pluralite: 0,
        total: 25,
      },
      editorial_flags: [],
      axes_profile: {},
      orientations: [],
      has_investigation_source: a.type === 'investigation' || a.type === 'fact-check',
      tag: 'signal_faible',
    });
  }

  // Sort by score
  topics.sort((a, b) => b.score.total - a.score.total);

  // Assign IDs
  for (let i = 0; i < topics.length; i++) {
    topics[i].id = `topic-${String(i + 1).padStart(3, '0')}`;
  }

  // 7. t-SNE Projection for admin viz
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
      nb_signal_faible: classified.signal_faible.length,
      nb_solo_investigation: classified.solo_investigation.length,
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

  // Editorial stats
  const flaggedTopics = topics.filter(t => t.editorial_flags.length > 0);
  const investigationTopics = topics.filter(t => t.has_investigation_source);
  const virtualTopics = topics.filter(t => t.tag);

  console.log(`\n✓ Wrote topics.json for ${today} (pipeline v${PIPELINE_VERSION})`);
  console.log(`  ${topics.length} topics (${allNoise.length} unclustered — ${clusteredPct.toFixed(0)}% clustered)`);
  console.log(`  ${multiSrcTopics} topics with 2+ sources`);
  console.log(`  ${virtualTopics.length} virtual topics (${classified.solo_investigation.length} investigation, ${classified.signal_faible.length} signal faible)`);
  console.log(`\n  Quality metrics:`);
  console.log(`    Avg silhouette:  ${silhouette.toFixed(3)}`);
  console.log(`    Avg coherence:   ${avgCoherence.toFixed(3)}`);
  console.log(`\n  Editorial metrics:`);
  console.log(`    ${flaggedTopics.length} topics with editorial flags`);
  console.log(`    ${investigationTopics.length} topics with investigation sources`);
  if (flaggedTopics.length > 0) {
    const allFlags: Record<string, number> = {};
    for (const t of flaggedTopics) {
      for (const f of t.editorial_flags) {
        allFlags[f] = (allFlags[f] || 0) + 1;
      }
    }
    console.log(`    Flags: ${Object.entries(allFlags).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }
  console.log(`\n  Top 15 topics by score:`);
  for (const t of topics.slice(0, 15)) {
    const flags = t.editorial_flags.length > 0 ? ` 🏷${t.editorial_flags.join(',')}` : '';
    const tag = t.tag ? ` [${t.tag}]` : '';
    console.log(`    [${t.score.total}] coh=${t.score.coherence.toFixed(2)} ${t.article_ids.length} art | ${t.score.nb_sources} src | ${t.rubriques_detectees.join(',') || '-'} | ${t.titre.slice(0, 60)}${flags}${tag}`);
  }

  // Size distribution
  const sizeHist: Record<string, number> = {};
  for (const t of topics) {
    const sz = t.article_ids.length;
    const bucket = sz <= 5 ? `${sz}` : sz <= 10 ? '6-10' : sz <= 15 ? '11-15' : sz <= 20 ? '16-20' : '21+';
    sizeHist[bucket] = (sizeHist[bucket] || 0) + 1;
  }
  console.log(`\n  Size distribution:`);
  for (const [k, v] of Object.entries(sizeHist).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${k} articles: ${v} topics`);
  }
}

// Only run main() when this script is executed directly (not imported)
const isDirectRun = process.argv[1]?.endsWith('cluster-topics.ts') ||
                    process.argv[1]?.endsWith('cluster-topics.js');
if (isDirectRun) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('Pipeline cluster-topics failed:', err);
    process.exit(1);
  });
}
