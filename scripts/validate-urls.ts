/**
 * validate-urls.ts — Cross-reference LLM-generated URLs against real sources
 *
 * 1. If URL is in the RSS feed → valid
 * 2. If URL is an institutional source → valid
 * 3. Otherwise → HTTP HEAD check: 200 = keep, 404/error = remove
 */

import type { RawArticle } from './fetch-news.js';

interface UrlValidationResult {
  total: number;
  valid_rss: number;
  valid_http: number;
  removed: number;
  details: string[];
}

function buildUrlIndex(articles: RawArticle[]): Set<string> {
  const urls = new Set<string>();
  for (const a of articles) {
    urls.add(a.url);
    try {
      const u = new URL(a.url);
      urls.add(`${u.origin}${u.pathname}`);
      urls.add(`${u.origin}${u.pathname.replace(/\/$/, '')}`);
    } catch { /* skip */ }
  }
  return urls;
}

function isInstitutionalUrl(url: string): boolean {
  const allowed = [
    'data.gouv.fr', 'assemblee-nationale.fr', 'senat.fr', 'legifrance.gouv.fr',
    'insee.fr', 'eurostat.ec.europa.eu', 'who.int', 'un.org',
    'elysee.fr', 'gouvernement.fr', 'europa.eu', 'ecb.europa.eu',
  ];
  try {
    const hostname = new URL(url).hostname;
    return allowed.some(d => hostname.endsWith(d));
  } catch {
    return false;
  }
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Citoyens.ai/1.0 (URL validator)' },
    });
    clearTimeout(timeout);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

function isInRssFeed(url: string, urlIndex: Set<string>): boolean {
  if (urlIndex.has(url)) return true;
  try {
    const u = new URL(url);
    const normalized = `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    if (urlIndex.has(normalized)) return true;
  } catch { /* skip */ }
  return false;
}

export async function validateEditionUrls(data: any, articles: RawArticle[]): Promise<UrlValidationResult> {
  const urlIndex = buildUrlIndex(articles);
  const result: UrlValidationResult = { total: 0, valid_rss: 0, valid_http: 0, removed: 0, details: [] };

  // Collect all URL references to check
  interface UrlRef { obj: any; field: string; label: string }
  const refs: UrlRef[] = [];

  if (data.sujet_du_jour) {
    for (const s of data.sujet_du_jour.sources || []) {
      if (s.url) refs.push({ obj: s, field: 'url', label: s.nom || '?' });
    }
  }

  for (const e of data.essentiels || []) {
    for (const s of e.sources || []) {
      if (s.url) refs.push({ obj: s, field: 'url', label: s.nom || '?' });
    }
  }

  if (data.regard_croise) {
    for (const c of data.regard_croise.couvertures || []) {
      if (c.url) refs.push({ obj: c, field: 'url', label: c.source || '?' });
    }
  }

  for (const rc of data.regards_croises || []) {
    for (const c of rc.couvertures || []) {
      if (c.url) refs.push({ obj: c, field: 'url', label: c.source || '?' });
    }
  }

  if (data.analyse_approfondie) {
    for (const p of data.analyse_approfondie.perspectives || []) {
      if (p.source?.url) refs.push({ obj: p.source, field: 'url', label: p.source.nom || '?' });
    }
    for (const s of data.analyse_approfondie.sources || []) {
      if (s.url) refs.push({ obj: s, field: 'url', label: s.nom || '?' });
    }
  }

  if (data.chiffre_du_jour?.source_url) {
    refs.push({ obj: data.chiffre_du_jour, field: 'source_url', label: data.chiffre_du_jour.source || '?' });
  }

  result.total = refs.length;

  // Phase 1: check against RSS feed
  const needsHttpCheck: UrlRef[] = [];
  for (const ref of refs) {
    const url = ref.obj[ref.field];
    if (isInRssFeed(url, urlIndex) || isInstitutionalUrl(url)) {
      result.valid_rss++;
    } else {
      needsHttpCheck.push(ref);
    }
  }

  // Phase 2: HTTP HEAD for URLs not in RSS (parallel, batched)
  if (needsHttpCheck.length > 0) {
    console.log(`  Checking ${needsHttpCheck.length} URL(s) not in RSS feed...`);
    const checks = await Promise.all(
      needsHttpCheck.map(async (ref) => {
        const url = ref.obj[ref.field];
        const exists = await urlExists(url);
        return { ref, url, exists };
      })
    );

    for (const { ref, url, exists } of checks) {
      if (exists) {
        result.valid_http++;
      } else {
        ref.obj[ref.field] = null;
        result.removed++;
        result.details.push(`${ref.label}: ${url}`);
      }
    }
  }

  return result;
}
