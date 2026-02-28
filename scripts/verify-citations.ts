/**
 * verify-citations.ts — Match inline citations to source arrays
 *
 * For every text field that can contain parenthetical citations like (RFI) or (BFM TV, Libération),
 * verify that each cited name exists in the associated sources[] or couvertures[] array.
 * If a cited name is missing: try to find a matching article from the RSS feed and add it.
 * If no RSS match: strip the citation from the text.
 *
 * Usage: npx tsx scripts/verify-citations.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { RawArticle } from './fetch-news.js';

const CITATION_RE = /\(([^)]+)\)/g;

interface CitationFix {
  file: string;
  field: string;
  action: 'added' | 'removed';
  name: string;
}

const fixes: CitationFix[] = [];

// ── RSS article index ──

let articlesBySource: Map<string, RawArticle[]>;

function loadArticles(): RawArticle[] {
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.warn('⚠ raw-articles.json not found — citation auto-add disabled');
    return [];
  }
}

function buildSourceIndex(articles: RawArticle[]): Map<string, RawArticle[]> {
  const map = new Map<string, RawArticle[]>();
  for (const a of articles) {
    const key = a.source.toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

// Known aliases: different names the LLM uses vs what's in feeds
const SOURCE_ALIASES: Record<string, string> = {
  'bfm': 'bfm tv',
  'bfmtv': 'bfm tv',
  'france info': 'franceinfo',
  'france inter': 'france inter',
  'le figaro': 'le figaro',
  'figaro': 'le figaro',
  'libe': 'libération',
  'liberation': 'libération',
  'libé': 'libération',
  'l\'humanité': 'l\'humanité',
  'huma': 'l\'humanité',
  'l\'huma': 'l\'humanité',
  'al jazeera': 'al jazeera english',
  'new york times': 'the new york times',
  'nyt': 'the new york times',
  'bbc': 'bbc news',
  'guardian': 'the guardian',
  'washington post': 'the washington post',
};

function normalizeSourceName(name: string): string {
  const lower = name.toLowerCase().trim();
  return SOURCE_ALIASES[lower] || lower;
}

function findRssArticle(citedName: string): RawArticle | null {
  const normalized = normalizeSourceName(citedName);
  const articles = articlesBySource.get(normalized);
  if (articles && articles.length > 0) return articles[0];

  // Fuzzy: try partial match
  for (const [key, arts] of articlesBySource) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return arts[0];
    }
  }
  return null;
}

// ── Citation extraction ──

// Known media names to positively identify citations
const KNOWN_SOURCES = new Set([
  'rfi', 'bfm tv', 'bfmtv', 'franceinfo', 'france info', 'france 24', 'france inter',
  'le monde', 'libération', 'liberation', 'le figaro', 'mediapart', 'l\'humanité',
  'l\'obs', 'le point', 'les échos', 'la croix', 'ouest-france', 'le parisien',
  '20 minutes', 'reuters', 'associated press', 'ap', 'afp', 'bbc', 'bbc news',
  'the new york times', 'the washington post', 'the guardian', 'al jazeera',
  'al jazeera english', 'courrier international', 'euronews', 'politico',
  'la tribune', 'cnews', 'europe 1', 'arte', 'huffpost', 'le canard enchaîné',
  'charlie hebdo', 'blast', 'reporterre', 'alternatives économiques',
  'the verge', 'techcrunch', 'wired', 'ars technica', 'the register',
  'mit technology review', 'nature', 'science', 'new scientist',
  'le monde diplomatique', 'challenges', 'capital', 'marianne', 'valeurs actuelles',
  'cnn', 'nbc news', 'abc news', 'fox news', 'sky news', 'deutsche welle', 'dw',
  'el país', 'der spiegel', 'la repubblica', 'haaretz', 'times of israel',
  'south china morning post', 'japan times', 'the economist', 'financial times',
  'bloomberg', 'wall street journal', 'wsj',
]);

function looksLikeSourceCitation(inner: string): boolean {
  // Skip numbers, percentages, dates
  if (/^\d/.test(inner)) return false;
  // Skip common non-citation parenthetical patterns
  if (/^(et|ou|voir|dont|en|par|de|du|des|le |la |les |un |une |soit|c'est|qui|que|à |sur |pour |dans |avec |sans |après |avant |entre |comme |selon |plus |moins |très |trop |peu |bien |mal |déjà |encore |aussi |ainsi |donc |car |mais |ni |si |quand |lorsque |depuis |jusqu|pendant |via |ex\.?:|i\.e\.|cf\.|etc\.)[\s.,]/i.test(inner)) return false;
  // Skip if it's a sentence (has a verb-like structure with spaces)
  if ((inner.match(/\s/g) || []).length >= 5) return false;
  // Skip single short words that aren't known sources
  if (inner.length <= 4 && !KNOWN_SOURCES.has(inner.toLowerCase())) return false;

  // Check each comma-separated part
  const parts = inner.split(/,\s*/);
  return parts.some(p => {
    const name = p.trim().toLowerCase();
    if (KNOWN_SOURCES.has(name)) return true;
    // Heuristic: capitalize words (proper nouns) suggest a source name
    if (/^[A-ZÀ-Ü]/.test(p.trim()) && p.trim().length >= 3) return true;
    return false;
  });
}

