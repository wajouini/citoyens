/**
 * sanity-check.ts — Post-generation data quality pass
 *
 * Runs after all generate-* scripts and before the build step.
 * Scans every generated JSON file and enforces data quality rules:
 *
 *   1. Remove sources/references with null or empty URLs
 *   2. Remove duplicate sources within the same item
 *   3. Log a summary of all corrections applied
 *
 * Usage: npx tsx scripts/sanity-check.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

interface Correction {
  file: string;
  path: string;
  issue: string;
  removed: string;
}

const corrections: Correction[] = [];

function hasValidUrl(obj: any): boolean {
  if (!obj) return false;
  const url = obj.url || obj.source_url;
  return typeof url === 'string' && url.length > 0 && url !== 'null';
}

function filterSources(sources: any[], filePath: string, jsonPath: string): any[] {
  if (!Array.isArray(sources)) return sources;
  return sources.filter(src => {
    if (hasValidUrl(src)) return true;
    corrections.push({
      file: filePath,
      path: jsonPath,
      issue: 'source sans URL',
      removed: src.nom || src.source || src.name || JSON.stringify(src).slice(0, 60),
    });
    return false;
  });
}

function filterCouvertures(couvertures: any[], filePath: string, jsonPath: string): any[] {
  if (!Array.isArray(couvertures)) return couvertures;
  return couvertures.filter(c => {
    if (hasValidUrl(c)) return true;
    corrections.push({
      file: filePath,
      path: jsonPath,
      issue: 'couverture sans URL',
      removed: c.source || c.nom || JSON.stringify(c).slice(0, 60),
    });
    return false;
  });
}

function deduplicateSources(sources: any[]): any[] {
  if (!Array.isArray(sources)) return sources;
  const seen = new Set<string>();
  return sources.filter(src => {
    const key = src.url || src.source_url || '';
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Cross-reference source name ↔ URL domain ──

const SOURCE_DOMAINS: Record<string, string[]> = {
  'le monde': ['lemonde.fr'],
  'franceinfo': ['francetvinfo.fr', 'franceinfo.fr'],
  'france info': ['francetvinfo.fr', 'franceinfo.fr'],
  'bfm tv': ['bfmtv.com'],
  'bfmtv': ['bfmtv.com'],
  'rfi': ['rfi.fr'],
  'libération': ['liberation.fr'],
  'liberation': ['liberation.fr'],
  'the guardian': ['theguardian.com'],
  'le figaro': ['lefigaro.fr'],
  'mediapart': ['mediapart.fr'],
  'france 24': ['france24.com'],
  'l\'humanité': ['humanite.fr'],
  'l\'obs': ['nouvelobs.com'],
  'le point': ['lepoint.fr'],
  'les échos': ['lesechos.fr'],
  'la croix': ['la-croix.com'],
  'ouest-france': ['ouest-france.fr'],
  'le parisien': ['leparisien.fr'],
  '20 minutes': ['20minutes.fr'],
  'reuters': ['reuters.com'],
  'associated press': ['apnews.com'],
  'bbc news': ['bbc.com', 'bbc.co.uk'],
  'bbc': ['bbc.com', 'bbc.co.uk'],
  'the new york times': ['nytimes.com'],
  'the washington post': ['washingtonpost.com'],
  'al jazeera': ['aljazeera.com'],
  'al jazeera english': ['aljazeera.com'],
  'courrier international': ['courrierinternational.com'],
  'euronews': ['euronews.com'],
  'politico': ['politico.eu', 'politico.com'],
  'la tribune': ['latribune.fr'],
  'cnews': ['cnews.fr'],
  'europe 1': ['europe1.fr'],
  'arte': ['arte.tv'],
  'huffpost': ['huffingtonpost.fr', 'huffpost.com'],
  'le canard enchaîné': ['lecanardenchaine.fr'],
  'charlie hebdo': ['charliehebdo.fr'],
  'blast': ['blast-info.fr'],
  'reporterre': ['reporterre.net'],
  'alternatives économiques': ['alternatives-economiques.fr'],
};

const DOMAIN_TO_SOURCE: Map<string, string> = new Map();
for (const [name, domains] of Object.entries(SOURCE_DOMAINS)) {
  for (const d of domains) {
    DOMAIN_TO_SOURCE.set(d, name);
  }
}

function getDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return null;
  }
}

function verifySourceNameMatchesUrl(sources: any[], filePath: string, jsonPath: string): boolean {
  let modified = false;
  for (const src of sources) {
    const url = src.url || src.source_url;
    const name = (src.nom || src.source || '').toLowerCase().trim();
    if (!url || !name) continue;

    const domain = getDomain(url);
    if (!domain) continue;

    const expectedDomains = SOURCE_DOMAINS[name];
    if (expectedDomains && !expectedDomains.some(d => domain.endsWith(d))) {
      // Domain doesn't match declared name — try to correct from domain
      const correctName = DOMAIN_TO_SOURCE.get(domain);
      if (correctName) {
        const originalName = src.nom || src.source;
        if (src.nom) src.nom = correctName.charAt(0).toUpperCase() + correctName.slice(1);
        else if (src.source) src.source = correctName.charAt(0).toUpperCase() + correctName.slice(1);
        corrections.push({
          file: filePath,
          path: jsonPath,
          issue: `nom/URL mismatch corrigé`,
          removed: `"${originalName}" → "${src.nom || src.source}" (domaine: ${domain})`,
        });
        modified = true;
      } else {
        corrections.push({
          file: filePath,
          path: jsonPath,
          issue: `nom/URL mismatch détecté (non corrigé)`,
          removed: `"${name}" vs domaine ${domain}`,
        });
      }
    }
  }
  return modified;
}

function sanitizeUne(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  if (data.sujet_du_jour?.sources) {
    const before = data.sujet_du_jour.sources.length;
    data.sujet_du_jour.sources = deduplicateSources(
      filterSources(data.sujet_du_jour.sources, 'une.json', 'sujet_du_jour.sources')
    );
    if (data.sujet_du_jour.sources.length !== before) modified = true;
  }

  for (const section of ['france', 'monde', 'essentiels']) {
    for (const [i, item] of (data[section] || []).entries()) {
      if (item.sources) {
        const before = item.sources.length;
        item.sources = deduplicateSources(
          filterSources(item.sources, 'une.json', `${section}[${i}].sources`)
        );
        if (item.sources.length !== before) modified = true;
      }
    }
  }

  if (data.regard_croise?.couvertures) {
    const before = data.regard_croise.couvertures.length;
    data.regard_croise.couvertures = filterCouvertures(
      data.regard_croise.couvertures, 'une.json', 'regard_croise.couvertures'
    );
    if (data.regard_croise.couvertures.length !== before) modified = true;
  }

  for (const [i, item] of (data.regard_etranger || []).entries()) {
    if (!hasValidUrl(item)) {
      corrections.push({
        file: 'une.json',
        path: `regard_etranger[${i}]`,
        issue: 'regard étranger sans URL',
        removed: item.source || item.titre || '?',
      });
    }
  }
  const reBeforeLen = (data.regard_etranger || []).length;
  data.regard_etranger = (data.regard_etranger || []).filter(hasValidUrl);
  if (data.regard_etranger.length !== reBeforeLen) modified = true;

  if (data.chiffre_du_jour && !data.chiffre_du_jour.source_url) {
    corrections.push({
      file: 'une.json',
      path: 'chiffre_du_jour.source_url',
      issue: 'chiffre du jour sans URL source',
      removed: data.chiffre_du_jour.source || '?',
    });
  }

  // Cross-reference nom/URL
  if (data.sujet_du_jour?.sources) {
    if (verifySourceNameMatchesUrl(data.sujet_du_jour.sources, 'une.json', 'sujet_du_jour.sources')) modified = true;
  }
  for (const section of ['france', 'monde', 'essentiels']) {
    for (const [i, item] of (data[section] || []).entries()) {
      if (item.sources) {
        if (verifySourceNameMatchesUrl(item.sources, 'une.json', `${section}[${i}].sources`)) modified = true;
      }
    }
  }
  if (data.regard_croise?.couvertures) {
    if (verifySourceNameMatchesUrl(data.regard_croise.couvertures, 'une.json', 'regard_croise.couvertures')) modified = true;
  }

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function sanitizeFil(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const [i, item] of (data.items || []).entries()) {
    if (item.source_url === null || item.source_url === '') {
      corrections.push({
        file: 'fil.json',
        path: `items[${i}].source_url`,
        issue: 'item fil sans URL source',
        removed: `${item.source}: ${item.texte?.slice(0, 40)}...`,
      });
    }
  }

  const beforeLen = (data.items || []).length;
  data.items = (data.items || []).filter((item: any) =>
    typeof item.source_url === 'string' && item.source_url.length > 0
  );
  if (data.items.length !== beforeLen) modified = true;

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function sanitizeIA(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const [i, fait] of (data.faits_ia || []).entries()) {
    if (fait.sources) {
      const before = fait.sources.length;
      fait.sources = deduplicateSources(
        filterSources(fait.sources, 'ia.json', `faits_ia[${i}].sources`)
      );
      if (fait.sources.length !== before) modified = true;
    }
  }

  if (data.regard_croise_ia?.couvertures) {
    const before = data.regard_croise_ia.couvertures.length;
    data.regard_croise_ia.couvertures = filterCouvertures(
      data.regard_croise_ia.couvertures, 'ia.json', 'regard_croise_ia.couvertures'
    );
    if (data.regard_croise_ia.couvertures.length !== before) modified = true;
    if (verifySourceNameMatchesUrl(data.regard_croise_ia.couvertures, 'ia.json', 'regard_croise_ia.couvertures')) modified = true;
  }

  // Cross-reference nom/URL on faits_ia sources
  for (const [i, fait] of (data.faits_ia || []).entries()) {
    if (fait.sources) {
      if (verifySourceNameMatchesUrl(fait.sources, 'ia.json', `faits_ia[${i}].sources`)) modified = true;
    }
  }

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function sanitizeSujetsChauds(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const listKey of ['sujets_actifs', 'sujets_refroidis']) {
    for (const [i, sujet] of (data[listKey] || []).entries()) {
      if (sujet.sources) {
        const before = sujet.sources.length;
        sujet.sources = deduplicateSources(
          filterSources(sujet.sources, 'sujets-chauds.json', `${listKey}[${i}].sources`)
        );
        if (sujet.sources.length !== before) modified = true;
        if (verifySourceNameMatchesUrl(sujet.sources, 'sujets-chauds.json', `${listKey}[${i}].sources`)) modified = true;
      }
      if (sujet.couvertures) {
        const before = sujet.couvertures.length;
        sujet.couvertures = filterCouvertures(
          sujet.couvertures, 'sujets-chauds.json', `${listKey}[${i}].couvertures`
        );
        if (sujet.couvertures.length !== before) modified = true;
        if (verifySourceNameMatchesUrl(sujet.couvertures, 'sujets-chauds.json', `${listKey}[${i}].couvertures`)) modified = true;
      }
    }
  }

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function sanitizeSoir(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const section of ['analyse', 'debriefing', 'demain']) {
    for (const [i, item] of (data[section] || []).entries()) {
      if (item.sources) {
        const before = item.sources.length;
        item.sources = deduplicateSources(
          filterSources(item.sources, 'soir.json', `${section}[${i}].sources`)
        );
        if (item.sources.length !== before) modified = true;
      }
    }
  }

  if (data.regard_croise?.couvertures) {
    const before = data.regard_croise.couvertures.length;
    data.regard_croise.couvertures = filterCouvertures(
      data.regard_croise.couvertures, 'soir.json', 'regard_croise.couvertures'
    );
    if (data.regard_croise.couvertures.length !== before) modified = true;
    if (verifySourceNameMatchesUrl(data.regard_croise.couvertures, 'soir.json', 'regard_croise.couvertures')) modified = true;
  }

  // Cross-reference nom/URL on section sources
  for (const section of ['analyse', 'debriefing', 'demain']) {
    for (const [i, item] of (data[section] || []).entries()) {
      if (item.sources) {
        if (verifySourceNameMatchesUrl(item.sources, 'soir.json', `${section}[${i}].sources`)) modified = true;
      }
    }
  }

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function main() {
  const dataDir = new URL('../src/data/', import.meta.url);

  console.log('\n[Sanity Check] Nettoyage des données générées...');
  console.log('─'.repeat(40));

  sanitizeUne(new URL('une.json', dataDir).pathname);
  sanitizeFil(new URL('fil.json', dataDir).pathname);
  sanitizeIA(new URL('ia.json', dataDir).pathname);
  sanitizeSujetsChauds(new URL('sujets-chauds.json', dataDir).pathname);
  sanitizeSoir(new URL('soir.json', dataDir).pathname);

  if (corrections.length === 0) {
    console.log('✓ Aucune correction nécessaire — toutes les données sont propres');
  } else {
    console.log(`\n⚠ ${corrections.length} correction(s) appliquée(s) :\n`);
    for (const c of corrections) {
      console.log(`  [${c.file}] ${c.path}`);
      console.log(`    → ${c.issue} : "${c.removed}"`);
    }
    console.log(`\n✓ Données nettoyées — ${corrections.length} correction(s) appliquée(s)`);
  }

  // Quality stats
  printQualityStats(dataDir);
}

function countSources(data: any, paths: string[][]): { total: number; withUrl: number } {
  let total = 0;
  let withUrl = 0;
  for (const path of paths) {
    let current: any = data;
    for (const key of path) {
      if (key === '[]') {
        if (!Array.isArray(current)) { current = null; break; }
        let subTotal = 0, subWithUrl = 0;
        for (const item of current) {
          const remaining = path.slice(path.indexOf(key) + 1);
          if (remaining.length === 0) {
            subTotal++;
            if (hasValidUrl(item)) subWithUrl++;
          } else {
            let sub = item;
            for (const k of remaining) {
              if (k === '[]') {
                if (Array.isArray(sub)) {
                  subTotal += sub.length;
                  subWithUrl += sub.filter(hasValidUrl).length;
                }
                sub = null;
                break;
              }
              sub = sub?.[k];
            }
          }
        }
        total += subTotal;
        withUrl += subWithUrl;
        current = null;
        break;
      }
      current = current?.[key];
    }
    if (current && Array.isArray(current)) {
      total += current.length;
      withUrl += current.filter(hasValidUrl).length;
    }
  }
  return { total, withUrl };
}

function printQualityStats(dataDir: URL) {
  console.log('\n' + '─'.repeat(50));
  console.log('📊 Rapport qualité des sources\n');

  let grandTotal = 0;
  let grandWithUrl = 0;

  const files = ['une.json', 'soir.json', 'ia.json', 'sujets-chauds.json', 'fil.json'];
  for (const file of files) {
    const filePath = new URL(file, dataDir);
    if (!existsSync(filePath.pathname)) continue;
    const data = JSON.parse(readFileSync(filePath.pathname, 'utf-8'));

    let fileTotal = 0;
    let fileWithUrl = 0;

    const scanArraySources = (arr: any[], field: string) => {
      for (const item of arr || []) {
        const sources = item[field];
        if (Array.isArray(sources)) {
          fileTotal += sources.length;
          fileWithUrl += sources.filter(hasValidUrl).length;
        }
      }
    };

    if (file === 'une.json') {
      if (data.sujet_du_jour?.sources) {
        fileTotal += data.sujet_du_jour.sources.length;
        fileWithUrl += data.sujet_du_jour.sources.filter(hasValidUrl).length;
      }
      scanArraySources(data.france || [], 'sources');
      scanArraySources(data.monde || [], 'sources');
      scanArraySources(data.essentiels || [], 'sources');
      if (data.regard_croise?.couvertures) {
        fileTotal += data.regard_croise.couvertures.length;
        fileWithUrl += data.regard_croise.couvertures.filter(hasValidUrl).length;
      }
    } else if (file === 'soir.json') {
      for (const section of ['analyse', 'debriefing', 'demain']) scanArraySources(data[section] || [], 'sources');
      if (data.analyse_approfondie?.sources) {
        fileTotal += data.analyse_approfondie.sources.length;
        fileWithUrl += data.analyse_approfondie.sources.filter(hasValidUrl).length;
      }
      for (const rc of data.regards_croises || []) {
        if (rc.couvertures) {
          fileTotal += rc.couvertures.length;
          fileWithUrl += rc.couvertures.filter(hasValidUrl).length;
        }
      }
    } else if (file === 'ia.json') {
      scanArraySources(data.faits_ia || [], 'sources');
      if (data.regard_croise_ia?.couvertures) {
        fileTotal += data.regard_croise_ia.couvertures.length;
        fileWithUrl += data.regard_croise_ia.couvertures.filter(hasValidUrl).length;
      }
    } else if (file === 'sujets-chauds.json') {
      for (const listKey of ['sujets_actifs', 'sujets_refroidis']) {
        for (const sujet of data[listKey] || []) {
          if (sujet.sources) {
            fileTotal += sujet.sources.length;
            fileWithUrl += sujet.sources.filter(hasValidUrl).length;
          }
          if (sujet.couvertures) {
            fileTotal += sujet.couvertures.length;
            fileWithUrl += sujet.couvertures.filter(hasValidUrl).length;
          }
        }
      }
    } else if (file === 'fil.json') {
      for (const item of data.items || []) {
        fileTotal++;
        if (typeof item.source_url === 'string' && item.source_url.length > 0) fileWithUrl++;
      }
    }

    grandTotal += fileTotal;
    grandWithUrl += fileWithUrl;
    const pct = fileTotal > 0 ? Math.round((fileWithUrl / fileTotal) * 100) : 100;
    console.log(`  ${file.padEnd(22)} ${String(fileWithUrl).padStart(3)}/${String(fileTotal).padStart(3)} sources avec URL (${pct}%)`);
  }

  const grandPct = grandTotal > 0 ? Math.round((grandWithUrl / grandTotal) * 100) : 100;
  console.log(`  ${'─'.repeat(46)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(grandWithUrl).padStart(3)}/${String(grandTotal).padStart(3)} sources avec URL (${grandPct}%)`);
}

main();
