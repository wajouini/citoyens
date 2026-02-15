import { defineCollection, z } from 'astro:content';
import { file, glob } from 'astro/loaders';

const personnes = defineCollection({
  loader: file('src/data/personnes.json'),
  schema: z.object({
    slug: z.string(),
    nom: z.string(),
    prenom: z.string(),
    nom_complet: z.string(),
    photo: z.string().optional(),
    role: z.enum(['depute', 'senateur', 'journaliste', 'editorialiste', 'ministre']),
    parti: z.object({
      nom: z.string(),
      sigle: z.string(),
      couleur: z.string().optional(),
    }).optional(),
    circonscription: z.string().optional(),
    departement: z.string().optional(),
    bio_courte: z.string(),
    bio_longue: z.string().optional(),
    parcours: z.array(z.object({
      periode: z.string(),
      fonction: z.string(),
    })).default([]),
    commissions: z.array(z.string()).default([]),
    propositions_loi: z.number().default(0),
    questions_ecrites: z.number().default(0),
    taux_participation: z.number().nullable().optional(),
    score_coherence: z.number().nullable().optional(),
    condamnations: z.array(z.string()).default([]),
    votes_recents: z.array(z.object({
      date: z.string(),
      intitule: z.string(),
      position: z.enum(['pour', 'contre', 'abstention', 'absent']),
    })).default([]),
    apparitions_media: z.array(z.object({
      date: z.string(),
      media: z.string(),
      titre: z.string().optional(),
      url: z.string().optional(),
    })).default([]),
    ids_externes: z.object({
      nosdeputes_slug: z.string().optional(),
      assemblee_nationale_id: z.string().optional(),
    }).optional(),
  }),
});

const votes = defineCollection({
  loader: file('src/data/votes.json'),
  schema: z.object({
    scrutin_id: z.string(),
    date: z.string(),
    intitule: z.string(),
    description: z.string().optional(),
    resultat: z.enum(['adopte', 'rejete']),
    pour: z.number(),
    contre: z.number(),
    abstentions: z.number(),
  }),
});

const medias = defineCollection({
  loader: file('src/data/medias.json'),
  schema: z.object({
    id: z.string(),
    titre: z.string(),
    description: z.string().optional(),
    type: z.enum(['youtube', 'article', 'podcast']),
    url: z.string(),
    source: z.string(),
    date: z.string(),
    thumbnail: z.string().optional(),
    tags: z.array(z.string()).default([]),
    personnes_liees: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
  }),
});

const dossiers = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/dossiers' }),
  schema: z.object({
    titre: z.string(),
    description: z.string(),
    statut: z.enum(['en_cours', 'adopte', 'rejete', 'en_commission', 'promulgue']),
    progression: z.number().default(0),
    icone: z.string().default('📄'),
    etape_label: z.string().default('En cours'),
  }),
});

export const collections = { personnes, votes, medias, dossiers };
