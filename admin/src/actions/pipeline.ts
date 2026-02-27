'use server';

import { getDashboardStats as getLocalStats, getRuns, type RunLog } from '@/lib/local-data';

export async function getDashboardData() {
  return getLocalStats();
}

export async function getRecentRuns(): Promise<RunLog[]> {
  const runs = await getRuns();
  return [...runs].reverse();
}
