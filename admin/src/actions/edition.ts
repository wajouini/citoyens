'use server';

import { getUne, getUneFileDate, getUneByDate, getEditionHistory, type EditionSummary } from '@/lib/local-data';

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
