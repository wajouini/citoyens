/**
 * classify-topics.ts
 *
 * Classifies each topic from topics.json into a fine-grained editorial tag
 * using Gemini (gemini-3-flash-preview). Processes topics in batches of 25.
 * Writes results to src/data/.pipeline/topics-tagged.json.
 *
 * Usage: npx dotenv-cli -e .env -- tsx scripts/classify-topics.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Taxonomy ────────────────────────────────────────────────────────────────

const TAGS = [
  // Politique & monde
  'conflit',      // guerres actives, frappes militaires, crises armées
  'diplomatie',   // géopolitique, relations inter, sanctions, droits humains inter
  'elections',    // campagnes électorales, scrutins, sondages
  'parlement',    // assemblée nationale, sénat, votes de loi, réformes législatives
  'gouvernement', // exécutif, ministres, partis politiques, politiques publiques
  // Tech & IA
  'ia',           // intelligence artificielle, LLMs, régulation algo, deepfake
  'spatial',      // exploration spatiale, satellites, astronomie, NASA/ESA
  'medecine',     // biotech, pharma, recherche médicale, génomique, cancers
  'robotique',    // robots, automatisation industrielle, drones logistiques
  'electronique', // hardware, chips, smartphones, objets connectés, semiconducteurs
  'cybersec',     // cybersécurité, hacks, ransomware, surveillance numérique
  'architecture', // urbanisme, smart city, bâtiment intelligent, BIM
  'science',      // physique fondamentale, archéologie, biologie, astrophysique
  // Économie
  'macro',        // marchés financiers, BCE, inflation, PIB, dette publique
  'taxe',         // fiscalité, impôts, réformes fiscales, TVA, niches
  'industrie',    // entreprises, agriculture, commerce international
  'automobile',   // marché auto, véhicules électriques, industrie automobile
  'transport',    // rail, aviation, mobilité urbaine, logistique, maritime
  'energie',      // nucléaire, pétrole, gaz, prix énergie, EnR sectorielles
  'immobilier',   // marché immobilier, prix logement, construction, foncier
  'travail',        // emploi, chômage, syndicats, grèves, conditions de travail
  'salaire',        // rémunérations, inégalités salariales, gender pay gap, revenus
  'investissement', // capital-risque, fonds d'investissement, financement, levées de fonds
  'ecologie',       // environnement, biodiversité, CO2, déforestation, pollution
  // Société
  'justice',        // procès, tribunaux, droit pénal, affaires judiciaires
  'education',      // école, université, programmes scolaires, jeunesse
  'sante',          // système de santé, hôpitaux, assurance maladie
  'logement',       // HLM, loyers, accès au logement, expulsions
  'droits',         // LGBTQ+, libertés civiles, laïcité, violences faites aux femmes
  'discrimination', // discriminations raciales, sexistes, religieuses, handicap, origines
  'faits',          // faits divers, accidents graves, catastrophes
  // Autres
  'culture',      // cinéma, musique, livres, art, littérature, mode, jeux vidéo
  'sport',        // compétitions sportives, football, tennis, cyclisme, F1
  'general',      // ne rentre dans aucune catégorie précédente
] as const;

type Tag = typeof TAGS[number];
const VALID_TAGS = new Set<string>(TAGS);

const SYSTEM_PROMPT = `Tu es un éditeur de presse français expert en classification thématique.
Ta tâche : attribuer UN seul tag parmi la liste fournie à chaque sujet d'actualité.

RÈGLES STRICTES :
1. Réponds UNIQUEMENT avec un tableau JSON valide : [{"id":"...","tag":"..."},...]
2. Chaque tag doit être exactement l'un des codes de la liste — rien d'autre.
3. Pas de texte avant ou après le JSON, pas de \`\`\`json.
4. Privilégie le tag le plus PRÉCIS et SPÉCIFIQUE.
5. "general" seulement si aucun autre tag ne convient.

TAXONOMIE (code → description) :
conflit: guerres actives, frappes militaires, crises armées (Iran, Ukraine...)
diplomatie: géopolitique, relations internationales, sanctions, droits humains internationaux
elections: campagnes électorales, scrutins, sondages politiques
parlement: assemblée nationale, sénat, votes de loi, réformes législatives
gouvernement: exécutif, conseil des ministres, partis politiques
ia: intelligence artificielle, LLMs, OpenAI, régulation algo, deepfake
spatial: exploration spatiale, satellites, astronomie, NASA/ESA
medecine: biotech, pharma, recherche médicale, génomique, maladies, vaccins
robotique: robots physiques, automatisation industrielle, véhicules autonomes
electronique: hardware, chips, semiconducteurs, smartphones, objets connectés
cybersec: cybersécurité, hacks, ransomware, fuite de données
architecture: urbanisme, smart city, bâtiment intelligent, BIM, rénovation urbaine
science: physique fondamentale, archéologie, biologie, paléontologie, astrophysique
macro: marchés financiers, BCE, inflation, PIB, dette publique, récession
taxe: fiscalité, impôts, TVA, réformes fiscales, niches fiscales
industrie: entreprises, agriculture, commerce international, production industrielle
automobile: marché auto, véhicules électriques, industrie automobile (Renault, Tesla...)
transport: rail (SNCF/TGV), aviation, mobilité urbaine, logistique maritime
energie: nucléaire, pétrole, gaz, prix de l'énergie, éolien offshore, stockage
immobilier: marché immobilier, prix des logements, construction, foncier, promoteurs
travail: emploi, chômage, syndicats, grèves, conditions de travail, SMIC
salaire: rémunérations, inégalités salariales, gender pay gap, écarts de revenus, hausses salariales
investissement: capital-risque, fonds d'investissement, levées de fonds, financement startup, IPO, M&A
ecologie: environnement, biodiversité, CO2, déforestation, espèces menacées, pollution
justice: procès, tribunaux, droit pénal, affaires judiciaires (Epstein, Paty...)
education: école, université, programmes scolaires, étudiants
sante: système de santé, hôpitaux, assurance maladie, soins, urgences
logement: HLM, loyers, accès au logement, expulsions, logement social
droits: LGBTQ+, libertés civiles, laïcité, violences faites aux femmes, emprise
discrimination: discriminations raciales, sexistes, religieuses, liées au handicap, à l'origine, au nom
faits: faits divers, accidents graves, catastrophes naturelles
culture: cinéma, musique, livres, littérature, art, mode, jeux vidéo, séries
sport: compétitions sportives — football, tennis, cyclisme, F1, rugby...
general: ne rentre dans aucune catégorie précédente`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseTaggedBatch(raw: string, fallbackIds: string[]): Record<string, Tag> {
  const result: Record<string, Tag> = {};
  try {
    // Strip any markdown fences just in case
    const clean = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(clean) as Array<{ id: string; tag: string }>;
    for (const item of parsed) {
      const tag = VALID_TAGS.has(item.tag) ? (item.tag as Tag) : 'general';
      result[item.id] = tag;
    }
  } catch {
    console.warn('  ⚠ JSON parse failed, falling back to general for batch');
    fallbackIds.forEach(id => { result[id] = 'general'; });
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = resolveConfig();
  // Force Gemini flash for classification — fast and cheap
  config.provider = 'gemini';
  config.model = 'gemini-3-flash-preview';
  config.apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!config.apiKey) {
    console.error('✗ GEMINI_API_KEY not set');
    process.exit(1);
  }

  const topicsPath = join(ROOT, 'src/data/.pipeline/topics.json');
  const outPath    = join(ROOT, 'src/data/.pipeline/topics-tagged.json');

  const topicsData = JSON.parse(readFileSync(topicsPath, 'utf-8')) as {
    topics: Array<{ id: string; titre: string; [key: string]: any }>;
  };

  const topics = topicsData.topics;
  console.log(`Classifying ${topics.length} topics in batches of 25…`);

  const tagMap: Record<string, Tag> = {};
  const batches = chunkArray(topics, 25);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchIds = batch.map(t => t.id);
    const userMessage = JSON.stringify(
      batch.map(t => ({ id: t.id, titre: t.titre })),
      null,
      2,
    );

    console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} topics)…`);
    try {
      const raw = await callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 2048);
      const tagged = parseTaggedBatch(raw, batchIds);
      Object.assign(tagMap, tagged);
      // Log sample
      batch.slice(0, 3).forEach(t => {
        console.log(`    [${tagMap[t.id] ?? '?'}] ${t.titre.slice(0, 60)}`);
      });
    } catch (err: any) {
      console.error(`  ✗ Batch ${i + 1} failed: ${err.message}`);
      batchIds.forEach(id => { tagMap[id] = 'general'; });
    }

    // Small pause between batches to respect rate limits
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  // Merge tags back into topics
  const tagged = topics.map(t => ({ ...t, tag: tagMap[t.id] ?? 'general' }));

  const output = {
    date: new Date().toISOString().slice(0, 10),
    classifie_a: new Date().toISOString(),
    model: 'gemini-3-flash-preview',
    nb_topics: tagged.length,
    topics: tagged,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✓ ${tagged.length} topics classifiés → ${outPath}`);

  // Distribution summary
  const dist: Record<string, number> = {};
  tagged.forEach(t => { dist[t.tag] = (dist[t.tag] ?? 0) + 1; });
  console.log('\nDistribution :');
  Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => console.log(`  ${tag.padEnd(14)} ${count}`));
}

main().catch(err => {
  console.error('classify-topics failed:', err);
  process.exit(1);
});
