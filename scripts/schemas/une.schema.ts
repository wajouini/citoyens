/**
 * Zod schema for une.json — the daily edition
 * Used by generate-une.ts to validate LLM output
 * and by the frontend at build time
 */

import { z } from 'zod';

// ---------- Enums ----------

export const RubriqueEnum = z.enum([
  'politique', 'economie', 'tech', 'science', 'societe', 'culture', 'international',
]);

export const SourceTypeEnum = z.enum([
  'investigation', 'mainstream', 'fact-check', 'institutionnel', 'etranger',
]);

export const TonEnum = z.enum([
  'critique', 'factuel', 'alarmiste', 'complaisant', 'neutre', 'engage',
]);

// ---------- Sub-schemas ----------

const GroupeMediaRefSchema = z.object({
  nom: z.string(),
  proprietaire: z.string(),
  type_proprietaire: z.enum(['milliardaire', 'cooperative', 'etat', 'fondation', 'employes', 'independant', 'famille']),
  orientation: z.string(),
});

const SourceRefSchema = z.object({
  nom: z.string(),
  url: z.string().url(),
  type: SourceTypeEnum,
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
});

// ---------- Sujet du jour ----------

const SujetDuJourSchema = z.object({
  titre: z.string().min(10),
  rubrique: RubriqueEnum,
  pourquoi_important: z.string().min(20),
  faits: z.array(z.string().min(10)).min(2).max(5),
  contexte: z.string().min(30),
  sources: z.array(SourceRefSchema).min(1),
  lien: z.string().nullable(),
});

// ---------- Essentiels ----------

const EssentielSchema = z.object({
  titre: z.string().min(10),
  rubrique: RubriqueEnum,
  resume: z.string().min(20),
  sources: z.array(SourceRefSchema).min(1),
  lien: z.string().nullable(),
});

// ---------- Regard croise ----------

const CouvertureSchema = z.object({
  source: z.string(),
  type: SourceTypeEnum,
  angle: z.string().min(10),
  ton: TonEnum,
  url: z.string().url(),
  citation_cle: z.string().optional(),
  auteur: z.string().optional().nullable(),
  proprietaire_contexte: z.string().optional().nullable(),
  orientation_source: z.string().optional().nullable(),
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
});

const RegardCroiseSchema = z.object({
  sujet: z.string().min(5),
  rubrique: RubriqueEnum,
  contexte: z.string().min(30),
  couvertures: z.array(CouvertureSchema).min(2),
  analyse_coherence: z.string().min(100),
  biais_detectes: z.array(z.string()).min(1),
  ce_quil_faut_retenir: z.string().min(50),
});

// ---------- Chiffre du jour ----------

const ChiffreDuJourSchema = z.object({
  valeur: z.string(),
  contexte: z.string().min(20),
  source: z.string(),
  source_url: z.string().url(),
});

// ---------- A surveiller ----------

const ASurveillerSchema = z.object({
  date: z.string(),
  evenement: z.string(),
  type: z.enum([
    'vote', 'audition', 'commission', 'manifestation', 'echeance',
    'tech_launch', 'publication', 'echeance_economique', 'conference', 'autre',
  ]),
  lien: z.string().nullable(),
});

// ---------- Meta ----------

const MetaSchema = z.object({
  nb_articles_analyses: z.number(),
  sources_francaises: z.number(),
  sources_etrangeres: z.number(),
  rubriques_couvertes: z.array(z.string()).optional(),
  modele: z.string(),
  version_pipeline: z.string(),
});

// ---------- Main schema ----------

export const UneSchema = z.object({
  date: z.string(),
  genere_a: z.string(),

  sujet_du_jour: SujetDuJourSchema,
  essentiels: z.array(EssentielSchema).min(3).max(8),
  regard_croise: RegardCroiseSchema,
  chiffre_du_jour: ChiffreDuJourSchema,
  a_surveiller: z.array(ASurveillerSchema).default([]),
  meta: MetaSchema,
});

export type Une = z.infer<typeof UneSchema>;
export type SujetDuJour = z.infer<typeof SujetDuJourSchema>;
export type Essentiel = z.infer<typeof EssentielSchema>;
export type RegardCroise = z.infer<typeof RegardCroiseSchema>;
export type Couverture = z.infer<typeof CouvertureSchema>;
export type GroupeMediaRef = z.infer<typeof GroupeMediaRefSchema>;
