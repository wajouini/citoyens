import { NextResponse } from 'next/server';

/**
 * POST /api/sources/test — Test an RSS feed URL
 * Body: { url: string }
 * Returns the first 5 articles parsed from the feed
 */
export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const Parser = (await import('rss-parser')).default;
    const parser = new Parser({
      timeout: 10_000,
      headers: {
        'User-Agent': 'Citoyens.ai RSS Fetcher/1.0',
      },
    });

    const feed = await parser.parseURL(url);

    const articles = (feed.items || []).slice(0, 5).map((item) => ({
      title: item.title || '(sans titre)',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || null,
      contentSnippet: item.contentSnippet?.slice(0, 200) || null,
    }));

    return NextResponse.json({
      success: true,
      feedTitle: feed.title,
      articleCount: feed.items?.length ?? 0,
      articles,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 422 },
    );
  }
}
