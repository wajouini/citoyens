/**
 * generate-sujets-chauds.ts — Generate trending/hot topics via LLM
 *
 * Detects high-intensity media coverage, generates:
 * - 2-4 active hot topics with chronology and cross-media analysis
 * - Previously hot topics that have cooled down
 *
 * Usage: npx tsx scripts/generate-sujets-chauds.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { SujetsChaudsSchema } from './schemas/sujets-chauds.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import { validateSujetsChaudsUrls } from './validate-urls.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '3.0.0';

interface GroupeMedia {
  id: string;
  nom: string;
  proprietaires: { nom: string; type: string; fortune_source: string }[];
  orientation: string;
  medias: string[];
}

interface FeedMeta {
  nom: string;
  groupe: string | null;
  orientation: string | null;
  ligne_editoriale: string | null;
}

const SYSTEM_PROMPT = `Tu es un journaliste d'investigation expérimenté, rédacteur en chef de Citoyens.ai, section "Radar".

## Mission
Identifier les 3-6 sujets que les gens suivent en ce moment et rédiger des analyses journalistiques denses, sourcées, sans remplissage.
Tu sais croiser les sources, reconnaître les biais, et donner le contexte historique qui manque presque toujours au débat immédiat.

## Critères de sélection
- Couvert par 3+ sources avec des angles différents
- Forte intensité médiatique OU sujet important sous-couvert
- Le genre de sujet dont les gens parlent au bureau ou en famille
- Signaux de buzz : sujets tendance sur HackerNews, Reddit, Wikipedia (fournis séparément)

## Format de sortie JSON

{
  "sujets_actifs": [
    {
      "titre": "string (titre factuel direct, pas de dramaturgie)",
      "slug": "string (URL-friendly: lettres minuscules, chiffres, tirets)",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "tldr": [
        "string (fait essentiel 1 — formulation directe, < 120 caractères)",
        "string (fait essentiel 2)",
        "string (fait essentiel 3 — optionnel)"
      ],
      "resume": "string (synthèse journalistique 4-6 phrases : quoi, qui, depuis quand, pourquoi c'est important — croiser au moins 2 sources, signaler les contradictions)",
      "contexte_historique": "string (2-4 phrases : précédents historiques, comparaisons internationales, droit applicable, données chiffrées documentées — pas de rhétorique, uniquement des faits vérifiables avec source entre parenthèses)",
      "implications": [
        "string (conséquence concrète documentée 1)",
        "string (conséquence concrète documentée 2)"
      ],
      "chronologie": [
        { "date": "YYYY-MM-DD", "texte": "string (1 phrase factuelle)", "source": "string" }
      ],
      "couvertures": [
        {
          "source": "string",
          "type": "investigation|mainstream|fact-check|etranger|institutionnel",
          "angle": "string (1 phrase — l'angle éditorial spécifique de ce média)",
          "ton": "critique|factuel|alarmiste|complaisant|neutre|engage",
          "url": "string (URL valide)",
          "citation_cle": "string"
        }
      ],
      "ce_quon_ne_sait_pas": ["string (question ouverte honnête)"],
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "string" }],
      "premiere_apparition": "YYYY-MM-DD"
    }
  ],
  "sujets_refroidis": [
    {
      "titre": "string",
      "slug": "string",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "resume": "string (2-3 phrases : état actuel du sujet)",
      "chronologie": [
        { "date": "YYYY-MM-DD", "texte": "string (1 phrase factuelle)", "source": "string" }
      ],
      "couvertures": [
        {
          "source": "string",
          "type": "investigation|mainstream|fact-check|etranger|institutionnel",
          "angle": "string (1 phrase)",
          "ton": "critique|factuel|alarmiste|complaisant|neutre|engage",
          "url": "string (URL valide)",
          "citation_cle": "string"
        }
      ],
      "ce_quon_ne_sait_pas": ["string (question ouverte)"],
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "string" }],
      "derniere_mise_a_jour": "YYYY-MM-DD",
      "statut": "string (1 phrase sur où en est le sujet)"
    }
  ]
}

## Grille de lecture éditoriale
Citoyens.ai applique une exigence journalistique claire :
- Une affirmation seule n'est pas un fait : croiser les sources systématiquement
- Appliquer les mêmes standards moraux et juridiques à tous — pas de double grille selon le camp
- Le respect du droit international et des résolutions de l'ONU comme référence factuelle
- L'équité sociale, les droits des travailleurs et la démocratie sociale comme grille d'analyse
- Reconnaître les biais, y compris les nôtres — signaler quand l'analyse dépasse les faits

## Règles
- 3-6 sujets actifs (pas de remplissage)
- TL;DR : 2-3 bullets directs, formulés comme des faits — pas de titres ronflants
- contexte_historique : OBLIGATOIRE pour tout sujet avec dimension politique, sociale ou internationale. Citer des précédents réels (pays, années, résultats). Si aucun précédent pertinent, omettre le champ.
- implications : conséquences concrètes documentées, pas des spéculations
- Chronologie : 3-5 faits datés, du plus récent au plus ancien
- Couvertures : minimum 2 sources par sujet — signaler si un angle important est absent de la couverture médiatique
- "Ce qu'on ne sait pas encore" : 2-3 questions ouvertes honnêtes, pas rhétoriques
- Utilise UNIQUEMENT les URLs fournies dans les articles

### RÈGLE CRITIQUE SUR LES CITATIONS INLINE
Quand tu cites une source entre parenthèses dans le texte (ex: "(RFI)" ou "(BFM TV, Libération)"),
cette source DOIT être présente dans le tableau "sources" associé au sujet avec son URL.
Ne cite JAMAIS un nom de source dans le texte sans l'inclure dans le tableau sources.

- Retourne UNIQUEMENT le JSON`;

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (m) return m[1].trim();
  const j = text.match(/\{[\s\S]*\}/);
  if (j) return j[0];
  return text;
}

function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  try {
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function main() {
  loadEnv();

  const config = resolveConfig();
  console.log(`[sujets-chauds] Using LLM: ${config.provider} / ${config.model}`);

  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`[sujets-chauds] Loaded ${articles.length} articles`);

  // Load previous sujets-chauds for continuity
  let previousSujets: any = null;
  try {
    previousSujets = JSON.parse(readFileSync(new URL('../src/data/sujets-chauds.json', import.meta.url), 'utf-8'));
  } catch { /* first run */ }

  // Load recent editions for context
  const archiveDir = new URL('../src/data/archives/', import.meta.url);
  const recentTopics: string[] = [];
  try {
    const files = readdirSync(archiveDir).filter(f => f.endsWith('.json') && !f.includes('soir')).sort().reverse().slice(0, 5);
    for (const f of files) {
      try {
        const ed = JSON.parse(readFileSync(new URL(f, archiveDir), 'utf-8'));
        if (ed.sujet_du_jour?.titre) recentTopics.push(`${ed.date}: ${ed.sujet_du_jour.titre}`);
        for (const e of [...(ed.france || []), ...(ed.monde || []), ...(ed.essentiels || [])]) {
          recentTopics.push(`${ed.date}: ${e.titre}`);
        }
      } catch { /* skip */ }
    }
  } catch { /* no archives */ }

  // Load ownership data
  let groupes: GroupeMedia[] = [];
  let feedsMeta: FeedMeta[] = [];
  try {
    groupes = JSON.parse(readFileSync(new URL('../src/data/groupes-medias.json', import.meta.url), 'utf-8'));
    feedsMeta = JSON.parse(readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8'));
  } catch { /* proceed without */ }

  const groupeById = new Map(groupes.map(g => [g.id, g]));
  const feedByName = new Map(feedsMeta.map(f => [f.nom, f]));

  // Load social/trending signals (from fetch-signals.ts)
  let signalsContext = '';
  try {
    const signalsPath = new URL('../src/data/.pipeline/signals.json', import.meta.url);
    const signals = JSON.parse(readFileSync(signalsPath, 'utf-8'));
    const parts: string[] = [];

    if (signals.hackernews?.length > 0) {
      const hnLines = signals.hackernews.slice(0, 15).map(
        (h: any) => `- [score:${h.score}, ${h.comments} comments] ${h.titre}${h.tags?.length ? ` (${h.tags.join(', ')})` : ''}`
      );
      parts.push(`### HackerNews (top stories)\n${hnLines.join('\n')}`);
    }

    if (signals.reddit?.length > 0) {
      const rdLines = signals.reddit.slice(0, 20).map(
        (r: any) => `- [r/${r.subreddit}] ${r.titre}`
      );
      parts.push(`### Reddit (hot posts)\n${rdLines.join('\n')}`);
    }

    if (signals.wikipedia_trending?.length > 0) {
      const wkLines = signals.wikipedia_trending.slice(0, 15).map(
        (w: any) => `- ${w.article} (${w.vues_hier.toLocaleString()} vues, ${w.variation})`
      );
      parts.push(`### Wikipedia FR trending\n${wkLines.join('\n')}`);
    }

    if (parts.length > 0) {
      signalsContext = `\n## Signaux de buzz (HackerNews, Reddit, Wikipedia)\nCes signaux indiquent les sujets dont les gens parlent en ligne. Utilise-les pour DÉTECTER les sujets chauds, mais construis le contenu à partir des SOURCES FIABLES (articles RSS) ci-dessous.\n\n${parts.join('\n\n')}`;
      console.log(`[sujets-chauds] Loaded signals: ${signals.hackernews?.length || 0} HN, ${signals.reddit?.length || 0} Reddit, ${signals.wikipedia_trending?.length || 0} Wiki`);
    }
  } catch {
    console.log('[sujets-chauds] No signals.json found (run fetch-signals.ts first for better detection)');
  }

  const today = new Date().toISOString().split('T')[0];

  // Build ownership context
  const sourcesUsed = [...new Set(articles.map(a => a.source))];
  const ownershipLines: string[] = [];
  for (const sourceName of sourcesUsed.slice(0, 30)) {
    const feed = feedByName.get(sourceName);
    if (!feed?.groupe) continue;
    const groupe = groupeById.get(feed.groupe);
    if (!groupe) continue;
    const owners = groupe.proprietaires.map(p => `${p.nom} [${p.type}]`).join(', ');
    ownershipLines.push(`- ${sourceName} : ${groupe.nom} (${owners}). Orientation : ${groupe.orientation}`);
  }

  const articleList = articles.slice(0, 100).map(a => ({
    titre: a.titre,
    source: a.source,
    url: a.url,
    type: a.type,
    rubrique: (a as any).rubrique || 'generaliste',
    date: a.date,
    desc: a.description.slice(0, 200),
  }));

  const previousContext = previousSujets?.sujets_actifs?.length > 0
    ? `\n## Sujets chauds précédents (à mettre à jour ou refroidir si nécessaire)\n${previousSujets.sujets_actifs.map((s: any) => `- ${s.titre} (${s.intensite}, depuis ${s.premiere_apparition})`).join('\n')}`
    : '';

  const userMessage = `Date : ${today}
${previousContext}
${signalsContext}

## Sujets traités cette semaine
${recentTopics.slice(0, 30).join('\n')}

## Contexte de propriété des médias
${ownershipLines.join('\n') || 'Aucune donnée disponible'}

## Articles disponibles (${articles.length} total)
${JSON.stringify(articleList, null, 1)}

Identifie les 2-4 sujets les plus chauds du moment et génère le contenu. Utilise les signaux de buzz (HackerNews, Reddit, Wikipedia) pour détecter les sujets tendance, mais base toujours le contenu sur les articles RSS fiables.`;

  console.log('\n[sujets-chauds] Generating...');
  const response = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 8000);

  let data: any;
  try {
    data = JSON.parse(extractJson(response));
  } catch {
    console.error('✗ LLM returned invalid JSON');
    console.error('Raw (first 500):', response.slice(0, 500));
    process.exit(1);
  }

  // Enrich with ownership data
  const enrichSource = (sourceName: string) => {
    const feed = feedByName.get(sourceName);
    const groupe = feed?.groupe ? groupeById.get(feed.groupe) : null;
    if (!groupe) return null;
    return {
      nom: groupe.nom,
      proprietaire: groupe.proprietaires.map(p => p.nom).join(', '),
      type_proprietaire: groupe.proprietaires[0]?.type || 'independant',
      orientation: groupe.orientation,
    };
  };

  // ── Sanity check & enrichment ──────────────────────────────────────────────
  const articleUrlSet = new Set(articles.map((a: RawArticle) => a.url));
  const articlesByTitle = new Map(articles.map((a: RawArticle) => [a.titre.toLowerCase().slice(0, 40), a]));

  for (const sujet of data.sujets_actifs || []) {
    if (!sujet.slug) sujet.slug = slugify(sujet.titre);

    // ── Couvertures : fix missing URLs, remove unfixable ones ──
    const fixedCouvertures: any[] = [];
    for (const c of sujet.couvertures || []) {
      c.groupe_media = enrichSource(c.source);

      // If URL missing or not in RSS corpus, try to find a match by source name
      if (!c.url || !articleUrlSet.has(c.url)) {
        const fallback = articles.find((a: RawArticle) => a.source === c.source);
        if (fallback) {
          c.url = fallback.url;
          console.warn(`  ⚠ [${sujet.titre.slice(0, 30)}] URL fixée pour ${c.source} → ${fallback.url.slice(0, 60)}`);
        } else {
          console.warn(`  ✗ [${sujet.titre.slice(0, 30)}] Couverture supprimée (URL invalide, source inconnue): ${c.source}`);
          continue; // drop this coverage entry
        }
      }
      fixedCouvertures.push(c);
    }
    sujet.couvertures = fixedCouvertures;

    // ── Coverage diversity check ──────────────────────────────────────────
    // If a topic has only 1-2 sources covering it but 10+ articles exist, add more
    const articlesForTopic = articles.filter((a: RawArticle) => {
      const titleWords = sujet.titre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter((w: string) => w.length > 4);
      const articleTitle = a.titre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const matches = titleWords.filter((w: string) => articleTitle.includes(w)).length;
      return matches >= 2;
    });

    if (articlesForTopic.length >= 5 && sujet.couvertures.length < 3) {
      // Add extra sources from articles not yet in couvertures
      const existingSources = new Set(sujet.couvertures.map((c: any) => c.source));
      const extras = articlesForTopic
        .filter((a: RawArticle) => !existingSources.has(a.source))
        .slice(0, 3 - sujet.couvertures.length);

      for (const extra of extras) {
        sujet.couvertures.push({
          source: extra.source,
          type: (feedByName.get(extra.source) as any)?.type || 'mainstream',
          angle: extra.titre,
          ton: 'factuel',
          url: extra.url,
          citation_cle: extra.description?.slice(0, 120) || null,
          groupe_media: enrichSource(extra.source),
        });
        console.warn(`  + [${sujet.titre.slice(0, 30)}] Couverture ajoutée: ${extra.source}`);
      }
    }

    // ── Sources : fix missing URLs ──────────────────────────────────────────
    for (const s of sujet.sources || []) {
      s.groupe_media = enrichSource(s.nom);
      if (!s.url || !articleUrlSet.has(s.url)) {
        const fallback = articles.find((a: RawArticle) => a.source === s.nom);
        if (fallback) s.url = fallback.url;
      }
    }
    // Drop sources with no valid URL
    sujet.sources = (sujet.sources || []).filter((s: any) => s.url && s.url.startsWith('http'));
  }

  // Build final output
  const sujetsData = {
    date: today,
    genere_a: new Date().toISOString(),
    sujets_actifs: data.sujets_actifs || [],
    sujets_refroidis: data.sujets_refroidis || [],
    meta: {
      nb_articles_analyses: articles.length,
      modele: `${config.provider}/${config.model}`,
      version_pipeline: PIPELINE_VERSION,
    },
  };

  // Validate
  const validation = SujetsChaudsSchema.safeParse(sujetsData);
  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // Validate URLs against RSS feed
  console.log('\n[sujets-chauds] Validating URLs...');
  const urlResult = await validateSujetsChaudsUrls(sujetsData, articles);
  console.log(`  URLs: ${urlResult.total} total, ${urlResult.valid_rss} RSS, ${urlResult.valid_http} HTTP, ${urlResult.removed} removed`);
  if (urlResult.details.length > 0) {
    for (const d of urlResult.details) console.log(`    ✗ ${d}`);
  }

  // Write
  const outPath = new URL('../src/data/sujets-chauds.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(sujetsData, null, 2), 'utf-8');

  console.log(`\n✓ Wrote sujets-chauds.json for ${today}`);
  console.log(`  ${sujetsData.sujets_actifs.length} sujets actifs`);
  for (const s of sujetsData.sujets_actifs) {
    console.log(`    - ${s.titre} (${s.intensite})`);
  }
  console.log(`  ${sujetsData.sujets_refroidis.length} sujets refroidis`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline generate-sujets-chauds failed:', err);
  process.exit(1);
});
