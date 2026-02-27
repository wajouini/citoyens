/**
 * POST /api/pipeline/stream
 *
 * Lance un script pipeline et streame les logs en temps réel via SSE.
 * Le client reçoit chaque ligne de stdout/stderr au fur et à mesure.
 *
 * On utilise `exit` + fermeture des streams stdout/stderr pour détecter
 * la fin, car ni `npx` ni `tsx` ne closent toujours proprement.
 *
 * Chaque exécution est loggée dans runs.json pour l'historique.
 */
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { logAudit } from '@/lib/audit';

let runningPipeline: { action: string; pid: number; child: ChildProcess } | null = null;

const ACTIONS: Record<string, { args: string[]; label: string; stepName: string }> = {
  fetch:    { args: ['scripts/fetch-news.ts'],                    label: 'Fetch RSS',         stepName: 'Récupération des flux RSS' },
  generate: { args: ['scripts/generate-une.ts'],                  label: 'Générer la Une',    stepName: 'Génération de la Une' },
  full:     { args: ['scripts/daily-pipeline.ts'],                label: 'Pipeline complet',  stepName: 'Pipeline complet' },
  deploy:   { args: ['scripts/daily-pipeline.ts', '--deploy'],    label: 'Pipeline + Deploy', stepName: 'Pipeline + Deploy' },
};

const MAX_RUNS = 50;

function appendRunLog(action: string, label: string, stepName: string, exitCode: number, durationS: number) {
  // Pipeline complet écrit ses propres runs → ne pas dupliquer
  if (action === 'full' || action === 'deploy') return;

  try {
    const cwd = process.cwd().replace(/\/admin$/, '');
    const pipelineDir = join(cwd, 'src', 'data', '.pipeline');
    const runsPath = join(pipelineDir, 'runs.json');

    mkdirSync(pipelineDir, { recursive: true });

    let runs: any[] = [];
    try {
      if (existsSync(runsPath)) {
        runs = JSON.parse(readFileSync(runsPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();
    const startedAt = new Date(Date.now() - durationS * 1000).toISOString();

    // Read stats from files
    let articles_fetched = 0;
    let feeds_ok = 0;
    let faits_du_jour = 0;
    let regards_croises = 0;
    let regard_etranger = 0;
    let provider = '';
    let model = '';

    try {
      const raw = JSON.parse(readFileSync(join(pipelineDir, 'raw-articles.json'), 'utf-8'));
      articles_fetched = Array.isArray(raw) ? raw.length : 0;
      const sources = new Set(raw.map((a: any) => a.source));
      feeds_ok = sources.size;
    } catch { /* ignore */ }

    try {
      const unePath = join(cwd, 'src', 'data', 'une.json');
      if (existsSync(unePath)) {
        const une = JSON.parse(readFileSync(unePath, 'utf-8'));
        faits_du_jour = une.faits_du_jour?.length || 0;
        regards_croises = Array.isArray(une.regards_croises) ? une.regards_croises.length : 0;
        regard_etranger = une.regard_etranger?.length || 0;
        if (une.meta?.modele) {
          const parts = une.meta.modele.split('/');
          provider = parts[0] || '';
          model = parts.slice(1).join('/') || une.meta.modele;
        }
      }
    } catch { /* ignore */ }

    const runLog = {
      id: `run-${today}-${Date.now().toString(36)}`,
      date: today,
      started_at: startedAt,
      finished_at: now,
      duration_s: +durationS.toFixed(1),
      status: exitCode === 0 ? 'success' : 'failed',
      deployed: false,
      steps: [{ name: stepName, status: exitCode === 0 ? 'success' : 'failed', duration_s: +durationS.toFixed(1) }],
      stats: {
        articles_fetched,
        feeds_ok,
        feeds_total: 26,
        faits_du_jour,
        regards_croises,
        regard_etranger,
        provider: provider || process.env.LLM_PROVIDER || '',
        model: model || process.env.LLM_MODEL || '',
      },
    };

    runs.push(runLog);
    // Keep only last N runs
    const trimmed = runs.slice(-MAX_RUNS);
    writeFileSync(runsPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch {
    // Non-critical: don't break the stream if logging fails
  }
}

export async function POST(req: Request) {
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (!action || !ACTIONS[action]) {
    return Response.json({ error: `Action inconnue: ${action}` }, { status: 400 });
  }

  if (runningPipeline) {
    return Response.json(
      { error: `Pipeline déjà en cours : ${runningPipeline.action} (PID ${runningPipeline.pid})` },
      { status: 409 },
    );
  }

  const script = ACTIONS[action];
  const cwd = process.cwd().replace(/\/admin$/, '');
  const tsxBin = join(cwd, 'node_modules', '.bin', 'tsx');
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/Cellar/node@20/20.20.0/bin:${process.env.PATH}`,
  };

  const startTime = Date.now();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      function send(event: { type: string; text?: string; exitCode?: number }) {
        if (closed) return;
        try {
          const data = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      function finish(code: number) {
        if (closed) return;
        runningPipeline = null;

        const durationS = (Date.now() - startTime) / 1000;
        appendRunLog(action!, script.label, script.stepName, code, durationS);
        logAudit({
          action: action!,
          detail: script.label,
          result: code === 0 ? 'success' : 'failed',
          duration_s: +durationS.toFixed(1),
        });

        send({ type: 'done', exitCode: code });
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }

      send({ type: 'start', text: `▶ ${script.label}` });
      logAudit({ action: action!, detail: script.label, result: 'started' });

      const child = spawn(tsxBin, script.args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      runningPipeline = { action: action!, pid: child.pid!, child };

      // Track completion of all three conditions: stdout end, stderr end, exit
      let stdoutDone = false;
      let stderrDone = false;
      let exitCode: number | null = null;

      function maybeFinish() {
        if (stdoutDone && stderrDone && exitCode !== null) {
          clearTimeout(timeout);
          finish(exitCode);
        }
      }

      function handleData(chunk: Buffer, isError: boolean) {
        const text = chunk.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            send({ type: isError ? 'error' : 'log', text: trimmed });
          }
        }
      }

      child.stdout.on('data', (chunk: Buffer) => handleData(chunk, false));
      child.stderr.on('data', (chunk: Buffer) => handleData(chunk, true));

      child.stdout.on('end', () => { stdoutDone = true; maybeFinish(); });
      child.stderr.on('end', () => { stderrDone = true; maybeFinish(); });

      child.on('exit', (code) => {
        exitCode = code ?? 1;
        maybeFinish();
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        send({ type: 'error', text: err.message });
        finish(1);
      });

      // Timeout 5 min
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
        send({ type: 'error', text: 'Timeout après 5 minutes' });
        finish(1);
      }, 300_000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
