/**
 * generate-une.ts — Curate daily edition via multi-step editorial pipeline
 *
 * Three-step approach (replaces the old 2-pass):
 *   Step 1: cluster-topics.ts (run separately) → topics.json
 *   Step 2: Editorial conference — LLM assigns topics to editorial slots (this file)
 *   Step 3: Content generation — LLM writes from ALL articles in each cluster (this file)
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
import type { TopicsData, Topic } from './cluster-topics.js';

const PIPELINE_VERSION = '4.0.0';

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

const CONFERENCE_SYSTEM = `Tu es le rédacteur en chef de Citoyens.ai lors de la conférence de rédaction du matin.

## Mission
À partir d'une liste de TOPICS (sujets pré-regroupés avec leur score d'importance), décide la ligne éditoriale du jour.

Chaque topic a un score composite (0-100) basé sur : nombre de sources, diversité des types de médias, fiabilité, fraîcheur, couverture mixte, présence d'investigation, alignement éditorial et pluralité.

Les topics ont aussi :
- **editorial_flags** : drapeaux éditoriaux (droit_international, justice_sociale, colonialisme, etc.) identifiant les sujets critiques
- **has_investigation** : présence de sources d'investigation
- **tag** : "signal_faible" ou "solo_investigation" pour les articles isolés d'investigation
- **orientations** : les orientations politiques des sources couvrant le sujet

## Décisions à prendre

1. **sujet_du_jour** : LE topic #1 du jour — impact maximum, couverture massive, conséquence pour le lecteur
2. **france** (3-5 topics) : actualités nationales — couvrir au moins 3 rubriques différentes, privilégier les topics multi-sources
3. **monde** (1-3 topics) : actualités internationales — privilégier les sujets où la France est actrice ou directement impactée
4. **regard_croise** : le topic avec la plus grande diversité de couverture (angles opposés entre médias)
5. **regard_etranger** : 1-2 topics où des médias ÉTRANGERS parlent de la France
6. **signal_faible** (0-2 topics) : articles d'investigation isolés ou signaux faibles des médias indépendants — sujets que la couverture mainstream ignore mais que nos sources d'investigation ont détectés. Chercher parmi les topics marqués tag="signal_faible" ou tag="solo_investigation"
7. **alerte_editoriale** (0-2 topics) : sujets touchant directement nos axes éditoriaux (droit international, justice sociale, colonialisme, etc.) — chercher parmi les topics avec editorial_flags non vides. Ces sujets méritent un traitement prioritaire même si leur score quantitatif est modeste

## Règles
- Un topic NE peut apparaître que dans UNE SEULE section (pas de duplication)
- Le sujet du jour ne doit PAS être répété dans france ou monde
- Privilégier les topics avec nb_sources >= 2 (croisement de sources)
- Pour le regard_croise, choisir le topic qui a le plus d'angles éditoriaux différents
- Pour regard_etranger, ne choisir que parmi les topics qui contiennent des sources de type "etranger"
- Pour signal_faible, privilégier les articles d'investigation qui n'ont pas fait l'objet d'une couverture mainstream
- Pour alerte_editoriale, choisir des sujets avec des enjeux forts sur nos valeurs (droit international, justice sociale, etc.)

## Format de sortie JSON

{
  "sujet_du_jour": "topic-XXX",
  "france": ["topic-XXX", "topic-XXX", "topic-XXX"],
  "monde": ["topic-XXX", "topic-XXX"],
  "regard_croise": "topic-XXX",
  "regard_etranger": ["topic-XXX", "topic-XXX"],
  "signal_faible": ["topic-XXX"],
  "alerte_editoriale": ["topic-XXX"],
  "chiffre_suggestion": "Un chiffre clé lié à l'actualité du jour avec source"
}

Retourne UNIQUEMENT le JSON.`;

const REDACTION_SYSTEM = `Tu es le rédacteur en chef de Citoyens.ai, un quotidien généraliste honnête en 5 minutes.

## Mission
Rédiger l'édition du jour à partir de topics pré-sélectionnés. Pour chaque topic, tu disposes de TOUS les articles de TOUTES les sources qui en parlent. Exploite cette richesse : cite plusieurs sources, croise les angles, signale les divergences.

## Principes éditoriaux

### 1. Universalité des principes
Tu appliques les mêmes standards moraux et analytiques à TOUTES les situations :
- Si le colonialisme est condamné dans un contexte, il doit l'être dans TOUS les contextes
- Si une agression territoriale est illégitime quelque part, elle l'est partout
- Les droits humains sont universels — pas à géométrie variable

### 2. Grille de lecture éditoriale
Citoyens.ai n'est pas neutre sur les valeurs. Notre grille d'analyse privilégie :
- Le respect du droit international et des résolutions de l'ONU
- Le financement et la défense des services publics
- L'équité sociale et la redistribution des richesses
- La souveraineté alimentaire et la transition écologique
- Les droits des travailleurs et la démocratie sociale

Les faits sont rapportés sans déformation, mais l'analyse critique est informée par ces valeurs. Quand un accord commercial menace l'agriculture paysanne, on le dit. Quand une intervention militaire viole le droit international, on le souligne. Quand un milliardaire rachète un média pour influencer le débat public, on le signale. Ce n'est pas du militantisme, c'est un choix éditorial assumé.

### 3. Multi-sources systématique
Pour CHAQUE sujet, tu DOIS :
- Citer 2-3 sources différentes minimum (puisqu'elles sont disponibles)
- Mentionner quand les sources divergent sur les faits ou l'interprétation
- Utiliser UNIQUEMENT les URLs fournies dans les articles de chaque topic

### 4. Détection des doubles standards
Pour le regard croisé, tu DOIS :
- Identifier si les médias appliquent des standards différents à des situations similaires
- Citer QUEL média a dit QUOI (avec URL)
- Tester : "Si on remplaçait l'acteur, ce média tiendrait-il le même discours ?"

### 5. Transparence sur la propriété des médias
Tu disposes du contexte de propriété (fourni dans le message utilisateur). Tu DOIS :
- Mentionner le propriétaire/groupe quand c'est pertinent pour comprendre un biais
- Signaler quand un média détenu par un milliardaire couvre/évite un sujet touchant aux intérêts de son propriétaire

## Format de sortie — Smart Brevity

Tu retournes un JSON conforme à cette structure. UNIQUEMENT le JSON.

{
  "sujet_du_jour": {
    "titre": "string (titre court, percutant, max 80 caractères)",
    "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
    "pourquoi_important": "string (1 phrase : pourquoi ça compte aujourd'hui)",
    "faits": ["string (bullet point factuel)", "string", "string"],
    "contexte": "string (1 paragraphe de contexte, 3-4 phrases max)",
    "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }],
    "lien": "string|null"
  },

  "france": [
    {
      "titre": "string (titre court)",
      "rubrique": "politique|economie|tech|science|societe|culture",
      "resume": "string (2-3 phrases, factuel, en croisant les sources disponibles)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "string" }],
      "lien": "string|null"
    }
  ],

  "monde": [
    {
      "titre": "string (titre court)",
      "pays": "string (pays concerné)",
      "resume": "string (2-3 phrases, factuel, en croisant les sources disponibles)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "string" }],
      "lien": "string|null"
    }
  ],

  "regard_croise": {
    "sujet": "string",
    "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
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

  "regard_etranger": [
    {
      "source": "string (nom du média étranger)",
      "pays": "string (pays du média)",
      "titre": "string (titre traduit en français)",
      "titre_original": "string (titre original si pas en français)",
      "angle": "string (1 phrase : comment ils voient la France)",
      "url": "string (URL valide)"
    }
  ],

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
  ],

  "signal_faible": [
    {
      "titre": "string (titre court)",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "resume": "string (2-3 phrases : pourquoi ce signal est important, quel média l'a détecté)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }],
      "pourquoi_signal": "string (1 phrase : pourquoi c'est un signal faible ignoré par le mainstream)"
    }
  ],

  "alerte_editoriale": [
    {
      "titre": "string (titre court)",
      "rubrique": "politique|economie|tech|science|societe|culture|international|ia",
      "resume": "string (2-3 phrases factuelles)",
      "axes_concernes": ["droit_international", "justice_sociale"],
      "analyse": "string (50-100 mots : pourquoi ce sujet mérite attention au regard de nos valeurs éditoriales)",
      "sources": [{ "nom": "string", "url": "string (URL valide)", "type": "investigation|mainstream|fact-check|institutionnel|etranger" }]
    }
  ]
}

## Règles de rédaction

### RÈGLE ABSOLUE SUR LES URLs
Tu ne dois utiliser QUE les URLs fournies dans les articles de chaque topic.
N'INVENTE JAMAIS une URL.

### RÈGLE CRITIQUE SUR LES CITATIONS INLINE
Quand tu cites une source entre parenthèses dans le texte (ex: "(RFI)" ou "(BFM TV, Libération)"),
cette source DOIT être présente dans le tableau "sources" associé à la section avec son URL.
Ne cite JAMAIS un nom de source dans le texte sans l'inclure dans le tableau sources.
Exemple : si tu écris "...provoquant des tensions (Le Monde, franceinfo).", alors "Le Monde" ET "franceinfo"
doivent apparaître dans le tableau "sources" avec leurs URLs respectives.

### sujet_du_jour
- Le fait #1 du jour — cite TOUTES les sources pertinentes du topic (2-4 sources)
- "pourquoi_important" = 1 phrase percutante
- "faits" = 3-4 bullet points factuels en synthétisant les différentes sources
- "contexte" = 3-4 phrases de mise en perspective

### france (3-5 items)
- Pour CHAQUE item, cite 2+ sources si elles sont disponibles dans le topic
- Résumé = 2-3 phrases, factuel, peut mentionner les divergences entre sources

### monde (1-3 items)
- Cite les sources disponibles (souvent FR + étrangères sur le même sujet)
- Résumé = 2-3 phrases avec pays identifié

### regard_etranger (2-3 items)
- Articles de presse ÉTRANGÈRE qui parlent de la France
- Pour chaque item : source, pays du média, titre traduit, angle sur la France

### regard_croise — SECTION DISTINCTIVE
- Minimum 3 couvertures de sources DIFFÉRENTES (tu as accès à toutes les sources du topic)
- L'analyse doit être SUBSTANTIELLE (150-250 mots)
- Appliquer le test d'universalité des principes
- "ce_quil_faut_retenir" = synthèse qui aide le lecteur à se forger SA propre opinion

### signal_faible (0-2 items) — SECTION INVESTIGATION
- Articles issus de médias d'investigation indépendants, non couverts par le mainstream
- Résumé = 2-3 phrases expliquant le signal et son importance
- "pourquoi_signal" = 1 phrase expliquant pourquoi le sujet est ignoré par la couverture classique

### alerte_editoriale (0-2 items) — SECTION VALEURS
- Sujets touchant directement nos axes éditoriaux : droit international, justice sociale, colonialisme, etc.
- Résumé factuel de 2-3 phrases
- "axes_concernes" = liste des axes éditoriaux touchés
- "analyse" = 50-100 mots d'analyse au regard de nos valeurs éditoriales (universalité des principes, droit international, équité sociale)

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

  // Load raw articles
  const rawPath = new URL('../src/data/.pipeline/raw-articles.json', import.meta.url);
  let articles: RawArticle[];
  try {
    articles = JSON.parse(readFileSync(rawPath, 'utf-8'));
  } catch {
    console.error('✗ raw-articles.json not found. Run fetch-news.ts first.');
    process.exit(1);
  }

  // Load topics (from cluster-topics.ts)
  const topicsPath = new URL('../src/data/.pipeline/topics.json', import.meta.url);
  let topicsData: TopicsData;
  try {
    topicsData = JSON.parse(readFileSync(topicsPath, 'utf-8'));
  } catch {
    console.error('✗ topics.json not found. Run cluster-topics.ts first.');
    process.exit(1);
  }

  const topics = topicsData.topics;
  console.log(`Loaded ${articles.length} articles, ${topics.length} topics`);

  const articlesById = new Map(articles.map(a => [a.id, a]));
  const topicsById = new Map(topics.map(t => [t.id, t]));

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

  // ===== STEP 2: Editorial Conference =====
  console.log('\n[Conférence] Assigning topics to editorial slots...');

  // Smart topic selection: top 40 by score + investigation + signal faible + flagged
  const topByScore = topics.slice(0, 40);
  const topIds = new Set(topByScore.map(t => t.id));

  const investigationExtras = topics
    .filter(t => t.has_investigation_source && !topIds.has(t.id))
    .slice(0, 5);
  for (const t of investigationExtras) topIds.add(t.id);

  const signalFaibleExtras = topics
    .filter(t => (t.tag === 'signal_faible' || t.tag === 'solo_investigation') && !topIds.has(t.id))
    .slice(0, 5);
  for (const t of signalFaibleExtras) topIds.add(t.id);

  const flaggedExtras = topics
    .filter(t => (t.editorial_flags?.length ?? 0) > 0 && !topIds.has(t.id))
    .slice(0, 5);
  for (const t of flaggedExtras) topIds.add(t.id);

  const selectedTopics = [...topByScore, ...investigationExtras, ...signalFaibleExtras, ...flaggedExtras].slice(0, 55);
  console.log(`  Selected ${selectedTopics.length} topics for conference (${topByScore.length} top + ${investigationExtras.length} investigation + ${signalFaibleExtras.length} signal_faible + ${flaggedExtras.length} flagged)`);

  const topicSummaries = selectedTopics.map(t => {
    const sampleTitles = t.article_ids.slice(0, 3).map(id => {
      const a = articlesById.get(id);
      return a ? a.titre : '?';
    });
    return {
      id: t.id,
      titre: t.titre,
      score: t.score.total,
      nb_sources: t.score.nb_sources,
      nb_articles: t.article_ids.length,
      types: t.types,
      rubriques: t.rubriques_detectees,
      pays: t.pays_concernes,
      sources: t.sources.slice(0, 6),
      exemples_titres: sampleTitles,
      // Editorial metadata
      editorial_flags: t.editorial_flags || [],
      has_investigation: t.has_investigation_source || false,
      orientations: t.orientations || [],
      tag: t.tag || null,
    };
  });

  const conferenceMessage = `Date : ${today}

## Topics disponibles (${topicSummaries.length}, triés par score d'importance)

${JSON.stringify(topicSummaries, null, 1)}

Décide la ligne éditoriale du jour. Choisis les topics pour chaque section.`;

  const conferenceResponse = await callLLMWithRetry(config, CONFERENCE_SYSTEM, conferenceMessage, 2000);

  let editorialPlan: any;
  try {
    editorialPlan = JSON.parse(extractJson(conferenceResponse));
  } catch {
    console.error('✗ Conference returned invalid JSON, using score-based fallback');
    const frTopics = topics.filter(t =>
      t.rubriques_detectees.some(r => ['politique', 'economie', 'tech', 'societe', 'culture', 'science'].includes(r))
      && t.types.some(ty => ty !== 'etranger')
    );
    const intlTopics = topics.filter(t =>
      t.rubriques_detectees.includes('international') || t.types.includes('etranger')
    );

    editorialPlan = {
      sujet_du_jour: topics[0]?.id,
      france: frTopics.slice(1, 5).map(t => t.id),
      monde: intlTopics.slice(0, 2).map(t => t.id),
      regard_croise: topics.find(t => t.score.nb_sources >= 3)?.id || topics[1]?.id,
      regard_etranger: topics.filter(t => t.types.includes('etranger')).slice(0, 2).map(t => t.id),
      signal_faible: topics.filter(t => t.tag === 'solo_investigation').slice(0, 1).map(t => t.id),
      alerte_editoriale: topics.filter(t => (t.editorial_flags?.length ?? 0) > 0).slice(0, 1).map(t => t.id),
    };
  }

  console.log(`  Sujet du jour: ${editorialPlan.sujet_du_jour}`);
  console.log(`  France: ${(editorialPlan.france || []).length} topics`);
  console.log(`  Monde: ${(editorialPlan.monde || []).length} topics`);
  console.log(`  Regard croisé: ${editorialPlan.regard_croise}`);
  console.log(`  Regard étranger: ${(editorialPlan.regard_etranger || []).length} topics`);
  console.log(`  Signal faible: ${(editorialPlan.signal_faible || []).length} topics`);
  console.log(`  Alerte éditoriale: ${(editorialPlan.alerte_editoriale || []).length} topics`);

  // ===== STEP 3: Content Generation =====
  console.log('\n[Rédaction] Generating editorial content from topic clusters...');

  // Collect all assigned topic IDs
  const assignedTopicIds = new Set<string>([
    editorialPlan.sujet_du_jour,
    ...(editorialPlan.france || []),
    ...(editorialPlan.monde || []),
    editorialPlan.regard_croise,
    ...(editorialPlan.regard_etranger || []),
    ...(editorialPlan.signal_faible || []),
    ...(editorialPlan.alerte_editoriale || []),
  ].filter(Boolean));

  // Build full article content for each assigned topic
  function formatTopicArticles(topicId: string): string {
    const topic = topicsById.get(topicId);
    if (!topic) return `[Topic ${topicId} not found]`;

    const arts = topic.article_ids
      .map(id => articlesById.get(id))
      .filter(Boolean) as RawArticle[];

    const flagsStr = (topic.editorial_flags || []).length > 0
      ? ` | Flags: ${topic.editorial_flags.join(', ')}`
      : '';
    const tagStr = topic.tag ? ` | Tag: ${topic.tag}` : '';
    const orientStr = (topic.orientations || []).length > 0
      ? `\nOrientations: ${topic.orientations.join(', ')}`
      : '';
    const investStr = topic.has_investigation_source ? ' | Investigation: oui' : '';

    return `### Topic: ${topic.titre} [${topicId}]
Score: ${topic.score.total}/100 | ${topic.score.nb_sources} sources | Types: ${topic.types.join(', ')}${flagsStr}${tagStr}${investStr}${orientStr}

${arts.map(a => {
      const auteurStr = a.auteur ? ` | Auteur: ${a.auteur}` : '';
      const groupeStr = a.groupe ? ` [groupe: ${a.groupe}]` : '';
      return `- [${a.source}] (${a.type}, ${a.pays})${groupeStr}${auteurStr}
  Titre: ${a.titre}
  URL: ${a.url}
  Description: ${a.description}`;
    }).join('\n')}`;
  }

  // Build ownership context for all sources in assigned topics
  const allAssignedArticleIds = new Set<string>();
  for (const tid of assignedTopicIds) {
    const topic = topicsById.get(tid);
    if (topic) {
      for (const aid of topic.article_ids) allAssignedArticleIds.add(aid);
    }
  }

  const sourcesInSelection = [...new Set(
    [...allAssignedArticleIds].map(id => articlesById.get(id)?.source).filter(Boolean) as string[]
  )];

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

  // Resolve topic titles for the plan summary
  const resolveTitle = (id: string) => topicsById.get(id)?.titre || id;

  const redactionMessage = `Date du jour : ${today}

## Plan éditorial (décidé en conférence de rédaction)

- Sujet du jour : "${resolveTitle(editorialPlan.sujet_du_jour)}"
- France : ${(editorialPlan.france || []).map((id: string) => `"${resolveTitle(id)}"`).join(', ')}
- Monde : ${(editorialPlan.monde || []).map((id: string) => `"${resolveTitle(id)}"`).join(', ')}
- Regard croisé : "${resolveTitle(editorialPlan.regard_croise)}"
- Regard étranger : ${(editorialPlan.regard_etranger || []).map((id: string) => `"${resolveTitle(id)}"`).join(', ')}
- Signal faible : ${(editorialPlan.signal_faible || []).map((id: string) => `"${resolveTitle(id)}"`).join(', ') || 'aucun'}
- Alerte éditoriale : ${(editorialPlan.alerte_editoriale || []).map((id: string) => `"${resolveTitle(id)}"`).join(', ') || 'aucune'}
- Chiffre suggéré : ${editorialPlan.chiffre_suggestion || 'à déterminer'}

## Contexte de propriété des médias

Légende des axes (1 = position humaniste/universaliste, 5 = double standard ou complaisance) :
colonialisme, droit_international, liberte_expression, antifascisme, justice_sociale

${ownershipLines.join('\n')}

## SUJET DU JOUR — Articles complets

${formatTopicArticles(editorialPlan.sujet_du_jour)}

## FRANCE — Articles complets par topic

${(editorialPlan.france || []).map((id: string) => formatTopicArticles(id)).join('\n\n')}

## MONDE — Articles complets par topic

${(editorialPlan.monde || []).map((id: string) => formatTopicArticles(id)).join('\n\n')}

## REGARD CROISÉ — Articles complets (TOUTES les sources)

${formatTopicArticles(editorialPlan.regard_croise)}

## REGARD ÉTRANGER — Articles complets

${(editorialPlan.regard_etranger || []).map((id: string) => formatTopicArticles(id)).join('\n\n')}

## SIGNAL FAIBLE — Articles d'investigation isolés

${(editorialPlan.signal_faible || []).map((id: string) => formatTopicArticles(id)).join('\n\n') || '(aucun signal faible sélectionné)'}

## ALERTE ÉDITORIALE — Sujets critiques

${(editorialPlan.alerte_editoriale || []).map((id: string) => formatTopicArticles(id)).join('\n\n') || '(aucune alerte éditoriale sélectionnée)'}

## Instructions
Rédige l'édition complète du jour au format Smart Brevity.
IMPORTANT : pour chaque sujet, cite TOUTES les sources disponibles (pas juste 1). Tu as accès à tous les articles de chaque topic — exploite cette richesse.
- 1 sujet du jour avec "pourquoi_important", "faits" (bullets), "contexte" — cite 2-4 sources
- 3-5 infos France — cite 2+ sources par item quand disponible
- 1-3 infos Monde avec pays — cite les sources FR + étrangères
- 2-3 items regard_etranger (presse étrangère sur la France)
- 1 regard croisé SUBSTANTIEL avec analyse de cohérence (150-250 mots, 3+ couvertures)
- 0-2 signal_faible : articles d'investigation isolés, avec "pourquoi_signal" expliquant pourquoi le mainstream l'ignore
- 0-2 alerte_editoriale : sujets critiques sur nos axes (droit international, justice sociale, etc.), avec "axes_concernes" et "analyse" (50-100 mots)
- 1 chiffre du jour
- 0-4 événements à surveiller
- Pour chaque couverture dans regard_croise, renseigne "auteur", "proprietaire_contexte" et "orientation_source"
- Si aucun topic signal_faible ou alerte_editoriale n'a été sélectionné, retourne des tableaux vides pour ces sections`;

  const totalArticles = [...allAssignedArticleIds].length;
  console.log(`  Sending ${totalArticles} articles across ${assignedTopicIds.size} topics to LLM...`);

  const redactionResponse = await callLLMWithRetry(config, REDACTION_SYSTEM, redactionMessage, 8000);

  let uneData: any;
  try {
    uneData = JSON.parse(extractJson(redactionResponse));
  } catch (err) {
    console.error('✗ Rédaction returned invalid JSON');
    console.error('Raw response (first 500 chars):', redactionResponse.slice(0, 500));
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

    for (const item of [...(uneData.france || []), ...(uneData.monde || [])]) {
      for (const s of item.sources || []) {
        s.groupe_media = enrichSource(s.nom);
      }
    }

    for (const item of uneData.regard_etranger || []) {
      item.groupe_media = enrichSource(item.source);
    }

    console.log('✓ Enriched output with factual media ownership data');
  }

  // Validate URLs
  const urlCheck = await validateEditionUrls(uneData, articles);
  console.log(`✓ URL validation: ${urlCheck.valid_rss} in RSS, ${urlCheck.valid_http} verified HTTP, ${urlCheck.removed} removed (${urlCheck.total} total)`);
  for (const d of urlCheck.details) console.warn(`  ⚠ hallucinated: ${d}`);

  // Collect which rubriques are covered
  const rubriques = new Set<string>();
  if (uneData.sujet_du_jour?.rubrique) rubriques.add(uneData.sujet_du_jour.rubrique);
  for (const e of uneData.france || []) {
    if (e.rubrique) rubriques.add(e.rubrique);
  }
  if ((uneData.monde || []).length > 0) rubriques.add('international');

  // Add metadata
  uneData.date = today;
  uneData.genere_a = new Date().toISOString();
  uneData.meta = {
    nb_articles_analyses: articles.length,
    nb_topics: topics.length,
    nb_topics_selectionnes: assignedTopicIds.size,
    nb_articles_dans_selection: totalArticles,
    sources_francaises: frenchSources,
    sources_etrangeres: foreignSources,
    rubriques_couvertes: [...rubriques],
    modele: `${config.provider}/${config.model}`,
    version_pipeline: PIPELINE_VERSION,
  };

  if (!uneData.a_surveiller) uneData.a_surveiller = [];
  if (!uneData.regard_etranger) uneData.regard_etranger = [];
  if (!uneData.signal_faible) uneData.signal_faible = [];
  if (!uneData.alerte_editoriale) uneData.alerte_editoriale = [];

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
  console.log(`  France : ${uneData.france?.length || 0} items`);
  console.log(`  Monde : ${uneData.monde?.length || 0} items`);
  console.log(`  Regard croisé : ${uneData.regard_croise?.sujet || 'N/A'}`);
  console.log(`  Regard étranger : ${uneData.regard_etranger?.length || 0} items`);
  console.log(`  Signal faible : ${uneData.signal_faible?.length || 0} items`);
  console.log(`  Alerte éditoriale : ${uneData.alerte_editoriale?.length || 0} items`);
  console.log(`  Chiffre du jour : ${uneData.chiffre_du_jour?.valeur || 'N/A'}`);
  console.log(`  ${uneData.a_surveiller?.length || 0} événements à surveiller`);
  console.log(`  Rubriques : ${[...rubriques].join(', ')}`);
  console.log(`  Pipeline: ${topics.length} topics → ${assignedTopicIds.size} sélectionnés → ${totalArticles} articles envoyés au LLM`);
  console.log(`  Archived to archives/${today}.json`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Pipeline generate-une failed:', err);
  process.exit(1);
});
