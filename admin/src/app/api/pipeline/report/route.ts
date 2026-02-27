import { NextResponse } from 'next/server';
import { db } from '@/db';
import { pipelineRuns, runSteps, articles, editions } from '@/db/schema';

/**
 * POST /api/pipeline/report — Receives a run report from the pipeline
 * Called by daily-pipeline.ts after each execution
 */
export async function POST(request: Request) {
  // Verify bearer token
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.ADMIN_API_KEY;

  if (apiKey && authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json({ error: 'Database not connected' }, { status: 503 });
  }

  try {
    const body = await request.json();

    // Insert pipeline run
    await db.insert(pipelineRuns).values({
      id: body.id,
      date: body.date,
      startedAt: new Date(body.started_at),
      finishedAt: body.finished_at ? new Date(body.finished_at) : null,
      durationS: body.duration_s,
      status: body.status,
      deployed: body.deployed ?? false,
      triggeredBy: body.triggered_by ?? 'cron',
      githubRunId: body.github_run_id,
      articlesFetched: body.stats?.articles_fetched,
      feedsOk: body.stats?.feeds_ok,
      feedsTotal: body.stats?.feeds_total,
      faitsDuJour: body.stats?.faits_du_jour,
      regardsCroises: body.stats?.regards_croises,
      regardEtranger: body.stats?.regard_etranger,
      provider: body.stats?.provider,
      model: body.stats?.model,
    }).onConflictDoNothing();

    // Insert steps
    if (body.steps && Array.isArray(body.steps)) {
      for (const step of body.steps) {
        await db.insert(runSteps).values({
          runId: body.id,
          name: step.name,
          status: step.status,
          durationS: step.duration_s,
          error: step.error,
          order: step.order,
        });
      }
    }

    // Insert articles if present
    if (body.articles && Array.isArray(body.articles)) {
      for (const article of body.articles) {
        await db.insert(articles).values({
          id: article.id,
          titre: article.titre,
          description: article.description,
          url: article.url,
          source: article.source,
          type: article.type,
          pays: article.pays,
          langue: article.langue,
          date: new Date(article.date),
          fiabilite: article.fiabilite,
          runId: body.id,
        }).onConflictDoNothing();
      }
    }

    // Insert edition if present
    if (body.edition) {
      await db.insert(editions).values({
        date: body.date,
        content: body.edition,
        titreUne: body.edition.meta?.titre_une || body.edition.titre_une,
        categorie: body.edition.meta?.categorie,
        faitsDuJourCount: body.edition.faits_du_jour?.length ?? 0,
        regardsCroisesCount: body.edition.regards_croises?.sources?.length ?? 0,
        regardEtrangerCount: body.edition.regard_etranger?.length ?? 0,
        provider: body.stats?.provider,
        model: body.stats?.model,
      }).onConflictDoNothing();
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
