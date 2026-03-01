/**
 * fetch-rss-fil.ts
 *
 * Fetches raw RSS items from active feeds (no AI processing).
 * Writes results to public/data/fil.json for client-side refresh (15-min interval).
 *
 * Usage:  npx tsx scripts/fetch-rss-fil.ts
 * Cron:   every 15 minutes via Vercel cron or external scheduler
 */

import Parser from 'rss-parser';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callLLMWithRetry } from './llm-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface Feed {
  nom: string;
  url: string;
  type: string;
  rubrique: string;
  pays: string;
  langue: string;
  fiabilite: number;
  active: boolean;
  groupe: string;
  orientation: string;
}

interface FilItem {
  heure: string;
  titre: string;
  url: string;
  rubrique: string;
  source: string;
  source_url: string;
  pays: string;
  langue: string;
  type: string;
  orientation: string;
  isoDate: string;
}

const RUBRIQUES_CANON: Record<string, string> = {
  generaliste: 'general',
  politique:   'politique',
  economie:    'economie',
  tech:        'tech',
  science:     'science',
  societe:     'societe',
  culture:     'culture',
  international: 'international',
  ia:          'tech',
};

/**
 * Fine-grained 22-tag classifier applied to individual article titles.
 * Mirrors inferRubrique() from section-data.ts — keeps both in sync.
 * Applied to items from generalist sources so the homepage fil shows precise tags.
 */
