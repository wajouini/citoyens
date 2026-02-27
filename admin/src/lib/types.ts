/**
 * TypeScript types matching scripts/schemas/une.schema.ts
 * Used across admin components for type-safe edition data.
 */

export interface GroupeMediaRef {
  nom: string;
  proprietaire: string;
  type_proprietaire: 'milliardaire' | 'cooperative' | 'etat' | 'fondation' | 'employes' | 'independant' | 'famille';
  orientation: string;
}

export interface SourceRef {
  nom: string;
  url: string;
  type: 'investigation' | 'mainstream' | 'fact-check' | 'institutionnel' | 'etranger';
  groupe_media?: GroupeMediaRef | null;
}

export interface FaitDuJour {
  titre: string;
  categorie: string;
  resume: string;
  sources: SourceRef[];
  lien: string | null;
}

export interface RegardEtranger {
  titre: string;
  titre_original?: string;
  source: string;
  pays: string;
  url: string;
  resume: string;
  date: string;
}

export interface Couverture {
  source: string;
  type: 'investigation' | 'mainstream' | 'fact-check' | 'etranger' | 'institutionnel';
  angle: string;
  ton: 'critique' | 'factuel' | 'alarmiste' | 'complaisant' | 'neutre' | 'engage';
  url: string;
  citation_cle?: string;
  auteur?: string | null;
  proprietaire_contexte?: string | null;
  orientation_source?: string | null;
  groupe_media?: GroupeMediaRef | null;
}

export interface RegardsCroises {
  sujet: string;
  contexte: string;
  couvertures: Couverture[];
  analyse_coherence: string;
  biais_detectes: string[];
  verdict_citoyens: string;
}

export interface ChiffreDuJour {
  valeur: string;
  contexte: string;
  source: string;
  source_url: string;
}

export interface ASurveiller {
  date: string;
  evenement: string;
  type: 'vote' | 'audition' | 'commission' | 'manifestation' | 'echeance' | 'autre';
  lien: string | null;
}

export interface UneMeta {
  nb_articles_analyses: number;
  sources_francaises: number;
  sources_etrangeres: number;
  modele: string;
  version_pipeline: string;
}

export interface Une {
  date: string;
  genere_a: string;
  titre_une: string;
  accroche: string;
  lien: string;
  categorie: string;
  faits_du_jour: FaitDuJour[];
  regard_etranger: RegardEtranger[];
  regards_croises: RegardsCroises[];
  chiffre_du_jour: ChiffreDuJour;
  a_surveiller: ASurveiller[];
  meta: UneMeta;
}

export interface DashboardData {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgDuration: number;
  totalArticles: number;
  totalFeeds: number;
  activeFeeds: number;
  feedsWithArticles: number;
  lastRun: RunLog | null;
  recentRuns: RunLog[];
  currentProvider: string | null;
  currentModel: string | null;
  articlesByType: Record<string, number>;
  articlesBySrc: Record<string, number>;
  articlesFileDate: string | null;
  une: Une | null;
  uneFileDate: string | null;
}

export interface StepResult {
  name: string;
  status: 'success' | 'failed' | 'skipped';
  duration_s: number;
  error?: string;
}

export interface RunLog {
  id: string;
  date: string;
  started_at: string;
  finished_at: string;
  duration_s: number;
  status: 'success' | 'failed';
  deployed: boolean;
  steps: StepResult[];
  stats: {
    articles_fetched: number;
    feeds_ok: number;
    feeds_total: number;
    faits_du_jour: number;
    regards_croises: number;
    regard_etranger: number;
    provider: string;
    model: string;
  };
}
