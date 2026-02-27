import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd().replace(/\/admin$/, '');
const AUDIT_PATH = join(ROOT, 'src', 'data', '.pipeline', 'audit.json');
const MAX_ENTRIES = 200;

export interface AuditEntry {
  timestamp: string;
  action: string;
  detail?: string;
  result?: 'success' | 'failed' | 'started';
  duration_s?: number;
}

export async function logAudit(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  try {
    await mkdir(join(ROOT, 'src', 'data', '.pipeline'), { recursive: true });

    let entries: AuditEntry[] = [];
    try {
      const raw = await readFile(AUDIT_PATH, 'utf-8');
      entries = JSON.parse(raw);
    } catch { /* file doesn't exist yet */ }

    entries.push({ ...entry, timestamp: new Date().toISOString() });

    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
    }

    await writeFile(AUDIT_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // Non-critical — don't break the caller
  }
}
