/**
 * Data layer 100% fichiers locaux — lit directement les JSON du pipeline.
 * Pas besoin de Postgres.
 */
import { readFile, readdir, stat, access, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { RunLog, Une, DashboardData } from './types';

const ROOT = process.cwd().replace(/\/admin$/, '');
const DATA = join(ROOT, 'src', 'data');
const PIPELINE = join(DATA, '.pipeline');

// ─── Types ───

export interface FeedSource {
  nom: string;
  url: string;
  type: 'investigation' | 'mainstream' | 'fact-check' | 'institutionnel' | 'etranger';
  pays: string;
  langue: string;
  fiabilite: number;
  active: boolean;
  groupe: string | null;
  orientation: string | null;
  ligne_editoriale: string | null;
}

export interface GroupeMedia {
  id: string;
  nom: string;
  proprietaires: { nom: string; type: string; fortune_source: string }[];
  structure: string;
  orientation: string;
  orientation_historique: string;
  derive_recente: string;
  axes: Record<string, number>;
  axes_notes: Record<string, string>;
  medias: string[];
}

export interface RawArticle {
  id: string;
  titre: string;
  description: string;
  url: string;
  source: string;
  type: string;
  pays: string;
  langue: string;
  date: string;
  fiabilite: number;
}

export interface EditionSummary {
  date: string;
  titre_une: string;
  categorie: string;
  accroche: string;
  faits_count: number;
  regards_count: number;
  modele: string;
}

export type { RunLog };

// ─── Sources (loaded from shared feeds.json) ───

let _feedsCache: FeedSource[] | null = null;

async function loadFeedsFromFile(): Promise<FeedSource[]> {
  if (_feedsCache) return _feedsCache;
  const feedsPath = join(DATA, 'feeds.json');
  _feedsCache = await readJSON<FeedSource[]>(feedsPath, []);
  return _feedsCache;
}

// ─── Async helpers ───

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    if (!(await fileExists(path))) return fallback;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function fileModifiedAt(path: string): Promise<Date | null> {
  try {
    const s = await stat(path);
    return s.mtime;
  } catch {
    return null;
  }
}

// ─── Public API ───

export async function getFeeds(): Promise<FeedSource[]> {
  return loadFeedsFromFile();
}

export async function getGroupesMedias(): Promise<GroupeMedia[]> {
  return readJSON<GroupeMedia[]>(join(DATA, 'groupes-medias.json'), []);
}

export async function getArticles(): Promise<RawArticle[]> {
  return readJSON<RawArticle[]>(join(PIPELINE, 'raw-articles.json'), []);
}

export async function getRuns(): Promise<RunLog[]> {
  return readJSON<RunLog[]>(join(PIPELINE, 'runs.json'), []);
}

export async function getUne(): Promise<Une | null> {
  const path = join(DATA, 'une.json');
  return readJSON<Une | null>(path, null);
}

export async function getUneByDate(date: string): Promise<Une | null> {
  const archivePath = join(PIPELINE, `une-${date}.json`);
  if (await fileExists(archivePath)) return readJSON<Une | null>(archivePath, null);
  const current = await getUne();
  if (current?.date === date) return current;
  return null;
}

export async function getEditionHistory(): Promise<EditionSummary[]> {
  const editions: EditionSummary[] = [];

  try {
    const files = await readdir(PIPELINE);
    for (const file of files) {
      const match = file.match(/^une-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const date = match[1];
      const data = await readJSON<Partial<Une> | null>(join(PIPELINE, file), null);
      if (!data) continue;
      editions.push({
        date,
        titre_une: data.titre_une || '(sans titre)',
        categorie: data.categorie || '',
        accroche: data.accroche || '',
        faits_count: data.faits_du_jour?.length || 0,
        regards_count: (Array.isArray(data.regards_croises) ? data.regards_croises : data.regards_croises ? [data.regards_croises] : []).length,
        modele: data.meta?.modele || '',
      });
    }
  } catch { /* .pipeline dir may not exist yet */ }

  const current = await getUne();
  if (current?.date && !editions.find(e => e.date === current.date)) {
    editions.push({
      date: current.date,
      titre_une: current.titre_une || '(sans titre)',
      categorie: current.categorie || '',
      accroche: current.accroche || '',
      faits_count: current.faits_du_jour?.length || 0,
      regards_count: (Array.isArray(current.regards_croises) ? current.regards_croises : current.regards_croises ? [current.regards_croises] : []).length,
      modele: current.meta?.modele || '',
    });
  }

  editions.sort((a, b) => b.date.localeCompare(a.date));
  return editions;
}

// ─── Edition Meta (BAT workflow) ───

export interface EditionMeta {
  status: 'draft' | 'reviewed' | 'published';
  generatedAt: string;
  lastEditedAt: string | null;
  publishedAt: string | null;
  editHistory: Array<{
    field: string;
    timestamp: string;
  }>;
}

const EDITION_META_PATH = join(PIPELINE, 'edition-meta.json');

const DEFAULT_META: EditionMeta = {
  status: 'draft',
  generatedAt: new Date().toISOString(),
  lastEditedAt: null,
  publishedAt: null,
  editHistory: [],
};

export async function getEditionMeta(): Promise<EditionMeta> {
  return readJSON<EditionMeta>(EDITION_META_PATH, DEFAULT_META);
}

export async function saveEditionMeta(meta: EditionMeta): Promise<void> {
  await mkdir(PIPELINE, { recursive: true });
  await writeFile(EDITION_META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function saveUne(une: Une): Promise<void> {
  const unePath = join(DATA, 'une.json');
  await writeFile(unePath, JSON.stringify(une, null, 2), 'utf-8');
}

export async function saveFeedsFile(feeds: FeedSource[]): Promise<void> {
  const feedsPath = join(DATA, 'feeds.json');
  await writeFile(feedsPath, JSON.stringify(feeds, null, 2), 'utf-8');
  _feedsCache = null;
}

// ─── Editorial Alerts ───

export interface EditorialAlert {
  type: 'warning' | 'error' | 'info';
  category: 'diversity' | 'coverage' | 'tone' | 'quality';
  message: string;
  detail?: string;
}

export async function computeEditorialAlerts(une: Une | null): Promise<EditorialAlert[]> {
  if (!une) return [];
  const alerts: EditorialAlert[] = [];
  const allSources: Array<{ nom: string; groupe_media?: { nom: string; proprietaire: string; type_proprietaire: string } | null }> = [];

  for (const f of une.faits_du_jour || []) {
    for (const s of f.sources || []) allSources.push(s);
  }
  for (const rc of (Array.isArray(une.regards_croises) ? une.regards_croises : [])) {
    for (const c of rc.couvertures || []) {
      allSources.push({ nom: c.source, groupe_media: c.groupe_media });
    }
  }

  // Source diversity: check if one group dominates
  const groupCounts = new Map<string, number>();
  for (const s of allSources) {
    const group = s.groupe_media?.nom || 'Indépendant';
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  }
  const total = allSources.length;
  for (const [group, count] of groupCounts) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    if (pct > 40) {
      alerts.push({
        type: 'warning',
        category: 'diversity',
        message: `${group} représente ${pct}% des sources`,
        detail: `${count}/${total} sources proviennent du même groupe média`,
      });
    }
  }

  // Ownership diversity
  const ownerTypes = new Map<string, number>();
  for (const s of allSources) {
    const ownerType = s.groupe_media?.type_proprietaire || 'independant';
    ownerTypes.set(ownerType, (ownerTypes.get(ownerType) || 0) + 1);
  }
  const milliardaireCount = ownerTypes.get('milliardaire') || 0;
  if (total > 0 && milliardaireCount / total > 0.6) {
    alerts.push({
      type: 'warning',
      category: 'diversity',
      message: `${Math.round((milliardaireCount / total) * 100)}% des sources appartiennent à des milliardaires`,
    });
  }

  // Coverage: check missing sections
  const faits = une.faits_du_jour?.length || 0;
  const regards = (Array.isArray(une.regards_croises) ? une.regards_croises : []).length;
  const etranger = une.regard_etranger?.length || 0;

  if (faits === 0) alerts.push({ type: 'error', category: 'coverage', message: 'Aucun fait du jour' });
  if (regards === 0) alerts.push({ type: 'warning', category: 'coverage', message: 'Aucun regard croisé' });
  if (etranger === 0) alerts.push({ type: 'warning', category: 'coverage', message: 'Aucun regard étranger' });
  if (!une.chiffre_du_jour) alerts.push({ type: 'info', category: 'coverage', message: 'Pas de chiffre du jour' });
  if ((une.a_surveiller?.length || 0) === 0) alerts.push({ type: 'info', category: 'coverage', message: 'Aucun événement à surveiller' });

  // Tone balance in regards croisés
  for (const rc of (Array.isArray(une.regards_croises) ? une.regards_croises : [])) {
    const tons = (rc.couvertures || []).map(c => c.ton);
    const critiques = tons.filter(t => t === 'critique' || t === 'alarmiste').length;
    if (tons.length > 0 && critiques === tons.length) {
      alerts.push({
        type: 'warning',
        category: 'tone',
        message: `"${rc.sujet}" : toutes les couvertures sont critiques/alarmistes`,
        detail: 'Absence de point de vue factuel ou neutre',
      });
    }
    const complaisants = tons.filter(t => t === 'complaisant').length;
    if (tons.length > 0 && complaisants === tons.length) {
      alerts.push({
        type: 'warning',
        category: 'tone',
        message: `"${rc.sujet}" : toutes les couvertures sont complaisantes`,
        detail: 'Absence de point de vue critique',
      });
    }
  }

  // Category diversity in faits
  const categories = new Set((une.faits_du_jour || []).map(f => f.categorie).filter(Boolean));
  if (faits >= 4 && categories.size <= 1) {
    alerts.push({
      type: 'warning',
      category: 'coverage',
      message: `Tous les faits du jour sont dans la même catégorie : ${[...categories][0] || '?'}`,
    });
  }

  return alerts;
}

export async function getArticlesFileDate(): Promise<Date | null> {
  return fileModifiedAt(join(PIPELINE, 'raw-articles.json'));
}

export async function getUneFileDate(): Promise<Date | null> {
  return fileModifiedAt(join(DATA, 'une.json'));
}

export async function getDashboardStats(): Promise<DashboardData> {
  const [articles, runs, une, feeds] = await Promise.all([
    getArticles(),
    getRuns(),
    getUne(),
    getFeeds(),
  ]);

  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const successRuns = runs.filter((r) => r.status === 'success').length;
  const failedRuns = runs.filter((r) => r.status === 'failed').length;
  const avgDuration =
    runs.length > 0
      ? Math.round(runs.reduce((sum, r) => sum + (r.duration_s || 0), 0) / runs.length)
      : 0;

  const articlesBySrc = new Map<string, number>();
  for (const a of articles) {
    articlesBySrc.set(a.source, (articlesBySrc.get(a.source) || 0) + 1);
  }

  const articlesByType: Record<string, number> = {};
  for (const a of articles) {
    articlesByType[a.type] = (articlesByType[a.type] || 0) + 1;
  }

  const [articlesFileDate, uneFileDate] = await Promise.all([
    getArticlesFileDate(),
    getUneFileDate(),
  ]);

  return {
    totalRuns: runs.length,
    successRuns,
    failedRuns,
    avgDuration,
    totalArticles: articles.length,
    totalFeeds: feeds.length,
    activeFeeds: feeds.filter((f) => f.active).length,
    feedsWithArticles: articlesBySrc.size,
    lastRun,
    recentRuns: [...runs].reverse().slice(0, 10),
    currentProvider: lastRun?.stats?.provider || process.env.LLM_PROVIDER || null,
    currentModel: lastRun?.stats?.model || process.env.LLM_MODEL || null,
    articlesByType,
    articlesBySrc: Object.fromEntries(articlesBySrc),
    articlesFileDate: articlesFileDate?.toISOString() ?? null,
    une,
    uneFileDate: uneFileDate?.toISOString() ?? null,
  };
}
