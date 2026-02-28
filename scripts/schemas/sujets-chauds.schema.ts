/**
 * Zod schema for sujets-chauds.json — trending/hot topics
 * High-intensity news items that everyone is talking about
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

const IntensiteEnum = z.enum(['brulant', 'intense', 'en_montee']);

const FaitChronoSchema = z.object({
  date: z.string(),
  texte: z.string().min(10),
  source: z.string().optional(),
});

const CouvertureChaudSchema = z.object({
  source: z.string(),
  type: SourceTypeEnum,
  angle: z.string().min(10),
  ton: TonEnum,
  url: z.string().url(),
  citation_cle: z.string().optional(),
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
});

const SujetChaudSchema = z.object({
  titre: z.string().min(10),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  intensite: IntensiteEnum.optional(),
  rubrique: RubriqueEnum,
  resume: z.string().min(30),
  chronologie: z.array(FaitChronoSchema).min(2).max(6),
  couvertures: z.array(CouvertureChaudSchema).min(2),
  ce_quon_ne_sait_pas: z.array(z.string()).min(1),
  sources: z.array(SourceRefSchema).min(2),
  premiere_apparition: z.string(),
});

const SujetRefroidiSchema = z.object({
  titre: z.string(),
  slug: z.string(),
  rubrique: RubriqueEnum.optional(),
  resume: z.string().optional(),
  chronologie: z.array(FaitChronoSchema).optional(),
  couvertures: z.array(CouvertureChaudSchema).optional(),
  ce_quon_ne_sait_pas: z.array(z.string()).optional(),
  sources: z.array(SourceRefSchema).optional(),
  derniere_mise_a_jour: z.string(),
  statut: z.string(),
});

const MetaSujetsChaudsSchema = z.object({
  nb_articles_analyses: z.number(),
  modele: z.string(),
  version_pipeline: z.string(),
});

export const SujetsChaudsSchema = z.object({
  date: z.string(),
  genere_a: z.string(),

  sujets_actifs: z.array(SujetChaudSchema).min(1).max(5),
  sujets_refroidis: z.array(SujetRefroidiSchema).default([]),

  meta: MetaSujetsChaudsSchema,
});

export type SujetsChauds = z.infer<typeof SujetsChaudsSchema>;
export type SujetChaud = z.infer<typeof SujetChaudSchema>;
export type Intensite = z.infer<typeof IntensiteEnum>;
