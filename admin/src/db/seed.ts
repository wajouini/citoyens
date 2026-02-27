/**
 * seed.ts — Seed the feeds table with the 26 hardcoded RSS sources
 *
 * Usage: DATABASE_URL=... npx tsx src/db/seed.ts
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { feeds } from './schema';

const FEEDS_SEED = [
  // === INVESTIGATION ===
  { nom: 'Mediapart', url: 'https://www.mediapart.fr/articles/feed', type: 'investigation' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'Blast', url: 'https://www.blast-info.fr/feed', type: 'investigation' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'StreetPress', url: 'https://www.streetpress.com/feed', type: 'investigation' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'Disclose', url: 'https://disclose.ngo/fr/feed/', type: 'investigation' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'Basta!', url: 'https://basta.media/spip.php?page=backend', type: 'investigation' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },

  // === MAINSTREAM ===
  { nom: 'Le Monde', url: 'https://www.lemonde.fr/politique/rss_full.xml', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'Libération', url: 'https://www.liberation.fr/arc/outboundfeeds/rss-all/collection/accueil-une/', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: "L'Humanité", url: 'https://www.humanite.fr/feed', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'franceinfo', url: 'https://www.francetvinfo.fr/politique.rss', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'France 24 FR', url: 'https://www.france24.com/fr/france/rss', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'RFI', url: 'https://www.rfi.fr/fr/france/rss', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'BFM TV', url: 'https://www.bfmtv.com/rss/politique/', type: 'mainstream' as const, pays: 'France', langue: 'fr' as const, fiabilite: 3 },

  // === FACT-CHECKING ===
  { nom: 'Les Décodeurs', url: 'https://www.lemonde.fr/les-decodeurs/rss_full.xml', type: 'fact-check' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'CheckNews', url: 'https://www.liberation.fr/arc/outboundfeeds/rss-all/collection/checknews/', type: 'fact-check' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },

  // === PRESSE ÉTRANGÈRE ===
  { nom: 'The Guardian', url: 'https://www.theguardian.com/world/france/rss', type: 'etranger' as const, pays: 'Royaume-Uni', langue: 'en' as const, fiabilite: 5 },
  { nom: 'BBC Europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', type: 'etranger' as const, pays: 'Royaume-Uni', langue: 'en' as const, fiabilite: 5 },
  { nom: 'Der Spiegel', url: 'https://www.spiegel.de/international/index.rss', type: 'etranger' as const, pays: 'Allemagne', langue: 'en' as const, fiabilite: 5 },
  { nom: 'Politico EU', url: 'https://www.politico.eu/feed/', type: 'etranger' as const, pays: 'Europe', langue: 'en' as const, fiabilite: 5 },
  { nom: 'Euractiv', url: 'https://www.euractiv.com/sections/politics/feed/', type: 'etranger' as const, pays: 'Europe', langue: 'en' as const, fiabilite: 4 },
  { nom: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', type: 'etranger' as const, pays: 'Qatar', langue: 'en' as const, fiabilite: 4 },
  { nom: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'etranger' as const, pays: 'États-Unis', langue: 'en' as const, fiabilite: 5 },
  { nom: 'Swissinfo', url: 'https://www.swissinfo.ch/fre/all-news/rss', type: 'etranger' as const, pays: 'Suisse', langue: 'fr' as const, fiabilite: 4 },
  { nom: 'France 24 EN', url: 'https://www.france24.com/en/france/rss', type: 'etranger' as const, pays: 'France', langue: 'en' as const, fiabilite: 4 },

  // === INSTITUTIONNEL ===
  { nom: 'Assemblée nationale', url: 'https://www2.assemblee-nationale.fr/rss/actualites.xml', type: 'institutionnel' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'Sénat', url: 'https://www.senat.fr/rss/derniers_dossiers_legislatifs.xml', type: 'institutionnel' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
  { nom: 'Vie publique', url: 'https://www.vie-publique.fr/rss.xml', type: 'institutionnel' as const, pays: 'France', langue: 'fr' as const, fiabilite: 5 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL not set');
    process.exit(1);
  }

  const sql = neon(url);
  const database = drizzle(sql);

  console.log('Seeding feeds...');

  for (const feed of FEEDS_SEED) {
    try {
      await database.insert(feeds).values({
        nom: feed.nom,
        url: feed.url,
        type: feed.type,
        pays: feed.pays,
        langue: feed.langue,
        fiabilite: feed.fiabilite,
        active: true,
      }).onConflictDoNothing();
      console.log(`  ✓ ${feed.nom}`);
    } catch (err: any) {
      console.error(`  ✗ ${feed.nom}: ${err.message}`);
    }
  }

  console.log(`\n✓ Seeded ${FEEDS_SEED.length} feeds`);
}

main().catch(console.error);
