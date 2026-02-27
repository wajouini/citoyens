import { access } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd().replace(/\/admin$/, '');
const DATA = join(ROOT, 'src', 'data');
const PIPELINE = join(DATA, '.pipeline');

async function checkFile(path: string): Promise<{ ok: boolean; path: string }> {
  try {
    await access(path);
    return { ok: true, path };
  } catch {
    return { ok: false, path };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkFile(join(DATA, 'une.json')),
    checkFile(join(DATA, 'feeds.json')),
    checkFile(join(PIPELINE, 'raw-articles.json')),
    checkFile(join(PIPELINE, 'runs.json')),
  ]);

  const allOk = checks.every((c) => c.ok);

  return Response.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: Object.fromEntries(
        checks.map((c) => [c.path.replace(ROOT, ''), c.ok ? 'ok' : 'missing'])
      ),
    },
    { status: allOk ? 200 : 503 },
  );
}
