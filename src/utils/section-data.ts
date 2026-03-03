/**
 * section-data.ts — Helpers for section pages (Politique, Économie, Tech)
 *
 * Provides:
 * - normalizeTitle: lowercases + removes accents
 * - areSimilarTopics: detects overlap between two article titles
 * - dedupBriefings: filters briefings already covered by MDX articles
 * - inferRubrique: semantic rubrique from topic title (fixes "generaliste" → proper rubrique)
 * - getTopicsForSection: returns important topics filtered by section, formatted as FilItems
 * - pickFilItems: returns relevant fil items with fallback to recents (homepage)
 * - getDossiersForBriefing: finds dossiers legislatifs whose keywords match a briefing title
 * - getSujetsForSection: returns radar sujets matching a section's rubriques
 * - isRegardCroiseForSection: checks if a regard croisé belongs to a section
 */

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words too short or too common to be meaningful
const STOP_WORDS = new Set([
  'les', 'des', 'une', 'sur', 'pour', 'dans', 'avec', 'par', 'que', 'qui',
  'est', 'son', 'ses', 'leur', 'aux', 'mais', 'pas', 'tout', 'plus', 'cette',
  'apres', 'avant', 'sous', 'entre', 'vers', 'lors', 'dont', 'sans', 'comme',
  'the', 'and', 'for', 'with', 'from', 'that', 'this',
]);

function keywords(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
  );
}

export function areSimilarTopics(t1: string, t2: string): boolean {
  const k1 = keywords(t1);
  const k2 = keywords(t2);
  if (k1.size === 0 || k2.size === 0) return false;
  let overlap = 0;
  for (const w of k1) {
    if (k2.has(w)) overlap++;
  }
  // 2 shared keywords OR >30% of the smaller set
  return overlap >= 2 || overlap / Math.min(k1.size, k2.size) > 0.3;
}

export interface BriefingItem {
  titre: string;
  resume: string;
  rubrique?: string;
  pays?: string;
  contexte?: string;
  faits?: string[];
  sources?: Array<{ nom: string; url: string; type?: string }>;
}

/**
 * Returns briefings NOT already covered by any of the provided article titles.
 */
export function dedupBriefings(
  briefings: BriefingItem[],
  coveredTitles: string[],
): BriefingItem[] {
  const result: BriefingItem[] = [];
  const usedTitles: string[] = [...coveredTitles];

  for (const b of briefings) {
    if (!b.titre) continue;
    const alreadyCovered = usedTitles.some(t => areSimilarTopics(t, b.titre));
    if (!alreadyCovered) {
      result.push(b);
      usedTitles.push(b.titre);
    }
  }
  return result;
}

/**
 * Deduplicate an array of Astro content collection entries by topic similarity.
 * Keeps the first entry encountered for each topic cluster.
 * Entries with `estUne: true` are prioritized by sorting them first.
 */
export function dedupArticles<T extends { data: { titre: string; estUne?: boolean } }>(
  articles: T[],
): T[] {
  // estUne articles always come first so they're kept over duplicates
  const sorted = [...articles].sort((a, b) =>
    (b.data.estUne ? 1 : 0) - (a.data.estUne ? 1 : 0)
  );
  const result: T[] = [];
  const seenTitles: string[] = [];
  for (const article of sorted) {
    if (!seenTitles.some(t => areSimilarTopics(t, article.data.titre))) {
      result.push(article);
      seenTitles.push(article.data.titre);
    }
  }
  return result;
}

export interface FilItem {
  heure?: string;
  titre?: string;
  texte?: string;
  url?: string;
  source?: string;
  source_url?: string;
  rubrique?: string;
}

// ─── Topic-based fil (section sidebars) ─────────────────────────────────────

/**
 * Fine-grained 28-tag semantic classifier applied to topic/article titles.
 *
 * Groups by section:
 *   Tech & IA  → ia · spatial · medecine · robotique · electronique · cybersec · science
 *              → automobile (tech) · transport (tech) · energie (tech) · architecture
 *   Politique  → conflit · diplomatie · elections · parlement · gouvernement
 *   Économie   → macro · taxe · industrie · automobile · transport · immobilier · energie
 *              → travail · ecologie
 *   Société    → justice · education · sante · logement · droits · faits
 *   Autres     → culture · sport · general
 *
 * Rules are ordered most-specific first. The classifier is fully title-driven
 * so every topic gets a precise tag regardless of its original source rubrique.
 *
 * Shared tags (automobile, transport, energie) appear in both Économie and Tech
 * sidebars — the same topic surfaces in both sections because it has dual relevance.
 */
