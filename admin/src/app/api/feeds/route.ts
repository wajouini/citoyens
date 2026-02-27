import { NextResponse } from 'next/server';
import { db } from '@/db';
import { feeds } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/feeds — Returns all active feeds (used by the pipeline's fetch-news.ts)
 * Optionally ?all=true to include inactive feeds
 */
export async function GET(request: Request) {
  // Check API key for external callers
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.ADMIN_API_KEY;

  // Allow without auth in dev, require in production
  if (apiKey && authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json({ error: 'Database not connected' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const all = searchParams.get('all') === 'true';

  try {
    let result;
    if (all) {
      result = await db.select().from(feeds);
    } else {
      result = await db.select().from(feeds).where(eq(feeds.active, true));
    }

    return NextResponse.json(
      result.map((f) => ({
        nom: f.nom,
        url: f.url,
        type: f.type,
        pays: f.pays,
        langue: f.langue,
        fiabilite: f.fiabilite,
        active: f.active,
      })),
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