function classifyByTitle(titre: string): string {
  const t = titre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const rules: [string, RegExp][] = [
    ['conflit',      /frappe|bombardement|missile|attaque militaire|operation militaire|escalade militaire|guerre|iran|khamenei|hezbollah|hamas|ukraine|russo|talibans|conflit frontalier|interception.*petrolier|offensive militaire/],
    ['diplomatie',   /diplomati|sanctions|accord international|geopolitiq|otan|onu|g7|g20|union europeenne|veto|ambassadeur|golfe|moyen.orient|politique.*trump|trump.*polit|reactions.*internationales|droits humains|amerique latine|afrique.*liberte|proche.orient/],
    ['elections',    /election|municipal|sondage|scrutin|campagne.elect|presidentielle|legislatives|europeenne|candidat/],
    ['parlement',    /assemblee nationale|senat|depute|vote.*loi|vote.*budget|allocations.*vote|braun.pivet|hemicycle|proposition de loi|projet de loi/],
    ['gouvernement', /gouvernement|conseil des ministres|premier ministre|macron|melenchon|bardella|le pen|parti polit|ministre /],
    ['ia',           /intelligence artificielle|llm|modele.de.langage|openai|deepseek|anthropic|chatgpt|deepfake|contrat.*ia|ia.*militaire|militaire.*ia|regulation.*ia|generatif|mistral/],
    ['spatial',      /spatial|astronomi|asteroid|nasa|esa |satellite|exploration.*espace|espace.*exploration|cosmos|galaxie|telescope|station spatiale|orbite|planete/],
    ['medecine',     /medicament|vaccin|cancer|chirurgie|epidemie|pandemie|virus |bacterie|biotech|pharma|genetique|genome|adn |risque.*sante|prevention.*sante/],
    ['robotique',    /robot(?!iq)|drone.*logist|fabrique.*robot|bras robotique/],
    ['automobile',   /vehicule.*electrique|voiture.*electrique|voiture.*autonom|vehicule.*autonom|renault|stellantis|peugeot|toyota|volkswagen|tesla|marche.*auto|vente.*voiture|vente.*auto|industrie.*auto|automobile|moteur.*hybride/],
    ['transport',    /sncf|tgv|train |avion|aeroport|compagnie aerienne|fret|logistique.*transport|metro |tramway|bus urbain|mobilite urbaine|transport.*ferroviaire|transport.*aerien|navire|maritime/],
    ['energie',      /nucleaire|reacteur|centrale.*electrique|petrole|gaz naturel|electricite.*prix|prix.*electricite|facture.*energie|kwh|eolien.*offshore|panneaux.*solaire|hydrogene.*energie|stockage.*energie|reseau.*electrique|enr \b|grdf|edf energie|engie sa/],
    ['electronique', /semiconducteur|puce |chip |xiaomi|samsung|iphone|smartphone|ordinateur|hardware|guide.achat|high.tech|objets connectes|processeur|5g|electronique/],
    ['cybersec',     /cyber|hack |piratage|ransomware|donnees.*vole|fuite.*donnees|surveillance.*numerique/],
    ['architecture', /architecture|urbanisme|smart city|ville.*intelli|batiment.*connect|bim |renovation.*batiment|amenagement.*urbain/],
    ['taxe',         /impot|taxe |tva |fiscalit|reforme fiscal|cotisation|prelevement.*obligatoire|niches fiscal|credit.*impot|budget.*fiscal|changements.*fiscal/],
    ['macro',        /inflation|pib|croissance econom|bourse|marche financ|dette publiq|deficit public|banque.central|bce |taux.interet|recession|crise.econom/],
    ['industrie',    /industrie|agricult|commerce|exportation|importation|investissement|entreprise/],
    ['travail',        /emploi|chomage|smic|syndicat|greve|travailleur|licenciem|teletravail/],
    ['salaire',        /salaire|remuneration|inegalite.*salariale|gender pay gap|ecart.*revenu|hausse.*salariale|augmentation.*salaire|pouvoir.d.achat/],
    ['investissement', /capital.risque|venture capital|fonds.*investissement|levee.*fonds|financement.*startup|introduction.*bourse|fusion.*acquisition|rachat.*entreprise/],
    ['ecologie',     /ecolog|biodiversite|rechauffement|deforestation|emission.*co2|pollution|especes.*menacees/],
    ['immobilier',   /immobilier|marche.*immobilier|prix.*logement|prix.*m2|construction.*logement|promoteur|foncier|copropriete|parc.*immobilier/],
    ['justice',      /proces|tribunal|condamne|acquitte|jugement|droit penal|prison |detenu|enquete judiciaire|epstein|samuel paty/],
    ['education',    /ecole|universite|enseignement|eleve |etudiant|scolarite|bac |lycee/],
    ['sante',        /sante publique|systeme.*sante|hopital|assurance maladie|securite sociale|soins|infirmier|urgences/],
    ['logement',     /logement.*social|hlm |loyer|locataire|squat|expulsion.*logem|mal.*logement/],
    ['discrimination', /discriminat|racisme|antisemitism|islamophobie|xenophobie|segregation|biais.*embauche|plafond.*verre/],
    ['droits',         /lgbtq|feminisme|egalite|liberte.*civile|laicite|droit.*femme|minorite|emprise|violence.*femme/],
    ['science',      /recherche scientif|decouverte|physique|microscopie|quantique|paleontol|archeolog|proteomiq|astrophysique/],
    ['culture',      /cinema|film |musique|livre|exposition|festival|theatre|roman|concert|serie |litterature|auteur|autrice|ecrivain|romancier|culturel|manga|trilogie|bande dessinee/],
    ['sport',        /football|ligue 1|motogp|moto gp|formule 1|\bf1\b|tennis|cycliste|cyclisme|velo|olympique|nba|rugby|grand prix|championnat/],
    ['faits',        /faits divers|accident.*route|incendie.*mortel/],
  ];

  for (const [tag, pattern] of rules) {
    if (pattern.test(t)) return tag;
  }
  return 'general';
}

// ── LLM classification ───────────────────────────────────────────────────────

