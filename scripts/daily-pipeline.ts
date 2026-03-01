/**
 * daily-pipeline.ts — Orchestrate the full daily news pipeline
 *
 * Runs:  fetch-news → fetch-votes → generate-une → build → (optional) deploy
 *
 * Writes a structured run log to src/data/.pipeline/runs.json for the admin dashboard.
 *
 * Usage:
 *   npx tsx scripts/daily-pipeline.ts          # Generate only
 *   npx tsx scripts/daily-pipeline.ts --deploy  # Generate + git push (triggers Vercel)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const shouldDeploy = process.argv.includes('--deploy');

interface Step {
  name: string;
  command: string;
  critical: boolean;
}

interface StepResult {
  name: string;
  status: 'success' | 'failed' | 'skipped';
  duration_s: number;
  error?: string;
}

interface RunLog {
  id: string;
  date: string;
  started_at: string;
  finished_at: string;
  duration_s: number;
  status: 'success' | 'failed';
  deployed: boolean;
  steps: StepResult[];
  stats: {
    articles_fetched: number;
    feeds_ok: number;
    feeds_total: number;
    faits_du_jour: number;
    regards_croises: number;
    regard_etranger: number;
    provider: string;
    model: string;
  };
}

const steps: Step[] = [
  {
    name: 'Récupération des flux RSS',
    command: 'npx tsx scripts/fetch-news.ts',
    critical: true,
  },
  {
    name: 'Récupération des signaux (HN, Reddit, Wikipedia)',
    command: 'npx tsx scripts/fetch-signals.ts',
    critical: false,
  },
  {
    name: 'Récupération des scrutins AN',
    command: 'npx tsx scripts/fetch-votes.ts',
    critical: false,
  },
  {
    name: 'Clustering thématique des articles',
    command: 'npx tsx scripts/cluster-topics.ts',
    critical: true,
  },
  {
    name: 'Classification LLM des topics (Gemini)',
    command: 'npx tsx scripts/classify-topics.ts',
    critical: false,
  },
  {
    name: 'Génération de la Une',
    command: 'npx tsx scripts/generate-une.ts',
    critical: true,
  },
  {
    name: 'Génération section IA/Tech',
    command: 'npx tsx scripts/generate-ia.ts',
    critical: false,
  },
  {
    name: 'Génération fil continu',
    command: 'npx tsx scripts/generate-fil.ts',
    critical: false,
  },
  {
    name: 'Génération sujets chauds',
    command: 'npx tsx scripts/generate-sujets-chauds.ts',
    critical: false,
  },
  {
    name: 'Contrôle qualité des données',
    command: 'npx tsx scripts/sanity-check.ts',
    critical: false,
  },
  {
    name: 'Vérification des citations inline',
    command: 'npx tsx scripts/verify-citations.ts',
    critical: false,
  },
  {
    name: 'Build du site',
    command: 'npm run build',
    critical: true,
  },
  {
    name: 'Envoi newsletter',
    command: 'npx tsx scripts/send-newsletter.ts',
    critical: false,
  },
  {
    name: 'Alertes députés',
    command: 'npx tsx scripts/send-deputy-alerts.ts',
    critical: false,
  },
];

const PIPELINE_DIR = new URL('../src/data/.pipeline/', import.meta.url);
const RUNS_PATH = new URL('runs.json', PIPELINE_DIR);
const MAX_RUNS = 50;

function loadRuns(): RunLog[] {
  try {
    if (existsSync(RUNS_PATH)) {
      return JSON.parse(readFileSync(RUNS_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveRuns(runs: RunLog[]) {
  mkdirSync(PIPELINE_DIR, { recursive: true });
  // Keep only last N runs
  const trimmed = runs.slice(-MAX_RUNS);
  writeFileSync(RUNS_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
}

function extractStats(): RunLog['stats'] {
  let articles_fetched = 0;
  let feeds_ok = 0;
  const feeds_total = 26;
  let faits_du_jour = 0;
  let regards_croises = 0;
  let regard_etranger = 0;
  let provider = '';
  let model = '';

  // Read raw articles
  try {
    const raw = JSON.parse(readFileSync(new URL('raw-articles.json', PIPELINE_DIR), 'utf-8'));
    articles_fetched = Array.isArray(raw) ? raw.length : 0;
    // Count unique sources
    const sources = new Set(raw.map((a: any) => a.source));
    feeds_ok = sources.size;
  } catch { /* ignore */ }

  // Read generated une.json
  try {
    const une = JSON.parse(readFileSync(new URL('../src/data/une.json', import.meta.url), 'utf-8'));
    faits_du_jour = une.faits_du_jour?.length || une.faits_semaine?.length || 0;
    regards_croises = une.regards_croises?.length || 0;
    regard_etranger = une.regard_etranger?.length || 0;
    if (une.meta) {
      const m = une.meta.modele || '';
      const parts = m.split('/');
      provider = parts[0] || '';
      model = parts.slice(1).join('/') || m;
    }
  } catch { /* ignore */ }

  return { articles_fetched, feeds_ok, feeds_total, faits_du_jour, regards_croises, regard_etranger, provider, model };
}

