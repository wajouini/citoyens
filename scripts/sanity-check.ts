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
  }

  if (modified) {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function sanitizeSujetsChauds(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const [i, sujet] of (data.sujets_actifs || []).entries()) {
    if (sujet.sources) {
      const before = sujet.sources.length;
      sujet.sources = filterSources(sujet.sources, 'sujets-chauds.json', `sujets_actifs[${i}].sources`);
      if (sujet.sources.length !== before) modified = true;
    }
    if (sujet.couvertures) {
      const before = sujet.couvertures.length;
      sujet.couvertures = filterCouvertures(
        sujet.couvertures, 'sujets-chauds.json', `sujets_actifs[${i}].couvertures`
      );
      if (sujet.couvertures.length !== before) modified = true;
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
    console.log(`\n✓ Données nettoyées — ${corrections.length} référence(s) sans URL supprimée(s)`);
  }
}

main();