const FIL_CLASSIFY_SYSTEM = `Tu es un éditeur de presse français expert en classification thématique.
Ta tâche : attribuer UN seul tag parmi la liste fournie à chaque titre d'article.

RÈGLES STRICTES :
1. Réponds UNIQUEMENT avec un tableau JSON valide : [{"id":"...","tag":"..."},...]
2. Chaque tag doit être exactement l'un des codes de la liste — rien d'autre.
3. Pas de texte avant ou après le JSON, pas de \`\`\`json.
4. Privilégie le tag le plus PRÉCIS et SPÉCIFIQUE.

DISTINCTION CRITIQUE conflit / diplomatie :
- conflit  → l'article décrit des ACTES de guerre : frappes, attaques, morts au combat, explosions, opérations militaires, progression de troupes, tirs de missiles
- diplomatie → l'article décrit des PAROLES ou RÉACTIONS : déclarations officielles, Trump dit qu'il va parler, négociations, réactions diplomatiques, positionnement politique, sanctions, même si la guerre est en arrière-plan

TAXONOMIE (code → description) :
conflit: actes de guerre — frappes, attaques, morts militaires, opérations, batailles
diplomatie: paroles et réactions — déclarations, négociations, sanctions, rencontres, positionnements
elections: campagnes électorales, scrutins, sondages politiques
parlement: assemblée nationale, sénat, votes de loi
gouvernement: exécutif, conseil des ministres, partis politiques
ia: intelligence artificielle, LLMs, OpenAI, régulation algo, deepfake
spatial: exploration spatiale, satellites, astronomie
medecine: biotech, pharma, recherche médicale, génomique, maladies, vaccins
robotique: robots physiques, automatisation industrielle
electronique: hardware, chips, semiconducteurs, smartphones, objets connectés
cybersec: cybersécurité, hacks, ransomware, fuite de données
architecture: urbanisme, smart city, bâtiment intelligent, BIM
science: physique fondamentale, archéologie, biologie, paléontologie
macro: marchés financiers, BCE, inflation, PIB, dette publique
taxe: fiscalité, impôts, TVA, réformes fiscales, niches
industrie: entreprises, agriculture, commerce international, production
automobile: marché auto, véhicules électriques, industrie automobile
transport: rail (SNCF/TGV), aviation, mobilité urbaine, logistique
energie: nucléaire, pétrole, gaz, prix de l'énergie, EnR
immobilier: marché immobilier, prix des logements, construction, foncier
travail: emploi, chômage, syndicats, grèves, conditions de travail
salaire: rémunérations, inégalités salariales, gender pay gap, écarts de revenus
investissement: capital-risque, levées de fonds, fusions-acquisitions, financement
ecologie: environnement, biodiversité, CO2, déforestation, pollution
justice: procès, tribunaux, droit pénal, affaires judiciaires
education: école, université, programmes scolaires, étudiants
sante: système de santé, hôpitaux, assurance maladie, soins
logement: HLM, loyers, accès au logement, expulsions
droits: LGBTQ+, libertés civiles, laïcité, violences faites aux femmes
discrimination: discriminations raciales, sexistes, religieuses, origines
faits: faits divers, accidents graves, catastrophes naturelles
culture: cinéma, musique, livres, littérature, art, mode, jeux vidéo, séries, pop
sport: toutes compétitions sportives — football, Premier League, Ligue 1, tennis, F1, rugby, NBA, cyclisme...
general: ne rentre dans aucune catégorie précédente`;

