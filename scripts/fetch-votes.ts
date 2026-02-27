/**
 * fetch-votes.ts — Fetch latest scrutins from Assemblée nationale open data
 *
 * Downloads the scrutins ZIP, extracts individual vote JSON files,
 * merges new scrutins into existing votes.json.
 *
 * Usage: npx tsx scripts/fetch-votes.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import unzipper from 'unzipper';

const SCRUTINS_URL =
  'http://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';

interface ScrutinFile {
  scrutin: {
    uid: string;
    numero: string;
    dateScrutin: string;
    titre: string;
    sort: { code: string }; // 'adopté' | 'rejeté'
    syntheseVote: {
      nombreVotants: string;
      suffragesExprimes: string;
      decompte: {
        pour: string;
        contre: string;
        abstention: string;
      };
    };
  };
}

interface Vote {
  id: string;
  scrutin_id: string;
  date: string;
  intitule: string;
  description: string;
  resume: string;
  lien_source: string;
  resultat: 'adopte' | 'rejete';
  pour: number;
  contre: number;
  abstentions: number;
}

async function main() {
  console.log('Fetching scrutins ZIP from data.assemblee-nationale.fr...');

  const resp = await fetch(SCRUTINS_URL, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching scrutins`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);

  console.log(`Found ${directory.files.length} files in ZIP`);

  // Parse all scrutin JSON files
  const newScrutins: Vote[] = [];
  let parseErrors = 0;

  for (const entry of directory.files) {
    if (!entry.path.endsWith('.json')) continue;

    try {
      const content = await entry.buffer();
      const data: ScrutinFile = JSON.parse(content.toString());
      const s = data.scrutin;

      if (!s || !s.uid || !s.dateScrutin) continue;

      const numero = s.numero || s.uid.replace('VTANR5L17V', '');
      const sortCode = s.sort?.code?.toLowerCase() || '';
      const resultat: 'adopte' | 'rejete' = sortCode.includes('adopt') ? 'adopte' : 'rejete';

      const decompte = s.syntheseVote?.decompte;
      const pour = parseInt(decompte?.pour || '0', 10);
      const contre = parseInt(decompte?.contre || '0', 10);
      const abstentions = parseInt(decompte?.abstention || '0', 10);

      newScrutins.push({
        id: `scrutin-${numero}`,
        scrutin_id: numero,
        date: s.dateScrutin,
        intitule: s.titre || `Scrutin n°${numero}`,
        description: '',
        resume: '',
        lien_source: `https://www.assemblee-nationale.fr/dyn/17/scrutins/${numero}`,
        resultat,
        pour,
        contre,
        abstentions,
      });
    } catch {
      parseErrors++;
    }
  }

  console.log(`Parsed ${newScrutins.length} scrutins (${parseErrors} errors)`);

  // Read existing votes.json
  const votesPath = new URL('../src/data/votes.json', import.meta.url);
  let existingVotes: Vote[] = [];
  try {
    existingVotes = JSON.parse(readFileSync(votesPath, 'utf-8'));
  } catch {
    console.log('No existing votes.json found, creating new one');
  }

  // Build a set of existing scrutin IDs (preserve manually written data)
  const existingIds = new Set(existingVotes.map(v => v.scrutin_id));
  const manualVotes = existingVotes.filter(v => existingIds.has(v.scrutin_id));

  // Merge: keep existing votes (which may have hand-written resumes),
  // add new ones not already present
  let addedCount = 0;
  for (const s of newScrutins) {
    if (!existingIds.has(s.scrutin_id)) {
      manualVotes.push(s);
      addedCount++;
    }
  }

  // Sort by date descending
  manualVotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Keep only the most recent 50 votes (avoid bloating the file)
  const finalVotes = manualVotes.slice(0, 50);

  writeFileSync(votesPath, JSON.stringify(finalVotes, null, 2), 'utf-8');

  console.log(`\n✓ ${addedCount} new scrutins added`);
  console.log(`✓ ${finalVotes.length} total votes in votes.json`);
}

main().catch((err) => {
  console.error('Pipeline fetch-votes failed:', err);
  process.exit(1);
});