async function main() {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  const startedAt = new Date().toISOString();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Pipeline quotidien Citoyens.ai — ${today}`);
  console.log(`${'='.repeat(60)}\n`);

  let failed = false;
  const stepResults: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`\n[${i + 1}/${steps.length}] ${step.name}...`);
    console.log(`${'─'.repeat(40)}`);

    const stepStart = Date.now();

    try {
      execSync(step.command, {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 180000,
      });
      const duration = (Date.now() - stepStart) / 1000;
      stepResults.push({ name: step.name, status: 'success', duration_s: +duration.toFixed(1) });
      console.log(`✓ ${step.name} terminé (${duration.toFixed(1)}s)`);
    } catch (err: any) {
      const duration = (Date.now() - stepStart) / 1000;
      const errorMsg = err.message?.slice(0, 200) || 'Unknown error';
      stepResults.push({ name: step.name, status: 'failed', duration_s: +duration.toFixed(1), error: errorMsg });
      console.error(`✗ ${step.name} échoué`);

      if (step.critical) {
        console.error(`\n⛔ Étape critique échouée. Pipeline interrompu.`);
        // Mark remaining steps as skipped
        for (let j = i + 1; j < steps.length; j++) {
          stepResults.push({ name: steps[j].name, status: 'skipped', duration_s: 0 });
        }
        failed = true;
        break;
      } else {
        console.log(`  → Étape non critique, on continue...`);
      }
    }
  }

  // Deploy step (optional)
  let deployed = false;
  if (!failed && shouldDeploy) {
    console.log(`\n[Deploy] Commit + push vers origin/main...`);
    console.log(`${'─'.repeat(40)}`);

    try {
      execSync('git add src/data/une.json src/data/votes.json', { stdio: 'inherit' });
      execSync(
        `git commit -m "daily: edition du ${today}" --author="Citoyens.ai Pipeline <pipeline@citoyens.ai>"`,
        { stdio: 'inherit' }
      );
      execSync('git push origin main', { stdio: 'inherit' });
      console.log('✓ Déployé sur origin/main');
      deployed = true;
    } catch (err) {
      console.error('✗ Deploy échoué (les données sont générées mais pas pushées)');
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;

  // Write run log
  const runLog: RunLog = {
    id: `run-${today}-${Date.now().toString(36)}`,
    date: today,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_s: +elapsed.toFixed(1),
    status: failed ? 'failed' : 'success',
    deployed,
    steps: stepResults,
    stats: extractStats(),
  };

  const runs = loadRuns();
  runs.push(runLog);
  saveRuns(runs);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Pipeline ${failed ? 'ÉCHOUÉ' : 'TERMINÉ'} en ${elapsed.toFixed(1)}s`);
  console.log(`  Run log saved to .pipeline/runs.json`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
