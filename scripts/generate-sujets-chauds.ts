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

const SYSTEM_PROMPT = `Tu es le rédacteur en chef de Citoyens.ai, responsable de la section "Sujets chauds".

## Mission
Identifier les 2-4 sujets dont TOUT LE MONDE parle : polémiques, scandales, crises, événements majeurs.
Pour chaque sujet, donner les faits, la chronologie, et montrer comment les différents médias le couvrent.

## Critères de sélection d'un "sujet chaud"
- Couvert par 3+ sources avec des angles différents
- Forte intensité médiatique (beaucoup d'articles en peu de temps)
- Polémique, crise, scandale, événement majeur
- Le genre de sujet dont les gens parlent au bureau ou en famille
- Signaux de buzz : sujets tendance sur HackerNews, Reddit, Wikipedia (fournis séparément)

## Niveaux d'intensité
- "brulant" : le sujet domine l'actualité, couverture massive
- "intense" : sujet très suivi, couverture soutenue
- "en_montee" : sujet émergent, couverture croissante

## Format de sortie JSON

{
  "sujets_actifs": [
    {
      "titre": "string (titre court et clair)",
      "slug": "string (URL-friendly: lettres minuscules, chiffres, tirets)",
      "intensite": "brulant|intense|en_montee",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "resume": "string (3-4 phrases : quoi, qui, depuis quand)",
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
      "premiere_apparition": "YYYY-MM-DD"
    }
  ],
  "sujets_refroidis": [
    {
      "titre": "string",
      "slug": "string",
      "derniere_mise_a_jour": "YYYY-MM-DD",
      "statut": "string (1 phrase sur où en est le sujet)"
    }
  ]
}

## Règles
- 2-4 sujets actifs maximum (pas de remplissage)
- Chronologie : 3-5 faits datés, du plus récent au plus ancien
- Couvertures : minimum 2 sources par sujet, avec transparence propriétaire
- "Ce qu'on ne sait pas encore" : 2-3 questions ouvertes honnêtes
- Utilise UNIQUEMENT les URLs fournies dans les articles
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

  for (const sujet of data.sujets_actifs || []) {
    if (!sujet.slug) sujet.slug = slugify(sujet.titre);
    for (const c of sujet.couvertures || []) {
      c.groupe_media = enrichSource(c.source);
    }
    for (const s of sujet.sources || []) {
      s.groupe_media = enrichSource(s.nom);
    }
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