export function inferRubrique(titre: string, _current?: string): string {
  const t = titre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const rules: [string, RegExp][] = [
    // CONFLIT — guerres actives, frappes, opérations militaires
    ['conflit',      /frappe|bombardement|missile|attaque militaire|operation militaire|escalade militaire|guerre|iran|khamenei|hezbollah|hamas|ukraine|russo|talibans|conflit frontalier|interception.*petrolier|petrolier.*intercepte|offensive militaire/],
    // DIPLOMATIE — géopolitique, relations inter, droits humains internationaux
    ['diplomatie',   /diplomati|sanctions|accord international|geopolitiq|otan|onu|g7|g20|union europeenne|veto|ambassadeur|golfe|moyen.orient|politique.*trump|trump.*polit|reactions.*internationales|consequences.*region|droits humains|amerique latine|afrique.*liberte|lgbtq.*international|proche.orient/],
    // ÉLECTIONS — campagnes, scrutins
    ['elections',    /election|municipal|sondage|scrutin|campagne.elect|presidentielle|legislatives|europeenne|candidat/],
    // PARLEMENT — assemblée, sénat, votes de loi
    ['parlement',    /assemblee nationale|senat|depute|vote.*loi|vote.*budget|allocations.*vote|braun.pivet|hemicycle|proposition de loi|projet de loi/],
    // GOUVERNEMENT — exécutif, ministres, partis
    ['gouvernement', /gouvernement|conseil des ministres|premier ministre|macron|melenchon|bardella|le pen|parti polit|reforme.*gouvern|ministre /],
    // IA — intelligence artificielle, LLMs, régulation
    ['ia',           /intelligence artificielle|llm|modele.de.langage|openai|deepseek|anthropic|chatgpt|deepfake|contrat.*ia|ia.*contrat|ia.*militaire|militaire.*ia|regulation.*ia|ia.*regulation|generatif|evolution.*ia|applications.*ia|mistral/],
    // SPATIAL — exploration spatiale, astronomie
    ['spatial',      /spatial|astronomi|asteroid|nasa|esa |satellite|exploration.*espace|espace.*exploration|cosmos|galaxie|telescope|station spatiale|orbite|comete|planete/],
    // MÉDECINE — biotech, pharma, recherche médicale
    ['medecine',     /medicament|vaccin|cancer|chirurgie|epidemie|pandemie|virus |bacterie|biotech|pharma|genetique|genome|adn |proteine|risque.*sante|prevention.*sante|maladie.*traitement/],
    // ROBOTIQUE — robots, automatisation
    ['robotique',    /robot(?!iq)|drone.*logist|fabrique.*robot|industrie.*robot|bras robotique/],
    // AUTOMOBILE — marché auto, véhicules électriques, innovation automobile
    ['automobile',   /vehicule.*electrique|voiture.*electrique|voiture.*autonom|vehicule.*autonom|renault|stellantis|peugeot|toyota|volkswagen|tesla|marche.*auto|vente.*voiture|vente.*auto|industrie.*auto|automobile|moteur.*hybride|recharge.*vehicule/],
    // TRANSPORT — rail, aérien, mobilités urbaines
    ['transport',    /sncf|tgv|train |avion|aeroport|compagnie aerienne|fret|logistique.*transport|metro |tramway|bus urbain|mobilite urbaine|transport.*ferroviaire|transport.*aerien|navire|maritime|livraison.*colis/],
    // ÉNERGIE — nucléaire, pétrole, gaz, prix énergie, EnR sectorielles
    ['energie',      /nucleaire|reacteur|centrale.*electrique|petrole|gaz naturel|electricite.*prix|prix.*electricite|facture.*energie|kwh|capacite.*eolien|eolien.*offshore|panneaux.*solaire|hydrogene.*energie|stockage.*energie|reseau.*electrique|enr \b|grdf|edf energie|engie sa/],
    // ÉLECTRONIQUE — hardware, chips, smartphones, objets connectés
    ['electronique', /semiconducteur|puce |chip |xiaomi|samsung|iphone|smartphone|ordinateur|hardware|guide.achat|high.tech|produits.*tech|objets connectes|processeur|5g|electronique/],
    // CYBERSEC — cybersécurité, hacks, surveillance
    ['cybersec',     /cyber|hack |piratage|ransomware|donnees.*vole|fuite.*donnees|surveillance.*numerique|espionnage.*numerique|desinformation/],
    // ARCHITECTURE — urbanisme, smart city, bâtiment, construction numérique
    ['architecture', /architecture|urbanisme|smart city|ville.*intelli|ville.*numerique|batiment.*connect|bim |renovation.*batiment|construction.*durable|patrimoine.*bati|amenagement.*urbain/],
    // TAXE — fiscalité, impôts, réformes fiscales
    ['taxe',         /impot|taxe |tva |fiscalit|reforme fiscal|contribution sociale|cotisation|prelevement.*obligatoire|niches fiscal|credit.*impot|defiscalis|budget.*fiscal|changements.*fiscal/],
    // MACRO — marchés financiers, BCE, dette macro
    ['macro',        /inflation|pib|croissance econom|bourse|marche financ|dette publiq|deficit public|banque.central|bce |taux.interet|recession|crise.econom|pouvoir.achat/],
    // INDUSTRIE — entreprises, commerce international, agriculture
    ['industrie',    /industrie|agricult|commerce|exportation|importation|investissement.*economie|entreprise|startup.*econom|production.*industrielle/],
    // TRAVAIL — emploi, syndicats
    ['travail',      /emploi|chomage|smic|syndicat|greve|travailleur|licenciem|recrutement|teletravail/],
    // SALAIRE — rémunérations, inégalités salariales
    ['salaire',      /salaire|remuneration|inegalite.*salariale|gender pay gap|ecart.*revenu|hausse.*salariale|augmentation.*salaire|pouvoir.d.achat/],
    // INVESTISSEMENT — capital, fonds, financement
    ['investissement', /capital.risque|venture capital|fonds.*investissement|levee.*fonds|financement.*startup|ipo |introduction.*bourse|fusion.*acquisition|rachat.*entreprise|prise de participation/],
    // ÉCOLOGIE — environnement, biodiversité, CO2 (angle naturel/scientifique)
    ['ecologie',     /ecolog|biodiversite|rechauffement|deforestation|emission.*co2|pollution|especes.*menacees|foret.*amazonie|coraux|glaciers|sequestration/],
    // IMMOBILIER — marché immobilier, construction, foncier
    ['immobilier',   /immobilier|marche.*immobilier|prix.*logement|prix.*m2|construction.*logement|promoteur|lotissement|foncier|cadastre|copropriete|syndic|agence immobiliere|crise.*logement|parc.*immobilier/],
    // JUSTICE — procès, tribunaux, droit pénal
    ['justice',      /proces|tribunal|condamne|acquitte|jugement|droit penal|prison |detenu|enquete judiciaire|epstein|samuel paty|affaire.*judiciaire/],
    // ÉDUCATION — école, université
    ['education',    /ecole|universite|enseignement|eleve |etudiant|scolarite|programme.scolaire|bac |lycee|formation scolaire/],
    // SANTÉ PUBLIQUE — système de soins, hôpitaux
    ['sante',        /sante publique|systeme.*sante|hopital|assurance maladie|securite sociale|soins|infirmier|medecin.generaliste|urgences/],
    // LOGEMENT — accès au logement, location, HLM
    ['logement',     /logement.*social|hlm |loyer|locataire|proprietaire|squat|expulsion.*logem|mal.*logement|droit.*logement/],
    // DISCRIMINATION — discriminations raciales, sexistes, religieuses, origines
    ['discrimination', /discriminat|racisme|antisemitism|islamophobie|xenophobie|prejudice.*ethnic|segregation|inegalite.*traitement|biais.*embauche|plafond.*verre/],
    // DROITS — LGBTQ+, libertés civiles, laïcité
    ['droits',       /lgbtq|feminisme|egalite|liberte.*civile|laicite|droit.*femme|minorite|emprise|violence.*femme/],
    // SCIENCE — physique fondamentale, archéologie, biologie fondamentale
    ['science',      /recherche scientif|decouverte|physique|microscopie|quantique|paleontol|archeolog|proteomiq|proteines.*ancetre|biologie.*fundamental|astrophysique|cartographie mondiale/],
    // CULTURE — cinéma, musique, livres, art
    ['culture',      /cinema|film |musique|livre|exposition|festival|theatre|roman|concert|serie |litterature|auteur|autrice|ecrivain|romancier|culturel|the voice|sorties.*culturel|mode |fashion|louvre|manga|trilogie|bande dessinee/],
    // SPORT — compétitions sportives
    ['sport',        /football|ligue 1|motogp|moto gp|formule 1|\bf1\b|tennis|cycliste|cyclisme|velo|peloton|olympique|nba|rugby|grand prix|championnat|tournoi/],
    // FAITS DIVERS
    ['faits',        /faits divers|accident.*route|incendie.*mortel|catastrophe naturelle/],
  ];

  for (const [tag, pattern] of rules) {
    if (pattern.test(t)) return tag;
  }
  return 'general';
}

