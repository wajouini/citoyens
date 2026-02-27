/**
 * Zod schema for ia.json — dedicated AI/Tech section
 * 10-15 daily AI news organized by sub-section + regard croisé IA
 */

import { z } from 'zod';
import { SourceTypeEnum, TonEnum } from './une.schema.js';

export const SousSectionEnum = z.enum([
  'annonces',
  'regulation',
  'recherche',
  'business',
  'societe',
]);

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

const FaitIASchema = z.object({
  titre: z.string().min(10),
  sous_section: SousSectionEnum,
  resume: z.string().min(20),
  pourquoi_ca_compte: z.string().min(20),
  sources: z.array(SourceRefSchema).min(1),
  lien: z.string().nullable(),
});

const CouvertureIASchema = z.object({
  source: z.string(),
  type: SourceTypeEnum,
  angle: z.string().min(10),
  ton: TonEnum,
  url: z.string().url(),
  citation_cle: z.string().optional(),
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
});

const RegardCroiseIASchema = z.object({
  sujet: z.string().min(5),
  contexte: z.string().min(30),
  couvertures: z.array(CouvertureIASchema).min(2),
  analyse_coherence: z.string().min(100),
  biais_detectes: z.array(z.string()).default([]),
  ce_quil_faut_retenir: z.string().min(50),
});

const MetaIASchema = z.object({
  nb_articles_ia: z.number(),
  nb_topics_ia: z.number().optional(),
  modele: z.string(),
  version_pipeline: z.string(),
});

export const IASchema = z.object({
  date: z.string(),
  genere_a: z.string(),

  faits_ia: z.array(FaitIASchema).min(5).max(18),
  regard_croise_ia: RegardCroiseIASchema.optional().nullable(),
  dernier_decryptage_slug: z.string().optional().nullable(),

  meta: MetaIASchema,
});

export type IA = z.infer<typeof IASchema>;
export type FaitIA = z.infer<typeof FaitIASchema>;
export type SousSection = z.infer<typeof SousSectionEnum>;
