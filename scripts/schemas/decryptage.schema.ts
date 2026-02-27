/**
 * Zod schema for LLM-generated décryptages (weekly deep-dives)
 */

import { z } from 'zod';
import { RubriqueEnum, SourceTypeEnum } from './une.schema.js';

const SourceRefSchema = z.object({
  nom: z.string(),
  url: z.string().url(),
  type: SourceTypeEnum,
});

export const DecryptageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  titre: z.string().min(10),
  sous_titre: z.string().min(10),
  rubrique: RubriqueEnum,
  date: z.string(),

  introduction: z.string().min(100),

  sections: z.array(z.object({
    titre: z.string().min(5),
    contenu: z.string().min(100),
  })).min(3).max(8),

  chiffres_cles: z.array(z.object({
    valeur: z.string(),
    contexte: z.string(),
    source: z.string(),
  })).min(2).max(6),

  ce_quil_faut_retenir: z.string().min(50),

  sources: z.array(SourceRefSchema).min(3),

  meta: z.object({
    nb_articles_source: z.number(),
    modele: z.string(),
    version_pipeline: z.string(),
  }),
});

export type Decryptage = z.infer<typeof DecryptageSchema>;
