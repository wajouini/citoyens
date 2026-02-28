/**
 * Zod schema for LLM-generated guides (SEO pillar/evergreen content)
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

const ChapitreSchema = z.object({
  titre: z.string().min(5),
  slug_ancre: z.string().regex(/^[a-z0-9-]+$/),
  contenu: z.string().min(200),
  sous_sections: z.array(z.object({
    titre: z.string().min(5),
    contenu: z.string().min(80),
  })).default([]),
});

export const GuideSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  titre: z.string().min(20).max(80),
  meta_description: z.string().min(100).max(170),
  rubrique: RubriqueEnum,

  // SEO keyword targeting
  mot_cle_principal: z.string(),
  mots_cles_secondaires: z.array(z.string()).min(3).max(12),

  // Dates
  date_publication: z.string(),
  date_modification: z.string(),

  // Content
  introduction: z.string().min(200),

  chapitres: z.array(ChapitreSchema).min(3).max(10),

  chiffres_cles: z.array(z.object({
    valeur: z.string(),
    contexte: z.string(),
    source: z.string(),
    source_url: z.string().url().optional(),
  })).min(3).max(10),

  // FAQ for featured snippets
  faq: z.array(FaqItemSchema).min(3).max(8),

  // Related éclairages (child content)
  eclairages_lies: z.array(z.string()).default([]),

  // Internal linking
  liens_internes: z.array(LienInterneSchema).default([]),

  // Sidebar curated links
  lectures_essentielles: z.array(z.object({
    titre: z.string(),
    url: z.string(),
    type: z.enum(['interne', 'externe']),
  })).default([]),

  conclusion: z.string().min(100),

  sources: z.array(SourceRefSchema).min(5),

  meta: z.object({
    nb_articles_source: z.number(),
    modele: z.string(),
    version_pipeline: z.string(),
  }),
});

export type Guide = z.infer<typeof GuideSchema>;