/**
 * Builds a section sidebar fil from clustered topics.
 *
 * Accepts either:
 *  - topics-tagged.json  (has a `tag` field — LLM classification, preferred)
 *  - topics.json         (no `tag` field — falls back to inferRubrique regex)
 *
 * - Filters by the section's relevant tags
 * - Sorts by topic importance score (score.total)
 * - Caps at max `perTagLimit` items per tag to prevent one story monopolising the sidebar
 * - For each topic, picks the best representative article (French first, then highest fiabilité)
 */
export function getTopicsForSection(
  topicsData: { topics: any[] },
  rawArticles: any[],
  rubriques: string[],
  limit = 7,
  perTagLimit = 3,
): FilItem[] {
  const articleMap = new Map<string, any>(rawArticles.map((a: any) => [a.id, a]));
  const tagCount: Record<string, number> = {};

  const filtered = topicsData.topics
    .map((topic: any) => ({
      ...topic,
      // Prefer LLM-assigned tag, fall back to regex classifier
      effectiveRubrique: topic.tag ?? inferRubrique(topic.titre),
    }))
    .filter((t: any) => rubriques.includes(t.effectiveRubrique))
    .sort((a: any, b: any) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
    .filter((t: any) => {
      tagCount[t.effectiveRubrique] = (tagCount[t.effectiveRubrique] ?? 0) + 1;
      return tagCount[t.effectiveRubrique] <= perTagLimit;
    })
    .slice(0, limit);

  return filtered
    .map((topic: any) => {
      const candidates = (topic.article_ids ?? [])
        .map((id: string) => articleMap.get(id))
        .filter(Boolean)
        .sort((a: any, b: any) => {
          if (a.langue === 'fr' && b.langue !== 'fr') return -1;
          if (b.langue === 'fr' && a.langue !== 'fr') return 1;
          return (b.fiabilite ?? 0) - (a.fiabilite ?? 0);
        });

      const best = candidates[0];
      if (!best) return null;

      return {
        heure: best.date
          ? new Date(best.date).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Paris',
            })
          : '--:--',
        titre: best.titre,
        url: best.url,
        source: best.source,
        source_url: best.url,
        rubrique: topic.effectiveRubrique,
        isoDate: best.date,
      } as FilItem;
    })
    .filter((item): item is FilItem => item !== null);
}

