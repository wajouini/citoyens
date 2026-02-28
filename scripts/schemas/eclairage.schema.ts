/**
 * Zod schema for LLM-generated éclairages (SEO-optimized news synthesis)
 */

import { z } from 'zod';
import { RubriqueEnum, SourceTypeEnum } from './une.schema.js';

const SourceRefSchema = z.object({
  nom: z.string(),
  url: z.string().url(),
  type: SourceTypeEnum,
});

const FaqItemSchema = z.object({
  question: z.string().min(10),
  reponse: z.string().min(30),
});

const LienInterneSchema = z.object({
  type: z.enum(['fiche', 'dossier', 'decodage', 'decryptage', 'eclairage', 'guide', 'radar', 'comprendre']),
  slug: z.string(),
  titre: z.string(),
});

export const EclairageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  titre: z.string().min(20).max(80),
  meta_description: z.string().min(100).max(170),
  rubrique: RubriqueEnum,

  // SEO keyword targeting
  mot_cle_principal: z.string(),
  mots_cles_secondaires: z.array(z.string()).min(2).max(8),

  // Dates for freshness signals
  date_publication: z.string(),
  date_modification: z.string(),

  // Content
  introduction: z.string().min(100),

  sections: z.array(z.object({
    titre: z.string().min(5),
    contenu: z.string().min(80),
  })).min(2).max(6),

  chiffres_cles: z.array(z.object({
    valeur: z.string(),
    contexte: z.string(),
    source: z.string(),
  })).min(1).max(5),

  // FAQ for featured snippets
  faq: z.array(FaqItemSchema).min(2).max(5),

  ce_quil_faut_retenir: z.string().min(50),

  // Internal linking
  liens_internes: z.array(LienInterneSchema).default([]),
  guide_parent: z.string().nullable().optional(),

  sources: z.array(SourceRefSchema).min(2),

  meta: z.object({
    nb_articles_source: z.number(),
    modele: z.string(),
    version_pipeline: z.string(),
  }),
});

export type Eclairage = z.infer<typeof EclairageSchema>;
