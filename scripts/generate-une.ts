/**
 * generate-une.ts — Curate daily edition via LLM API
 *
 * Two-pass approach:
 *   Pass 1: Select articles across all rubriques (fast, cheap)
 *   Pass 2: Write editorial content in Smart Brevity format (detailed)
 *
 * Supports: Anthropic (Claude), OpenAI, Gemini, OpenRouter
 *
 * Usage: npx tsx scripts/generate-une.ts
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { UneSchema } from './schemas/une.schema.js';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';
import { validateEditionUrls } from './validate-urls.js';
import type { RawArticle } from './fetch-news.js';

const PIPELINE_VERSION = '3.0.0';

// ---------- Media ownership types ----------

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

// ---------- System prompts ----------

const PASS1_SYSTEM = `Tu es le rédacteur en chef de Citoyens.ai, un quotidien généraliste en 5 minutes.

À partir de la liste d'articles RSS fournie (couvrant politique, économie, tech, science, société, culture, international), sélectionne les contenus pour l'édition du jour.

Retourne un JSON avec cette structure exacte :
{
  "sujet_du_jour": {
    "titre": "Titre court et percutant",
    "rubrique": "politique|economie|tech|science|societe|culture|international",
    "ids": ["id1", "id2"],
    "pourquoi": "1 phrase : pourquoi c'est le sujet #1 aujourd'hui"
  },
  "essentiels": [
    { "rubrique": "politique", "id": "idX", "titre_suggestion": "..." },
    { "rubrique": "economie", "id": "idY", "titre_suggestion": "..." },
    { "rubrique": "tech", "id": "idZ", "titre_suggestion": "..." },
    { "rubrique": "science", "id": "idA", "titre_suggestion": "..." },
    { "rubrique": "societe", "id": "idB", "titre_suggestion": "..." },
    { "rubrique": "international", "id": "idC", "titre_suggestion": "..." }
  ],
  "regard_croise": {
    "sujet": "Le sujet couvert par 3+ sources avec des angles différents",
    "rubrique": "politique|economie|tech|science|societe|culture|international",
    "ids": ["id1", "id3", "id5"]
  },
  "chiffre_suggestion": "Un chiffre clé lié à l'actualité du jour avec source"
}

Critères de sélection :
- Le sujet du jour = le fait le PLUS impactant, tous domaines confondus
- Les essentiels = 1 item par rubrique (couvrir au moins 5 rubriques différentes)
- Si aucun article n'existe pour une rubrique, ne l'inclus pas
- Le regard croisé = un sujet couvert par 3+ sources avec des angles DIFFÉRENTS
- Retourne UNIQUEMENT le JSON, pas de texte autour`;

const PASS2_SYSTEM = `Tu es le rédacteur en chef de Citoyens.ai, un quotidien généraliste honnête en 5 minutes.

## Mission
Informer en 5 minutes, honnêtement, sans agenda. Politique, économie, tech, science, société, international.

## Principes éditoriaux

### 1. Universalité des principes
Tu appliques les mêmes standards moraux et analytiques à TOUTES les situations :
- Si le colonialisme est condamné dans un contexte, il doit l'être dans TOUS les contextes
- Si une agression territoriale est illégitime quelque part, elle l'est partout
- Les droits humains sont universels — pas à géométrie variable

### 2. Non-partisanerie absolue
Tu ne défends AUCUN camp. Tu critiques uniquement les INCOHÉRENCES :
- Le ton est factuel et analytique, jamais idéologique
- Un média de gauche qui applique un double standard est critiqué comme un de droite

### 3. Détection des doubles standards
Pour le regard croisé, tu DOIS :
- Identifier si les médias appliquent des standards différents à des situations similaires
- Citer QUEL média a dit QUOI (avec URL)
- Tester : "Si on remplaçait l'acteur, ce média tiendrait-il le même discours ?"

### 4. Transparence sur la propriété des médias
Tu disposes du contexte de propriété (fourni dans le message utilisateur). Tu DOIS :
- Mentionner le propriétaire/groupe quand c'est pertinent pour comprendre un biais
- Signaler quand un média détenu par un milliardaire couvre/évite un sujet touchant aux intérêts de son propriétaire

## Format de sortie — Smart Brevity

Tu retournes un JSON conforme à cette structure. UNIQUEMENT le JSON.

{
  "sujet_du_jour": {
    "titre": "string (titre court, percutant, max 80 caractères)",
    "rubrique": "politique|economie|tech|science|societe|culture|international",
    "pourquoi_important": "string (1 phrase : pourquoi ça compte aujourd'hui)",
    "faits": ["string (bullet point factuel)", "string", "string"],
    "contexte": "string (1 paragraphe de contexte, 3-4 phrases max)",
    "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }],
    "lien": "string|null"
  },

  "essentiels": [
    {
      "titre": "string (titre court)",
      "rubrique": "politique|economie|tech|science|societe|culture|international",
      "resume": "string (2 phrases max, factuel)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "string" }],
      "lien": "string|null"
    }
  ],

  "regard_croise": {
    "sujet": "string",
    "rubrique": "politique|economie|tech|science|societe|culture|international",
    "contexte": "string (faits objectifs, 2-3 phrases)",
    "couvertures": [
      {
        "source": "string",
        "type": "investigation|mainstream|fact-check|etranger|institutionnel",
        "angle": "string (l'angle de cette source, 1 phrase)",
        "ton": "critique|factuel|alarmiste|complaisant|neutre|engage",
        "url": "string (URL valide)",
        "citation_cle": "string (1 phrase clé)",
        "auteur": "string|null",
        "proprietaire_contexte": "string|null",
        "orientation_source": "string|null"
      }
    ],
    "analyse_coherence": "string (150-250 mots — doubles standards, incohérences)",
    "biais_detectes": ["string"],
    "ce_quil_faut_retenir": "string (synthèse non-partisane, outille le lecteur)"
  },

  "chiffre_du_jour": {
    "valeur": "string",
    "contexte": "string",
    "source": "string",
    "source_url": "string (URL valide)"
  },

  "a_surveiller": [
    {
      "date": "string (ISO date)",
      "evenement": "string",
      "type": "vote|audition|commission|manifestation|echeance|tech_launch|publication|echeance_economique|conference|autre",
      "lien": "string|null"
    }
  ]
}

## Règles de rédaction

### RÈGLE ABSOLUE SUR LES URLs
Tu ne dois utiliser QUE les URLs fournies dans la liste d'articles ci-dessous.
N'INVENTE JAMAIS une URL. Si tu ne trouves pas l'URL exacte d'un article, utilise l'URL fournie dans la liste pour cet article (champ "URL").
Chaque "url" dans ta sortie JSON DOIT correspondre exactement à une URL présente dans les articles fournis.

### sujet_du_jour
- Le fait #1 du jour, tous domaines confondus
- "pourquoi_important" = 1 phrase percutante
- "faits" = 3-4 bullet points factuels (pas d'opinion)
- "contexte" = 3-4 phrases de mise en perspective
- Sources : utiliser les URLs EXACTES des articles fournis

### essentiels (5-7 items)
- 1 par rubrique, couvrir au moins 5 rubriques différentes
- Résumé = 2 phrases max, factuel, jamais d'opinion
- Le sujet du jour NE doit PAS être répété dans les essentiels

### regard_croise — SECTION DISTINCTIVE
- Minimum 3 couvertures de sources différentes
- L'analyse doit être SUBSTANTIELLE (150-250 mots)
- Appliquer le test d'universalité des principes
- "ce_quil_faut_retenir" = synthèse qui aide le lecteur à se forger SA propre opinion

### chiffre_du_jour
- Chiffre lié à l'actualité du jour, source vérifiable

### a_surveiller (0-4 items)
- Événements des prochains jours, tous domaines`;

// ---------- Helpers ----------

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

// ---------- Main ----------

async function main() {
  loadEnv();

  const config = resolveConfig();
  console.log(`Using LLM: ${config.provider} / ${config.model}`);

  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  console.log(`Loaded ${articles.length} articles for curation`);

  // Rubrique breakdown
  const byRubrique: Record<string, number> = {};
  for (const a of articles) {
    const r = (a as any).rubrique || 'generaliste';
    byRubrique[r] = (byRubrique[r] || 0) + 1;
  }
  console.log(`  Rubriques: ${Object.entries(byRubrique).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // Load media ownership data
  let groupes: GroupeMedia[] = [];
  let feedsMeta: FeedMeta[] = [];
  try {
    groupes = JSON.parse(readFileSync(new URL('../src/data/groupes-medias.json', import.meta.url), 'utf-8'));
    feedsMeta = JSON.parse(readFileSync(new URL('../src/data/feeds.json', import.meta.url), 'utf-8'));
    console.log(`Loaded ${groupes.length} media groups, ${feedsMeta.length} feed metadata entries`);
  } catch {
    console.warn('⚠ Could not load media ownership data — proceeding without');
  }

  const groupeById = new Map(groupes.map(g => [g.id, g]));
  const feedByName = new Map(feedsMeta.map(f => [f.nom, f]));

  const today = new Date().toISOString().split('T')[0];
  const frenchSources = articles.filter(a => a.type !== 'etranger').length;
  const foreignSources = articles.filter(a => a.type === 'etranger').length;

  // ===== PASS 1: Selection =====
  console.log('\n[Pass 1] Selecting articles across rubriques...');

  const articleList = articles.map(a => ({
    id: a.id,
    titre: a.titre,
    source: a.source,
    type: a.type,
    rubrique: (a as any).rubrique || 'generaliste',
    pays: a.pays,
    date: a.date,
    desc: a.description.slice(0, 200),
  }));

  const pass1Response = await callLLMWithRetry(
    config,
    PASS1_SYSTEM,
    `Date du jour : ${today}\n\nArticles disponibles (${articles.length}) :\n\n${JSON.stringify(articleList, null, 1)}`,
    2000
  );

  let selection: any;
  try {
    selection = JSON.parse(extractJson(pass1Response));
  } catch {
    console.error('✗ Pass 1 returned invalid JSON, using fallback selection');
    selection = {
      sujet_du_jour: {
        titre: articles[0]?.titre || "L'actualité du jour",
        rubrique: 'politique',
        ids: articles.slice(0, 2).map(a => a.id),
        pourquoi: "Sujet principal de la journée",
      },
      essentiels: ['politique', 'economie', 'tech', 'societe', 'international'].map(r => {
        const match = articles.find(a => (a as any).rubrique === r);
        return match ? { rubrique: r, id: match.id, titre_suggestion: match.titre } : null;
      }).filter(Boolean),
      regard_croise: {
        sujet: articles[0]?.titre || 'Actualité',
        rubrique: 'politique',
        ids: articles.slice(0, 3).map(a => a.id),
      },
    };
  }

  const sujetIds = selection.sujet_du_jour?.ids || [];
  const essentielIds = (selection.essentiels || []).map((e: any) => e.id).filter(Boolean);
  const rcIds = selection.regard_croise?.ids || [];

  console.log(`  Sujet du jour: ${selection.sujet_du_jour?.titre || '?'}`);
  console.log(`  Essentiels: ${essentielIds.length} items`);
  console.log(`  Regard croisé: ${rcIds.length} sources`);

  // ===== PASS 2: Editorial + Analysis =====
  console.log('\n[Pass 2] Generating editorial content...');

  const allSelectedIds = new Set([...sujetIds, ...essentielIds, ...rcIds]);
  const selectedArticles = articles.filter(a => allSelectedIds.has(a.id));

  if (selectedArticles.length < 5) {
    for (const a of articles) {
      if (selectedArticles.length >= 15) break;
      if (!allSelectedIds.has(a.id)) selectedArticles.push(a);
    }
  }

  // Build ownership context
  const sourcesInSelection = [...new Set(selectedArticles.map(a => a.source))];
  const ownershipLines: string[] = [];
  for (const sourceName of sourcesInSelection) {
    const feed = feedByName.get(sourceName);
    if (!feed?.groupe) {
      ownershipLines.push(`- ${sourceName} : Pas d'information de propriété disponible`);
      continue;
    }
    const groupe = groupeById.get(feed.groupe);
    if (!groupe) {
      ownershipLines.push(`- ${sourceName} : Groupe inconnu (${feed.groupe}). Orientation : ${feed.orientation || '?'}`);
      continue;
    }
    const owners = groupe.proprietaires.map(p => `${p.nom} [${p.type}]`).join(', ');
    const axes = Object.entries(groupe.axes).map(([k, v]) => `${k}=${v}/5`).join(', ');
    ownershipLines.push(`- ${sourceName} : ${groupe.nom} (${owners}). Orientation : ${groupe.orientation}. Axes : ${axes}`);
    if (feed.ligne_editoriale) {
      ownershipLines.push(`  Ligne éditoriale : ${feed.ligne_editoriale}`);
    }
  }

  const pass2UserMessage = `Date du jour : ${today}

## Sélection de la Passe 1
Sujet du jour : "${selection.sujet_du_jour?.titre || ''}" (${selection.sujet_du_jour?.rubrique || ''})
Pourquoi : ${selection.sujet_du_jour?.pourquoi || ''}
Rubriques essentiels : ${(selection.essentiels || []).map((e: any) => e.rubrique).join(', ')}
Regard croisé : "${selection.regard_croise?.sujet || ''}"
Chiffre suggéré : ${selection.chiffre_suggestion || 'à déterminer'}

## Contexte de propriété des médias

Légende des axes (1 = position humaniste/universaliste, 5 = double standard ou complaisance) :
colonialisme, droit_international, liberte_expression, antifascisme, justice_sociale

${ownershipLines.join('\n')}

## Articles sélectionnés (${selectedArticles.length})

${selectedArticles.map(a => {
    const auteurStr = a.auteur ? `\nAuteur : ${a.auteur}` : '';
    const groupeStr = a.groupe ? ` [groupe: ${a.groupe}]` : '';
    const rubriqueStr = (a as any).rubrique ? ` [rubrique: ${(a as any).rubrique}]` : '';
    return `### [${a.id}] ${a.source} (${a.type}, ${a.pays})${groupeStr}${rubriqueStr}
Titre : ${a.titre}${auteurStr}
Date : ${a.date}
URL : ${a.url}
Description : ${a.description}
`;
  }).join('\n')}

## Instructions
Génère l'édition complète du jour au format Smart Brevity :
- 1 sujet du jour (le plus impactant) avec "pourquoi_important", "faits" (bullet points), "contexte"
- 5-7 essentiels (1 par rubrique, NE PAS répéter le sujet du jour)
- 1 regard croisé avec analyse de cohérence détaillée (UTILISE le contexte de propriété)
- 1 chiffre du jour
- 0-4 événements à surveiller
- Pour chaque couverture dans regard_croise, renseigne "auteur", "proprietaire_contexte" et "orientation_source"`;

  const pass2Response = await callLLMWithRetry(config, PASS2_SYSTEM, pass2UserMessage, 8000);

  let uneData: any;
  try {
    uneData = JSON.parse(extractJson(pass2Response));
  } catch (err) {
    console.error('✗ Pass 2 returned invalid JSON');
    console.error('Raw response (first 500 chars):', pass2Response.slice(0, 500));
    process.exit(1);
  }

  // Post-LLM enrichment: merge factual ownership data
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

    if (uneData.regard_croise) {
      for (const c of uneData.regard_croise.couvertures || []) {
        c.groupe_media = enrichSource(c.source);
        const feed = feedByName.get(c.source);
        if (feed?.orientation && !c.orientation_source) {
          c.orientation_source = feed.orientation;
        }
      }
    }

    if (uneData.sujet_du_jour) {
      for (const s of uneData.sujet_du_jour.sources || []) {
        s.groupe_media = enrichSource(s.nom);
      }
    }

    for (const essentiel of uneData.essentiels || []) {
      for (const s of essentiel.sources || []) {
        s.groupe_media = enrichSource(s.nom);
      }
    }

    console.log('✓ Enriched output with factual media ownership data');
  }

  // Validate URLs: must exist in RSS feed or respond 200
  const urlCheck = await validateEditionUrls(uneData, articles);
  console.log(`✓ URL validation: ${urlCheck.valid_rss} in RSS, ${urlCheck.valid_http} verified HTTP, ${urlCheck.removed} removed (${urlCheck.total} total)`);
  for (const d of urlCheck.details) console.warn(`  ⚠ hallucinated: ${d}`);

  // Collect which rubriques are covered
  const rubriques = new Set<string>();
  if (uneData.sujet_du_jour?.rubrique) rubriques.add(uneData.sujet_du_jour.rubrique);
  for (const e of uneData.essentiels || []) {
    if (e.rubrique) rubriques.add(e.rubrique);
  }

  // Add metadata
  uneData.date = today;
  uneData.genere_a = new Date().toISOString();
  uneData.meta = {
    nb_articles_analyses: articles.length,
    sources_francaises: frenchSources,
    sources_etrangeres: foreignSources,
    rubriques_couvertes: [...rubriques],
    modele: `${config.provider}/${config.model}`,
    version_pipeline: PIPELINE_VERSION,
  };

  if (!uneData.a_surveiller) uneData.a_surveiller = [];

  // Validate with Zod
  const validation = UneSchema.safeParse(uneData);

  if (!validation.success) {
    console.warn('\n⚠ Zod validation warnings:');
    for (const issue of validation.error.issues) {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.log('  Attempting to write despite validation warnings...');
  }

  // Write output
  const unePath = new URL('../src/data/une.json', import.meta.url);
  writeFileSync(unePath, JSON.stringify(uneData, null, 2), 'utf-8');

  // Archive to pipeline dir
  const pipelineDir = new URL('../src/data/.pipeline/', import.meta.url);
  mkdirSync(pipelineDir, { recursive: true });
  const pipelineArchivePath = new URL(`une-${today}.json`, pipelineDir);
  copyFileSync(unePath, pipelineArchivePath);

  // Archive to public archives dir
  const archiveDir = new URL('../src/data/archives/', import.meta.url);
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = new URL(`${today}.json`, archiveDir);
  copyFileSync(unePath, archivePath);

  console.log(`\n✓ Wrote une.json for ${today}`);
  console.log(`  Sujet du jour : ${uneData.sujet_du_jour?.titre || 'N/A'} (${uneData.sujet_du_jour?.rubrique || '?'})`);
  console.log(`  ${uneData.essentiels?.length || 0} essentiels`);
  console.log(`  Regard croisé : ${uneData.regard_croise?.sujet || 'N/A'}`);
  console.log(`  Chiffre du jour : ${uneData.chiffre_du_jour?.valeur || 'N/A'}`);
  console.log(`  ${uneData.a_surveiller?.length || 0} événements à surveiller`);
  console.log(`  Rubriques : ${[...rubriques].join(', ')}`);
  console.log(`  Archived to archives/${today}.json`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Pipeline generate-une failed:', err);
  process.exit(1);
});
