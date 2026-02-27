import { defineCollection, z } from 'astro:content';
import { file, glob } from 'astro/loaders';

const personnes = defineCollection({
  loader: file('src/data/personnes.json'),
  schema: z.object({
    slug: z.string(),
    nom: z.string(),
    prenom: z.string(),
    nom_complet: z.string(),
    photo_url: z.string().optional(),
    role: z.enum(['depute', 'senateur', 'journaliste', 'editorialiste', 'ministre']),
    parti: z.object({
      nom: z.string(),
      sigle: z.string(),
      couleur: z.string().optional(),
    }).optional(),
    groupe_parlementaire: z.string().optional(),
    circonscription: z.string().optional(),
    departement: z.string().optional(),
    date_naissance: z.string().optional(),
    age: z.number().nullable().optional(),
    profession: z.string().optional(),
    email: z.string().optional(),
    twitter: z.string().optional(),
    nb_mandats: z.number().nullable().optional(),
    date_prise_fonction: z.string().optional(),
    bio_courte: z.string(),
    bio_longue: z.string().optional(),
    tldr: z.array(z.string()).optional(),
    lien_fiche_an: z.string().optional(),
    parcours: z.array(z.object({
      periode: z.string(),
      fonction: z.string(),
    })).default([]),
    commissions: z.array(z.string()).default([]),
    propositions_loi: z.number().default(0),
    questions_ecrites: z.number().default(0),
    taux_participation: z.number().nullable().optional(),
    score_loyaute: z.number().nullable().optional(),
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
    resume: z.string().optional(),
    lien_source: z.string().optional(),
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
    date_maj: z.string().optional(),
    tldr: z.array(z.string()).optional(),
    contexte: z.string().optional(),
    enjeux: z.array(z.object({
      titre: z.string(),
      description: z.string(),
    })).default([]),
    chiffres: z.array(z.object({
      indicateur: z.string(),
      valeur: z.string(),
      source: z.string(),
      source_url: z.string().optional(),
    })).default([]),
    chronologie: z.array(z.object({
      date: z.string(),
      evenement: z.string(),
      statut: z.enum(['passe', 'en_cours', 'prevu']).default('passe'),
    })).default([]),
    arguments_pour: z.array(z.string()).default([]),
    arguments_contre: z.array(z.string()).default([]),
    positions: z.array(z.object({
      groupe: z.string(),
      position: z.enum(['pour', 'contre', 'mitige', 'abstention']),
      resume: z.string(),
    })).default([]),
    sources: z.array(z.object({
      titre: z.string(),
      url: z.string(),
      type: z.enum(['officiel', 'presse', 'analyse']).default('presse'),
    })).default([]),
    acteurs_cles: z.array(z.object({
      nom: z.string(),
      role: z.string(),
      slug: z.string().optional(),
    })).default([]),
  }),
});

const decodages = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/decodages' }),
  schema: z.object({
    question: z.string(),
    reponse_courte: z.string(),
    categorie: z.enum(['economie', 'immigration', 'institutions', 'social', 'environnement', 'securite']),
    icone: z.string().default('🔍'),
    date_maj: z.string().optional(),
    chiffres: z.array(z.object({
      indicateur: z.string(),
      valeur: z.string(),
      source: z.string(),
      source_url: z.string().optional(),
    })).default([]),
    arguments: z.array(z.object({
      camp: z.string(),
      argument: z.string(),
      source: z.string().optional(),
      source_url: z.string().optional(),
    })).default([]),
    idees_recues: z.array(z.object({
      affirmation: z.string(),
      realite: z.string(),
      source: z.string().optional(),
      source_url: z.string().optional(),
    })).default([]),
    positions: z.array(z.object({
      groupe: z.string(),
      position: z.enum(['pour', 'contre', 'mitige', 'abstention']),
      resume: z.string(),
    })).default([]),
    sources: z.array(z.object({
      titre: z.string(),
      url: z.string(),
      type: z.enum(['officiel', 'presse', 'analyse']).default('presse'),
    })).default([]),
    dossiers_lies: z.array(z.string()).default([]),
  }),
});

export const collections = { personnes, votes, medias, dossiers, decodages };
