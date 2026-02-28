'use server';

import {
  getUne,
  getUneFileDate,
  getUneByDate,
  getEditionHistory,
  getEditionMeta,
  saveEditionMeta,
  saveUne,
  computeEditorialAlerts,
  type EditionSummary,
  type EditionMeta,
  type EditorialAlert,
} from '@/lib/local-data';
import type { Une } from '@/lib/types';
import { logAudit } from '@/lib/audit';

export async function loadEdition(date?: string) {
  if (date) {
    const une = await getUneByDate(date);
    return { une, fileDate: null };
  }
  const [une, fileDate] = await Promise.all([getUne(), getUneFileDate()]);
  return { une, fileDate: fileDate?.toISOString() ?? null };
}

export async function loadEditionHistory(): Promise<EditionSummary[]> {
  return getEditionHistory();
}

export async function loadEditionMeta(): Promise<EditionMeta> {
  return getEditionMeta();
}

export async function loadEditorialAlerts(): Promise<EditorialAlert[]> {
  const une = await getUne();
  return computeEditorialAlerts(une);
}

export async function saveEditionEdits(une: Une): Promise<{ success: boolean; error?: string }> {
  try {
    await saveUne(une);
    const meta = await getEditionMeta();
    meta.status = 'reviewed';
    meta.lastEditedAt = new Date().toISOString();
    meta.editHistory.push({ field: 'edition', timestamp: new Date().toISOString() });
    await saveEditionMeta(meta);
    await logAudit({ action: 'edition_save', detail: 'Modifications éditoriales sauvegardées', result: 'success' });
    return { success: true };
  } catch (err: any) {
    await logAudit({ action: 'edition_save', detail: err.message, result: 'failed' });
    return { success: false, error: err.message };
  }
}

export async function publishEdition(): Promise<{ success: boolean; error?: string }> {
  try {
    const meta = await getEditionMeta();
    meta.status = 'published';
    meta.publishedAt = new Date().toISOString();
    await saveEditionMeta(meta);
    await logAudit({ action: 'edition_publish', detail: 'Édition publiée', result: 'success' });
    return { success: true };
  } catch (err: any) {
    await logAudit({ action: 'edition_publish', detail: err.message, result: 'failed' });
    return { success: false, error: err.message };
  }
}

export async function revertToDraft(): Promise<{ success: boolean; error?: string }> {
  try {
    const meta = await getEditionMeta();
    meta.status = 'draft';
    meta.publishedAt = null;
    await saveEditionMeta(meta);
    await logAudit({ action: 'edition_revert', detail: 'Édition repassée en brouillon', result: 'success' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
