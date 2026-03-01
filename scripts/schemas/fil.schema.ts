/**
 * Zod schema for fil.json — continuous factual ticker
 * Short timestamped updates throughout the day, no analysis
 */

import { z } from 'zod';
import { RubriqueEnum, SourceTypeEnum } from './une.schema.js';

const GroupeMediaRefSchema = z.object({
  nom: z.string(),
  proprietaire: z.string(),
  type_proprietaire: z.enum(['milliardaire', 'cooperative', 'etat', 'fondation', 'employes', 'independant', 'famille']),
  orientation: z.string(),
});

const FilItemSchema = z.object({
  heure: z.string(),
  titre: z.string().min(10),
  resume: z.string().optional().nullable(),
  url: z.string().url().optional().nullable(),
  rubrique: RubriqueEnum,
  source: z.string(),
  source_url: z.string().url().optional().nullable(),
  pays: z.string().optional().nullable(),
  langue: z.string().optional().nullable(),
  source_type: SourceTypeEnum.optional(),
  orientation: z.string().optional().nullable(),
  groupe_media: GroupeMediaRefSchema.optional().nullable(),
  isoDate: z.string().optional(),
});

const MetaFilSchema = z.object({
  nb_articles_analyses: z.number(),
  modele: z.string(),
  version_pipeline: z.string(),
});

export const FilSchema = z.object({
  date: z.string(),
  genere_a: z.string(),
  items: z.array(FilItemSchema).min(1),
  meta: MetaFilSchema,
});

export type Fil = z.infer<typeof FilSchema>;
export type FilItem = z.infer<typeof FilItemSchema>;