const VALID_FIL_TAGS = new Set([
  'conflit', 'diplomatie', 'elections', 'parlement', 'gouvernement',
  'ia', 'spatial', 'medecine', 'robotique', 'electronique', 'cybersec', 'architecture', 'science',
  'macro', 'taxe', 'industrie', 'automobile', 'transport', 'energie', 'immobilier',
  'travail', 'salaire', 'investissement', 'ecologie',
  'justice', 'education', 'sante', 'logement', 'droits', 'discrimination', 'faits',
  'culture', 'sport', 'general',
]);

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function classifyFilWithLLM(items: FilItem[], apiKey: string): Promise<void> {
  const config = {
    provider: 'gemini' as const,
    model: 'gemini-3-flash-preview',
    apiKey,
  };

  const batches = chunkArray(items, 30);
  console.log(`  Classifying ${items.length} fil items in ${batches.length} batches…`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const userMsg = JSON.stringify(
      batch.map((item, idx) => ({ id: String(i * 30 + idx), titre: item.titre })),
      null, 2,
    );

    try {
      const raw = await callLLMWithRetry(config, FIL_CLASSIFY_SYSTEM, userMsg, 2048);
      const clean = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(clean) as Array<{ id: string; tag: string }>;
      for (const { id, tag } of parsed) {
        const idx = parseInt(id, 10) - i * 30;
        if (idx >= 0 && idx < batch.length && VALID_FIL_TAGS.has(tag)) {
          batch[idx].rubrique = tag;
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠ LLM batch ${i + 1} failed, keeping regex tags: ${err.message}`);
    }

    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 300));
  }
}

// ── Feed fetching ─────────────────────────────────────────────────────────────

const MAX_ITEMS_PER_FEED = 5;
const MAX_TOTAL_ITEMS    = 80;
const FETCH_TIMEOUT_MS   = 8_000;

async function fetchFeedWithTimeout(parser: Parser, url: string): Promise<Parser.Output<Parser.Item>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const feed = await parser.parseURL(url);
    return feed;
  } finally {
    clearTimeout(timer);
  }
}

function toHeure(dateStr: string | undefined): string {
  if (!dateStr) return '--:--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

function getIso(item: Parser.Item): string {
  return item.isoDate ?? item.pubDate ?? new Date(0).toISOString();
}

async function main() {
  const feedsPath = join(ROOT, 'src/data/feeds.json');
  const feeds: Feed[] = JSON.parse(readFileSync(feedsPath, 'utf-8'));
  const activeFeeds = feeds.filter(f => f.active);

  const parser = new Parser({
    requestOptions: { rejectUnauthorized: false },
    timeout: FETCH_TIMEOUT_MS,
    customFields: {
      item: [['media:content', 'mediaContent'], ['dc:creator', 'creator']],
    },
  });

  const allItems: FilItem[] = [];
  const seenUrls = new Set<string>();

  console.log(`Fetching ${activeFeeds.length} active feeds…`);

  const results = await Promise.allSettled(
    activeFeeds.map(async (feed) => {
      try {
        const parsed = await fetchFeedWithTimeout(parser, feed.url);
        const items = (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FEED);
        return { feed, items };
      } catch (err: any) {
        console.warn(`  ✗ ${feed.nom}: ${err.message ?? err}`);
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { feed, items } = result.value;

    for (const item of items) {
      const url = item.link ?? item.guid ?? '';
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const titre = (item.title ?? '').trim();
      if (!titre) continue;

      const isoDate = getIso(item);
      const canonRubrique = RUBRIQUES_CANON[feed.rubrique] ?? feed.rubrique;
      // Re-classify generalist/news sources by title — dedicated topic sources (tech, economie...) keep their tag
      const rubrique = ['general', 'international', 'politique', 'societe'].includes(canonRubrique)
        ? classifyByTitle(titre)
        : canonRubrique;

      allItems.push({
        heure:       toHeure(isoDate),
        titre,
        url,
        rubrique,
        source:      feed.nom,
        source_url:  url,
        pays:        feed.pays,
        langue:      feed.langue,
        type:        feed.type,
        orientation: feed.orientation,
        isoDate,
      });
    }
  }

  // Sort fresh items by date descending
  allItems.sort((a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime());

  // Merge with existing fil.json BEFORE classification so we only classify the final set
  const srcOutPath    = join(ROOT, 'src/data/fil.json');
  const publicOutPath = join(ROOT, 'public/data/fil.json');
  let existingItems: FilItem[] = [];
  try {
    const existing = JSON.parse(readFileSync(srcOutPath, 'utf-8'));
    existingItems = existing.items ?? [];
  } catch { /* first run — no existing file */ }

  // Fresh items override existing ones with same URL, then pad with older items up to MAX
  const freshUrls  = new Set(allItems.map(i => i.url));
  const olderItems = existingItems.filter(i => !freshUrls.has(i.url));
  const merged = [...allItems, ...olderItems]
    .sort((a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime())
    .slice(0, MAX_TOTAL_ITEMS);

  const freshInMerged = merged.filter(i => freshUrls.has(i.url)).length;
  const keptCount     = merged.length - freshInMerged;
  console.log(`  Merged: ${freshInMerged} fresh + ${keptCount} kept = ${merged.length} total`);

  // LLM classification on the final merged set — only fresh items need re-tagging
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const toClassify = merged.filter(i => freshUrls.has(i.url));
    await classifyFilWithLLM(toClassify, geminiKey);
  } else {
    console.log('  (GEMINI_API_KEY absent — keeping regex classification)');
  }

  const now = new Date().toISOString();
  const output = {
    date:         now.slice(0, 10),
    genere_a:     now,
    derniere_maj: now,
    source:       'rss',
    nb_items:     merged.length,
    items:        merged,
  };

  // Write to public/ for live client-side refresh
  mkdirSync(dirname(publicOutPath), { recursive: true });
  writeFileSync(publicOutPath, JSON.stringify(output, null, 2), 'utf-8');

  // Also write to src/data/ for Astro build-time import
  writeFileSync(srcOutPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✓ ${merged.length} items written → fil.json`);
}

main().catch(err => {
  console.error('fetch-rss-fil failed:', err);
  process.exit(1);
});