// ─── Section-aware regard croisé ────────────────────────────────────────────

const POLITIQUE_RUBRIQUES = new Set(['politique', 'international', 'justice', 'elections', 'gouvernement', 'parlement', 'diplomatie', 'conflit']);
const ECONOMIE_RUBRIQUES  = new Set(['economie', 'social', 'travail', 'industrie', 'macro', 'budget', 'entreprise', 'energie', 'ecologie', 'taxe']);
const TECH_RUBRIQUES      = new Set(['tech', 'ia', 'science', 'numerique', 'cybersec', 'spatial', 'medecine']);

/**
 * Returns true if the regard croisé belongs to a given section.
 */
export function isRegardCroiseForSection(regard: { rubrique?: string }, section: 'politique' | 'economie' | 'tech'): boolean {
  const rubrique = regard?.rubrique?.toLowerCase() ?? '';
  if (section === 'politique') return POLITIQUE_RUBRIQUES.has(rubrique);
  if (section === 'economie') return ECONOMIE_RUBRIQUES.has(rubrique);
  if (section === 'tech')     return TECH_RUBRIQUES.has(rubrique);
  return false;
}

// ─── Radar sujets for section ────────────────────────────────────────────────

/**
 * Returns sujets actifs from sujets-chauds.json that match a section's rubriques.
 * Each sujet includes its TL;DR bullets for rich display.
 */
