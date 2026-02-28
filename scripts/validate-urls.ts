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

interface UrlRef { obj: any; field: string; label: string }

async function validateRefs(refs: UrlRef[], urlIndex: Set<string>): Promise<UrlValidationResult> {
  const result: UrlValidationResult = { total: refs.length, valid_rss: 0, valid_http: 0, removed: 0, details: [] };

  const needsHttpCheck: UrlRef[] = [];
  for (const ref of refs) {
    const url = ref.obj[ref.field];
    if (isInRssFeed(url, urlIndex) || isInstitutionalUrl(url)) {
      result.valid_rss++;
    } else {
      needsHttpCheck.push(ref);
    }
  }

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

function collectSourceRefs(sources: any[]): UrlRef[] {
  return (sources || []).filter((s: any) => s.url).map((s: any) => ({ obj: s, field: 'url', label: s.nom || s.source || '?' }));
}

function collectCouvertureRefs(couvertures: any[]): UrlRef[] {
  return (couvertures || []).filter((c: any) => c.url).map((c: any) => ({ obj: c, field: 'url', label: c.source || '?' }));
}

export async function validateEditionUrls(data: any, articles: RawArticle[]): Promise<UrlValidationResult> {
  const urlIndex = buildUrlIndex(articles);
  const refs: UrlRef[] = [];

  if (data.sujet_du_jour) {
    refs.push(...collectSourceRefs(data.sujet_du_jour.sources));
  }

  for (const e of data.essentiels || []) {
    refs.push(...collectSourceRefs(e.sources));
  }

  for (const item of data.france || []) {
    refs.push(...collectSourceRefs(item.sources));
  }

  for (const item of data.monde || []) {
    refs.push(...collectSourceRefs(item.sources));
  }

  if (data.regard_croise) {
    refs.push(...collectCouvertureRefs(data.regard_croise.couvertures));
  }

  for (const rc of data.regards_croises || []) {
    refs.push(...collectCouvertureRefs(rc.couvertures));
  }

  for (const re of data.regard_etranger || []) {
    if (re.url) refs.push({ obj: re, field: 'url', label: re.source || '?' });
  }

  if (data.analyse_approfondie) {
    for (const p of data.analyse_approfondie.perspectives || []) {
      if (p.source?.url) refs.push({ obj: p.source, field: 'url', label: p.source.nom || '?' });
    }
    refs.push(...collectSourceRefs(data.analyse_approfondie.sources));
  }

  if (data.chiffre_du_jour?.source_url) {
    refs.push({ obj: data.chiffre_du_jour, field: 'source_url', label: data.chiffre_du_jour.source || '?' });
  }

  return validateRefs(refs, urlIndex);
}

export async function validateIAUrls(data: any, articles: RawArticle[]): Promise<UrlValidationResult> {
  const urlIndex = buildUrlIndex(articles);
  const refs: UrlRef[] = [];

  for (const fait of data.faits_ia || []) {
    refs.push(...collectSourceRefs(fait.sources));
  }

  if (data.regard_croise_ia) {
    refs.push(...collectCouvertureRefs(data.regard_croise_ia.couvertures));
  }

  return validateRefs(refs, urlIndex);
}

export async function validateFilUrls(data: any, articles: RawArticle[]): Promise<UrlValidationResult> {
  const urlIndex = buildUrlIndex(articles);
  const refs: UrlRef[] = [];

  for (const item of data.items || []) {
    if (item.source_url) refs.push({ obj: item, field: 'source_url', label: item.source || '?' });
  }

  return validateRefs(refs, urlIndex);
}

export async function validateSujetsChaudsUrls(data: any, articles: RawArticle[]): Promise<UrlValidationResult> {
  const urlIndex = buildUrlIndex(articles);
  const refs: UrlRef[] = [];

  for (const sujet of [...(data.sujets_actifs || []), ...(data.sujets_refroidis || [])]) {
    refs.push(...collectSourceRefs(sujet.sources));
    refs.push(...collectCouvertureRefs(sujet.couvertures));
  }

  return validateRefs(refs, urlIndex);
}