function extractCitedNames(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CITATION_RE.source, 'g');
  while ((match = re.exec(text)) !== null) {
    const inner = match[1];
    if (inner.length > 80) continue;
    if (!looksLikeSourceCitation(inner)) continue;

    for (const part of inner.split(/,\s*/)) {
      const name = part.trim();
      if (name.length >= 2 && name.length <= 50) {
        names.push(name);
      }
    }
  }
  return names;
}

function removeCitationFromText(text: string, name: string): string {
  // Remove "(Name)" or "Name" within a multi-source citation "(A, Name, B)"
  // Case 1: sole citation "(Name)" → remove entirely
  const soleRe = new RegExp(`\\(\\s*${escapeRegex(name)}\\s*\\)`, 'gi');
  if (soleRe.test(text)) {
    return text.replace(soleRe, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Case 2: part of multi-citation "(A, Name)" or "(Name, B)" → remove just the name
  const partRe = new RegExp(`(\\([^)]*)\\b${escapeRegex(name)}\\b,?\\s*([^)]*)\\)`, 'gi');
  return text.replace(partRe, (_, before, after) => {
    const inner = `${before}${after}`.replace(/\(\s*,\s*/, '(').replace(/,\s*\)/, ')').replace(/,\s*,/, ',');
    return inner;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Processing logic ──

interface SourceEntry {
  nom: string;
  url: string;
  type?: string;
}

interface CouvertureEntry {
  source: string;
  url: string;
  type?: string;
  angle?: string;
  ton?: string;
}

function sourceArrayHas(sources: SourceEntry[], name: string): boolean {
  const normalized = normalizeSourceName(name);
  return sources.some(s =>
    normalizeSourceName(s.nom) === normalized
  );
}

function couvertureArrayHas(couvertures: CouvertureEntry[], name: string): boolean {
  const normalized = normalizeSourceName(name);
  return couvertures.some(c =>
    normalizeSourceName(c.source) === normalized
  );
}

/**
 * Process a text field: extract citations, verify against sources, fix mismatches.
 * Returns the (possibly modified) text and any sources to add.
 */
function processTextField(
  text: string,
  sources: SourceEntry[],
  couvertures: CouvertureEntry[],
  fileName: string,
  fieldPath: string,
): { text: string; addedSources: SourceEntry[] } {
  const cited = extractCitedNames(text);
  const addedSources: SourceEntry[] = [];
  let result = text;

  for (const name of cited) {
    const inSources = sources.length > 0 && sourceArrayHas(sources, name);
    const inCouvertures = couvertures.length > 0 && couvertureArrayHas(couvertures, name);

    if (inSources || inCouvertures) continue;

    // Not found — try RSS
    const rssArticle = findRssArticle(name);
    if (rssArticle) {
      addedSources.push({
        nom: rssArticle.source,
        url: rssArticle.url,
        type: rssArticle.type || 'mainstream',
      });
      fixes.push({ file: fileName, field: fieldPath, action: 'added', name: `${name} → ${rssArticle.source}` });
    } else {
      result = removeCitationFromText(result, name);
      fixes.push({ file: fileName, field: fieldPath, action: 'removed', name });
    }
  }

  return { text: result, addedSources };
}

// ── File processors ──

function processUne(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  // sujet_du_jour
  if (data.sujet_du_jour) {
    const sources: SourceEntry[] = data.sujet_du_jour.sources || [];
    for (const field of ['pourquoi_important', 'contexte'] as const) {
      if (data.sujet_du_jour[field]) {
        const r = processTextField(data.sujet_du_jour[field], sources, [], 'une.json', `sujet_du_jour.${field}`);
        if (r.text !== data.sujet_du_jour[field]) { data.sujet_du_jour[field] = r.text; modified = true; }
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
      }
    }
    if (Array.isArray(data.sujet_du_jour.faits)) {
      data.sujet_du_jour.faits = data.sujet_du_jour.faits.map((f: string, i: number) => {
        const r = processTextField(f, sources, [], 'une.json', `sujet_du_jour.faits[${i}]`);
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
        if (r.text !== f) { modified = true; return r.text; }
        return f;
      });
    }
    data.sujet_du_jour.sources = sources;
  }

  // france / monde
  for (const section of ['france', 'monde']) {
    for (const [i, item] of (data[section] || []).entries()) {
      const sources: SourceEntry[] = item.sources || [];
      if (item.resume) {
        const r = processTextField(item.resume, sources, [], 'une.json', `${section}[${i}].resume`);
        if (r.text !== item.resume) { item.resume = r.text; modified = true; }
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
      }
      if (Array.isArray(item.faits)) {
        item.faits = item.faits.map((f: string, fi: number) => {
          const r = processTextField(f, sources, [], 'une.json', `${section}[${i}].faits[${fi}]`);
          if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
          if (r.text !== f) { modified = true; return r.text; }
          return f;
        });
      }
      item.sources = sources;
    }
  }

  // regard_croise
  if (data.regard_croise) {
    const couvertures: CouvertureEntry[] = data.regard_croise.couvertures || [];
    for (const field of ['contexte', 'analyse_coherence', 'ce_quil_faut_retenir'] as const) {
      if (data.regard_croise[field]) {
        const r = processTextField(data.regard_croise[field], [], couvertures, 'une.json', `regard_croise.${field}`);
        if (r.text !== data.regard_croise[field]) { data.regard_croise[field] = r.text; modified = true; }
      }
    }
    if (Array.isArray(data.regard_croise.biais_detectes)) {
      data.regard_croise.biais_detectes = data.regard_croise.biais_detectes.map((b: string, i: number) => {
        const r = processTextField(b, [], couvertures, 'une.json', `regard_croise.biais_detectes[${i}]`);
        if (r.text !== b) { modified = true; return r.text; }
        return b;
      });
    }
  }

  if (modified) writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function processSoir(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  // analyse_approfondie
  if (data.analyse_approfondie) {
    const sources: SourceEntry[] = data.analyse_approfondie.sources || [];
    for (const field of ['contexte_long', 'notre_analyse'] as const) {
      if (data.analyse_approfondie[field]) {
        const r = processTextField(data.analyse_approfondie[field], sources, [], 'soir.json', `analyse_approfondie.${field}`);
        if (r.text !== data.analyse_approfondie[field]) { data.analyse_approfondie[field] = r.text; modified = true; }
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
      }
    }
    if (Array.isArray(data.analyse_approfondie.enjeux)) {
      data.analyse_approfondie.enjeux = data.analyse_approfondie.enjeux.map((e: string, i: number) => {
        const r = processTextField(e, sources, [], 'soir.json', `analyse_approfondie.enjeux[${i}]`);
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
        if (r.text !== e) { modified = true; return r.text; }
        return e;
      });
    }
    data.analyse_approfondie.sources = sources;
  }

  // regards_croises
  for (const [i, rc] of (data.regards_croises || []).entries()) {
    const couvertures: CouvertureEntry[] = rc.couvertures || [];
    for (const field of ['contexte', 'analyse_coherence', 'ce_quil_faut_retenir'] as const) {
      if (rc[field]) {
        const r = processTextField(rc[field], [], couvertures, 'soir.json', `regards_croises[${i}].${field}`);
        if (r.text !== rc[field]) { rc[field] = r.text; modified = true; }
      }
    }
    for (const arrField of ['biais_detectes', 'doubles_standards'] as const) {
      if (Array.isArray(rc[arrField])) {
        rc[arrField] = rc[arrField].map((b: string, bi: number) => {
          const r = processTextField(b, [], couvertures, 'soir.json', `regards_croises[${i}].${arrField}[${bi}]`);
          if (r.text !== b) { modified = true; return r.text; }
          return b;
        });
      }
    }
  }

  if (modified) writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function processIA(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const [i, fait] of (data.faits_ia || []).entries()) {
    const sources: SourceEntry[] = fait.sources || [];
    for (const field of ['resume', 'pourquoi_ca_compte'] as const) {
      if (fait[field]) {
        const r = processTextField(fait[field], sources, [], 'ia.json', `faits_ia[${i}].${field}`);
        if (r.text !== fait[field]) { fait[field] = r.text; modified = true; }
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
      }
    }
    fait.sources = sources;
  }

  if (data.regard_croise_ia) {
    const couvertures: CouvertureEntry[] = data.regard_croise_ia.couvertures || [];
    for (const field of ['contexte', 'analyse_coherence', 'ce_quil_faut_retenir'] as const) {
      if (data.regard_croise_ia[field]) {
        const r = processTextField(data.regard_croise_ia[field], [], couvertures, 'ia.json', `regard_croise_ia.${field}`);
        if (r.text !== data.regard_croise_ia[field]) { data.regard_croise_ia[field] = r.text; modified = true; }
      }
    }
    if (Array.isArray(data.regard_croise_ia.biais_detectes)) {
      data.regard_croise_ia.biais_detectes = data.regard_croise_ia.biais_detectes.map((b: string, i: number) => {
        const r = processTextField(b, [], couvertures, 'ia.json', `regard_croise_ia.biais_detectes[${i}]`);
        if (r.text !== b) { modified = true; return r.text; }
        return b;
      });
    }
  }

  if (modified) writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function processSujetsChauds(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const listKey of ['sujets_actifs', 'sujets_refroidis']) {
    for (const [i, sujet] of (data[listKey] || []).entries()) {
      const sources: SourceEntry[] = sujet.sources || [];
      const couvertures: CouvertureEntry[] = sujet.couvertures || [];

      if (sujet.resume) {
        const r = processTextField(sujet.resume, sources, couvertures, 'sujets-chauds.json', `${listKey}[${i}].resume`);
        if (r.text !== sujet.resume) { sujet.resume = r.text; modified = true; }
        if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
      }

      if (Array.isArray(sujet.ce_quon_ne_sait_pas)) {
        sujet.ce_quon_ne_sait_pas = sujet.ce_quon_ne_sait_pas.map((t: string, ti: number) => {
          const r = processTextField(t, sources, couvertures, 'sujets-chauds.json', `${listKey}[${i}].ce_quon_ne_sait_pas[${ti}]`);
          if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
          if (r.text !== t) { modified = true; return r.text; }
          return t;
        });
      }

      if (Array.isArray(sujet.chronologie)) {
        for (const [ci, chrono] of sujet.chronologie.entries()) {
          if (chrono.texte) {
            const r = processTextField(chrono.texte, sources, couvertures, 'sujets-chauds.json', `${listKey}[${i}].chronologie[${ci}].texte`);
            if (r.text !== chrono.texte) { chrono.texte = r.text; modified = true; }
            if (r.addedSources.length > 0) { sources.push(...r.addedSources); modified = true; }
          }
        }
      }

      sujet.sources = sources;
    }
  }

  if (modified) writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function processFil(filePath: string) {
  if (!existsSync(filePath)) return;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let modified = false;

  for (const [i, item] of (data.items || []).entries()) {
    if (!item.texte) continue;
    const cited = extractCitedNames(item.texte);
    for (const name of cited) {
      // fil items have a single source/source_url, not an array
      if (item.source && normalizeSourceName(item.source) === normalizeSourceName(name)) continue;

      // Citation doesn't match the item source — check RSS
      const rssArticle = findRssArticle(name);
      if (!rssArticle) {
        item.texte = removeCitationFromText(item.texte, name);
        fixes.push({ file: 'fil.json', field: `items[${i}].texte`, action: 'removed', name });
        modified = true;
      }
      // If found in RSS, the citation is legitimate but can't be linked (fil has single source)
      // Leave it as-is — LinkedText won't link it but the info is accurate
    }
  }

  if (modified) writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Main ──

function main() {
  const articles = loadArticles();
  articlesBySource = buildSourceIndex(articles);

  const dataDir = new URL('../src/data/', import.meta.url);

  console.log('\n[Verify Citations] Vérification des citations inline...');
  console.log('─'.repeat(50));

  processUne(new URL('une.json', dataDir).pathname);
  processSoir(new URL('soir.json', dataDir).pathname);
  processIA(new URL('ia.json', dataDir).pathname);
  processSujetsChauds(new URL('sujets-chauds.json', dataDir).pathname);
  processFil(new URL('fil.json', dataDir).pathname);

  // Report
  const added = fixes.filter(f => f.action === 'added');
  const removed = fixes.filter(f => f.action === 'removed');

  if (fixes.length === 0) {
    console.log('✓ Toutes les citations inline sont correctement sourcées');
  } else {
    if (added.length > 0) {
      console.log(`\n✚ ${added.length} source(s) ajoutée(s) depuis le flux RSS :`);
      for (const f of added) {
        console.log(`  [${f.file}] ${f.field} — ${f.name}`);
      }
    }
    if (removed.length > 0) {
      console.log(`\n✗ ${removed.length} citation(s) orpheline(s) supprimée(s) :`);
      for (const f of removed) {
        console.log(`  [${f.file}] ${f.field} — "${f.name}"`);
      }
    }
    console.log(`\n✓ Citations corrigées — ${added.length} ajoutée(s), ${removed.length} supprimée(s)`);
  }
}

main();