export function getSujetsForSection(
  sujetsChauds: { sujets_actifs?: any[]; sujets_refroidis?: any[] },
  section: 'politique' | 'economie' | 'tech',
  limit = 3,
): any[] {
  const rubriquesSet = section === 'politique' ? POLITIQUE_RUBRIQUES
    : section === 'economie' ? ECONOMIE_RUBRIQUES
    : TECH_RUBRIQUES;

  return (sujetsChauds.sujets_actifs ?? [])
    .filter(s => rubriquesSet.has((s.rubrique ?? '').toLowerCase()))
    .slice(0, limit);
}

// ─── Dossiers matching ───────────────────────────────────────────────────────

/**
 * Finds dossiers whose mots_cles overlap with words in the briefing title.
 * Used to surface a "Dossier lié" badge on section page briefings.
 *
 * @param titre   - The briefing title to match against
 * @param dossiers - Array of dossier entries from Astro's getCollection('dossiers')
 * @returns Matching dossiers (slug + titre + icone)
 */
export function getDossiersForBriefing(
  titre: string,
  dossiers: Array<{ id: string; data: { titre: string; icone?: string; mots_cles?: string[] } }>,
): Array<{ slug: string; titre: string; icone: string }> {
  const titleWords = keywords(titre);
  if (titleWords.size === 0) return [];

  return dossiers
    .filter(d => {
      const motsCles: string[] = d.data.mots_cles ?? [];
      if (motsCles.length === 0) return false;
      // Check if any mot_clé has a keyword overlap with the briefing title
      return motsCles.some(mc => {
        const mcWords = keywords(mc);
        for (const w of mcWords) {
          if (titleWords.has(w)) return true;
        }
        // Also try the full mot_clé as a substring of the normalized title
        const normalizedTitle = normalizeTitle(titre);
        const normalizedMc = normalizeTitle(mc);
        return normalizedTitle.includes(normalizedMc) || normalizedMc.includes(normalizedTitle.split(' ')[0] ?? '');
      });
    })
    .map(d => ({
      slug: d.id,
      titre: d.data.titre,
      icone: d.data.icone ?? '📁',
    }));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns up to `limit` fil items for a section, ensuring source diversity.
 * First tries rubriques matching the section, then falls back to recents.
 * Max 2 items per source to avoid repetition.
 */
export function pickFilItems(
  allItems: FilItem[],
  rubriques: string[],
  limit = 6,
): FilItem[] {
  function diversify(items: FilItem[], max: number): FilItem[] {
    const sourceCounts = new Map<string, number>();
    const result: FilItem[] = [];
    for (const item of items) {
      const src = item.source ?? 'unknown';
      const count = sourceCounts.get(src) ?? 0;
      if (count < 2) {
        result.push(item);
        sourceCounts.set(src, count + 1);
      }
      if (result.length >= max) break;
    }
    return result;
  }

  const matched = allItems.filter(i => i.rubrique && rubriques.includes(i.rubrique));
  const diversified = diversify(matched, limit);
  if (diversified.length >= 4) return diversified;

  // fallback: fill from all items not already included
  const usedUrls = new Set(diversified.map(i => i.url));
  const extras = allItems.filter(i => !usedUrls.has(i.url));
  return diversify([...diversified, ...extras], limit);
}
