'use server';

import { getFeeds, getArticles, getGroupesMedias, type FeedSource, type GroupeMedia } from '@/lib/local-data';

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
