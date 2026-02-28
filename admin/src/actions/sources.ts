'use server';

import { getFeeds, getArticles, getGroupesMedias, saveFeedsFile, type FeedSource, type GroupeMedia } from '@/lib/local-data';
import { logAudit } from '@/lib/audit';

export type FeedWithStats = FeedSource & {
  articleCount: number;
  lastArticleDate: string | null;
  groupe_nom: string | null;
  proprietaire: string | null;
};

export async function loadFeeds(): Promise<FeedWithStats[]> {
  const [feeds, articles, groupes] = await Promise.all([getFeeds(), getArticles(), getGroupesMedias()]);

  const groupeById = new Map(groupes.map(g => [g.id, g]));

  const bySource = new Map<string, { count: number; lastDate: string }>();
  for (const a of articles) {
    const existing = bySource.get(a.source);
    if (!existing) {
      bySource.set(a.source, { count: 1, lastDate: a.date });
    } else {
      bySource.set(a.source, {
        count: existing.count + 1,
        lastDate: a.date > existing.lastDate ? a.date : existing.lastDate,
      });
    }
  }

  return feeds.map((f) => {
    const stats = bySource.get(f.nom);
    const groupe = f.groupe ? groupeById.get(f.groupe) : null;
    return {
      ...f,
      articleCount: stats?.count ?? 0,
      lastArticleDate: stats?.lastDate ?? null,
      groupe_nom: groupe?.nom ?? null,
      proprietaire: groupe?.proprietaires.map(p => p.nom).join(', ') ?? null,
    };
  });
}

export async function loadGroupes(): Promise<GroupeMedia[]> {
  return getGroupesMedias();
}

export async function testFeed(url: string): Promise<{
  success: boolean;
  articles?: Array<{ title: string; link: string; pubDate?: string }>;
  error?: string;
}> {
  try {
    const Parser = (await import('rss-parser')).default;
    const parser = new Parser({ timeout: 10_000 });
    const feed = await parser.parseURL(url);
    const items = (feed.items || []).slice(0, 5).map((item) => ({
      title: item.title || '(sans titre)',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || undefined,
    }));
    return { success: true, articles: items };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function addFeed(feed: FeedSource): Promise<{ success: boolean; error?: string }> {
  try {
    const feeds = await getFeeds();
    if (feeds.some(f => f.url === feed.url)) {
      return { success: false, error: 'Cette URL existe déjà' };
    }
    if (feeds.some(f => f.nom === feed.nom)) {
      return { success: false, error: 'Ce nom de source existe déjà' };
    }
    feeds.push(feed);
    await saveFeedsFile(feeds);
    await logAudit({ action: 'feed_add', detail: `Ajout : ${feed.nom}`, result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updateFeed(nom: string, updates: Partial<FeedSource>): Promise<{ success: boolean; error?: string }> {
  try {
    const feeds = await getFeeds();
    const index = feeds.findIndex(f => f.nom === nom);
    if (index === -1) return { success: false, error: 'Source introuvable' };
    feeds[index] = { ...feeds[index], ...updates };
    await saveFeedsFile(feeds);
    await logAudit({ action: 'feed_update', detail: `Modifié : ${nom}`, result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function toggleFeedActive(nom: string): Promise<{ success: boolean; error?: string }> {
  try {
    const feeds = await getFeeds();
    const index = feeds.findIndex(f => f.nom === nom);
    if (index === -1) return { success: false, error: 'Source introuvable' };
    feeds[index].active = !feeds[index].active;
    await saveFeedsFile(feeds);
    await logAudit({
      action: feeds[index].active ? 'feed_enable' : 'feed_disable',
      detail: nom,
      result: 'success',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteFeed(nom: string): Promise<{ success: boolean; error?: string }> {
  try {
    const feeds = await getFeeds();
    const filtered = feeds.filter(f => f.nom !== nom);
    if (filtered.length === feeds.length) return { success: false, error: 'Source introuvable' };
    await saveFeedsFile(filtered);
    await logAudit({ action: 'feed_delete', detail: `Supprimé : ${nom}`, result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
