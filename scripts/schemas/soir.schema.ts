/**
 * Zod schema for soir.json — the evening edition
 * Deeper analysis, expanded regard croisé, longer-form content
 */

import { z } from 'zod';
import { RubriqueEnum, SourceTypeEnum, TonEnum } from './une.schema.js';

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

const CouvertureSoirSchema = z.object({
  source: z.string(),
  type: SourceTypeEnum,
  angle: z.string().min(10),
  ton: TonEnum,
  url: z.string().url(),
  citation_cle: z.string().optional(),
  auteur: z.string().optional().nullable(),
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
});

const AnalyseApprofondieSchema = z.object({
  sujet: z.string().min(10),
  rubrique: RubriqueEnum,
  contexte_long: z.string().min(100),
  enjeux: z.array(z.string().min(10)).min(2).max(5),
  perspectives: z.array(z.object({
    acteur: z.string(),
    position: z.string(),
    source: SourceRefSchema,
  })).min(2),
  notre_analyse: z.string().min(100),
  sources: z.array(SourceRefSchema).min(2),
});

const RegardCroiseSoirSchema = z.object({
  sujet: z.string().min(5),
  rubrique: RubriqueEnum,
  contexte: z.string().min(50),
  couvertures: z.array(CouvertureSoirSchema).min(3),
  analyse_coherence: z.string().min(150),
  doubles_standards: z.array(z.string()).default([]),
  biais_detectes: z.array(z.string()).min(1),
  ce_quil_faut_retenir: z.string().min(50),
});

const BilanJourneeSchema = z.object({
  resume: z.string().min(50),
  faits_marquants: z.array(z.string().min(10)).min(3).max(6),
  ce_qui_a_change: z.string().min(30),
});

const MetaSoirSchema = z.object({
  nb_articles_analyses: z.number(),
  sources_francaises: z.number(),
  sources_etrangeres: z.number(),
  rubriques_couvertes: z.array(z.string()).optional(),
  modele: z.string(),
  version_pipeline: z.string(),
});

export const SoirSchema = z.object({
  date: z.string(),
  genere_a: z.string(),
  edition: z.literal('soir'),

  bilan_journee: BilanJourneeSchema,
  analyse_approfondie: AnalyseApprofondieSchema,
  regards_croises: z.array(RegardCroiseSoirSchema).min(1).max(3),
  meta: MetaSoirSchema,
});

export type Soir = z.infer<typeof SoirSchema>;
export type AnalyseApprofondie = z.infer<typeof AnalyseApprofondieSchema>;
export type RegardCroiseSoir = z.infer<typeof RegardCroiseSoirSchema>;
