/**
 * generate-soir.ts — Generate evening edition via LLM API
 *
 * Deeper analysis, expanded regard croisé, daily review.
 * Designed to complement the morning une.json.
 *
 * Usage: npx tsx scripts/generate-soir.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { SoirSchema } from './schemas/soir.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import { validateEditionUrls } from './validate-urls.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '3.0.0';

interface GroupeMedia {
  id: string;
  nom: string;
  proprietaires: { nom: string; type: string; fortune_source: string }[];
  orientation: string;
  axes: Record<string, number>;
  medias: string[];
}

interface FeedMeta {
  nom: string;
  groupe: string | null;
  orientation: string | null;
  ligne_editoriale: string | null;
  rubrique: string | null;
}

const SOIR_SYSTEM = `Tu es le rédacteur en chef de l'édition du soir de Citoyens.ai.

## Mission
L'édition du soir complète l'édition du matin. Elle offre :
1. Un bilan de la journée (qu'est-ce qui a changé depuis ce matin ?)
2. Une analyse approfondie d'un sujet majeur (contexte long, enjeux, perspectives multiples)
3. 1-3 regards croisés approfondis avec détection de doubles standards

## Principes éditoriaux

### Universalité des principes
Mêmes standards moraux pour TOUTES les situations. Pas de double standard.

### Non-partisanerie absolue
Aucun camp défendu. Seules les incohérences sont critiquées.

### Détection des doubles standards
Pour chaque regard croisé :
- Identifier si les médias appliquent des standards différents à des situations similaires
- Citer QUEL média a dit QUOI (avec URL)
- Tester : "Si on remplaçait l'acteur, ce média tiendrait-il le même discours ?"

### Transparence sur la propriété des médias
Mentionner le propriétaire/groupe quand c'est pertinent pour comprendre un biais.

## Format de sortie

Retourne un JSON conforme à cette structure. UNIQUEMENT le JSON.

{
  "bilan_journee": {
    "resume": "string (3-5 phrases : ce qui s'est passé aujourd'hui)",
    "faits_marquants": ["string (fait 1)", "string (fait 2)", ...],
    "ce_qui_a_change": "string (qu'est-ce qui est nouveau depuis ce matin ?)"
  },

  "analyse_approfondie": {
    "sujet": "string (titre du sujet analysé en profondeur)",
    "rubrique": "politique|economie|tech|science|societe|culture|international",
    "contexte_long": "string (3-5 paragraphes de contexte, historique, enjeux)",
    "enjeux": ["string (enjeu 1)", "string (enjeu 2)", ...],
    "perspectives": [
      {
        "acteur": "string (qui parle/agit)",
        "position": "string (sa position sur le sujet)",
        "source": { "nom": "string", "url": "string", "type": "string" }
      }
    ],
    "notre_analyse": "string (2-3 paragraphes : synthèse non-partisane, mise en perspective)",
    "sources": [{ "nom": "string", "url": "string", "type": "string" }]
  },

  "regards_croises": [
    {
      "sujet": "string",
      "rubrique": "politique|economie|tech|science|societe|culture|international",
      "contexte": "string (faits objectifs)",
      "couvertures": [
        {
          "source": "string",
          "type": "investigation|mainstream|fact-check|etranger|institutionnel",
          "angle": "string",
          "ton": "critique|factuel|alarmiste|complaisant|neutre|engage",
          "url": "string",
          "citation_cle": "string",
          "auteur": "string|null"
        }
      ],
      "analyse_coherence": "string (200-300 mots)",
      "doubles_standards": ["string (si détectés)"],
      "biais_detectes": ["string"],
      "ce_quil_faut_retenir": "string"
    }
  ]
}

## Règles

### RÈGLE ABSOLUE SUR LES URLs
Tu ne dois utiliser QUE les URLs fournies dans la liste d'articles.
N'INVENTE JAMAIS une URL. Chaque "url" dans ta sortie JSON DOIT correspondre
EXACTEMENT à une URL présente dans les articles fournis (champ "url" de chaque article).
Si tu ne trouves pas d'URL exacte pour une source, OMETS le champ "url" plutôt que d'en inventer une.

### bilan_journee
- Résume l'essentiel de la journée en 3-5 phrases
- Liste 3-6 faits marquants (pas de doublons avec l'analyse)
- "ce_qui_a_change" = ce qui est nouveau depuis l'édition du matin

### analyse_approfondie
- Le sujet le plus important ou le plus complexe de la journée
- Contexte LONG (historique, enjeux structurels)
- Minimum 3 perspectives d'acteurs différents
- "notre_analyse" = mise en perspective non-partisane, 2-3 paragraphes

### regards_croises (1-3)
- Chaque regard croisé compare 3+ sources sur un même sujet
- Analyse de cohérence DÉTAILLÉE (200-300 mots)
- Doubles standards = cas concrets où un média a des standards différents`;

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
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

async function main() {
  loadEnv();

  const config = resolveConfig();
  console.log(`[soir] Using LLM: ${config.provider} / ${config.model}`);

  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`[soir] Loaded ${articles.length} articles`);

  // Load morning edition for context
  let morningEdition: any = null;
  try {
    morningEdition = JSON.parse(readFileSync(new URL('../src/data/une.json', import.meta.url), 'utf-8'));
    console.log(`[soir] Loaded morning edition: ${morningEdition.sujet_du_jour?.titre || 'N/A'}`);
  } catch {
    console.warn('⚠ Could not load morning edition');
  }

  let groupes: GroupeMedia[] = [];
  let feedsMeta: FeedMeta[] = [];
  try {
    groupes = JSON.parse(readFileSync(new URL('../src/data/groupes-medias.json', import.meta.url), 'utf-8'));
    feedsMeta = JSON.parse(readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8'));
  } catch { /* proceed without */ }

  const groupeById = new Map(groupes.map(g => [g.id, g]));
  const feedByName = new Map(feedsMeta.map(f => [f.nom, f]));

  const today = new Date().toISOString().split('T')[0];
  const frenchSources = articles.filter(a => a.type !== 'etranger').length;
  const foreignSources = articles.filter(a => a.type === 'etranger').length;

  // Build ownership context
  const sourcesUsed = [...new Set(articles.map(a => a.source))];
  const ownershipLines: string[] = [];
  for (const sourceName of sourcesUsed) {
    const feed = feedByName.get(sourceName);
    if (!feed?.groupe) continue;
    const groupe = groupeById.get(feed.groupe);
    if (!groupe) continue;
    const owners = groupe.proprietaires.map(p => `${p.nom} [${p.type}]`).join(', ');
    ownershipLines.push(`- ${sourceName} : ${groupe.nom} (${owners}). Orientation : ${groupe.orientation}`);
  }

  const morningContext = morningEdition ? `
## Édition du matin (déjà publié)
Sujet du jour : ${morningEdition.sujet_du_jour?.titre || 'N/A'}
Essentiels couverts : ${(morningEdition.essentiels || []).map((e: any) => `${e.rubrique}: ${e.titre}`).join(' | ')}
Regard croisé : ${morningEdition.regard_croise?.sujet || 'N/A'}

L'édition du soir doit COMPLÉTER (pas répéter) l'édition du matin. Choisis un sujet DIFFÉRENT pour l'analyse approfondie.` : '';

  const articleList = articles.map(a => ({
    id: a.id,
    titre: a.titre,
    source: a.source,
    url: a.url,
    type: a.type,
    rubrique: (a as any).rubrique || 'generaliste',
    pays: a.pays,
    date: a.date,
    desc: a.description.slice(0, 300),
    auteur: a.auteur || null,
  }));

  const userMessage = `Date du jour : ${today}
${morningContext}

## Contexte de propriété des médias
${ownershipLines.join('\n')}

## Articles disponibles (${articles.length})

${JSON.stringify(articleList, null, 1)}

## Instructions
Génère l'édition du soir : bilan de la journée, 1 analyse approfondie (sujet DIFFÉRENT de l'édition du matin), et 1-3 regards croisés approfondis.`;

  console.log('\n[soir] Generating evening edition...');
  const response = await callLLMWithRetry(config, SOIR_SYSTEM, userMessage, 10000);

  let soirData: any;
  try {
    soirData = JSON.parse(extractJson(response));
  } catch {
    console.error('✗ LLM returned invalid JSON');
    console.error('Raw (first 500):', response.slice(0, 500));
    process.exit(1);
  }

  // Enrich with ownership data
  if (groupes.length > 0) {
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

    for (const rc of soirData.regards_croises || []) {
      for (const c of rc.couvertures || []) {
        c.groupe_media = enrichSource(c.source);
      }
    }

    if (soirData.analyse_approfondie) {
      for (const p of soirData.analyse_approfondie.perspectives || []) {
        if (p.source) p.source.groupe_media = enrichSource(p.source.nom);
      }
      for (const s of soirData.analyse_approfondie.sources || []) {
        s.groupe_media = enrichSource(s.nom);
      }
    }
  }

  // Validate URLs: must exist in RSS feed or respond 200
  const urlCheck = await validateEditionUrls(soirData, articles);
  console.log(`✓ URL validation: ${urlCheck.valid_rss} in RSS, ${urlCheck.valid_http} verified HTTP, ${urlCheck.removed} removed (${urlCheck.total} total)`);
  for (const d of urlCheck.details) console.warn(`  ⚠ hallucinated: ${d}`);

  // Add metadata
  soirData.date = today;
  soirData.genere_a = new Date().toISOString();
  soirData.edition = 'soir';
  soirData.meta = {
    nb_articles_analyses: articles.length,
    sources_francaises: frenchSources,
    sources_etrangeres: foreignSources,
    rubriques_couvertes: [...new Set(
      [soirData.analyse_approfondie?.rubrique, ...(soirData.regards_croises || []).map((r: any) => r.rubrique)].filter(Boolean)
    )],
    modele: `${config.provider}/${config.model}`,
    version_pipeline: PIPELINE_VERSION,
  };

  // Validate
  const validation = SoirSchema.safeParse(soirData);
  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // Write output
  const soirPath = new URL('../src/data/soir.json', import.meta.url);
  writeFileSync(soirPath, JSON.stringify(soirData, null, 2), 'utf-8');

  // Archive
  const archiveDir = new URL('../src/data/archives/', import.meta.url);
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(new URL(`${today}-soir.json`, archiveDir), JSON.stringify(soirData, null, 2), 'utf-8');

  console.log(`\n✓ Wrote soir.json for ${today}`);
  console.log(`  Bilan : ${soirData.bilan_journee?.faits_marquants?.length || 0} faits marquants`);
  console.log(`  Analyse : ${soirData.analyse_approfondie?.sujet || 'N/A'}`);
  console.log(`  Regards croisés : ${soirData.regards_croises?.length || 0}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Pipeline generate-soir failed:', err);
  process.exit(1);
});
