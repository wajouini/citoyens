/**
 * Fetch real deputy data from data.gouv.fr CSV
 * Source: https://www.data.gouv.fr/fr/datasets/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/
 *
 * Usage: npx tsx scripts/fetch-deputes.ts
 */

const CSV_URL =
  'https://static.data.gouv.fr/resources/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/20260215-210804/deputes-active.csv';

const FALLBACK_CSV_URL =
  'https://www.data.gouv.fr/api/1/datasets/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/';

interface CsvRow {
  id: string;
  legislature: string;
  civ: string;
  nom: string;
  prenom: string;
  villeNaissance: string;
  naissance: string;
  age: string;
  groupe: string;
  groupeAbrev: string;
  departementNom: string;
  departementCode: string;
  circo: string;
  datePriseFonction: string;
  job: string;
  mail: string;
  twitter: string;
  facebook: string;
  website: string;
  nombreMandats: string;
  experienceDepute: string;
  scoreParticipation: string;
  scoreParticipationSpecialite: string;
  scoreLoyaute: string;
  scoreMajorite: string;
  dateMaj: string;
  [key: string]: string;
}

// Map known groupe abbreviations to full names and colors
// Covers all 17th legislature groups + common CSV variants
const groupeInfo: Record<string, { nom: string; couleur: string }> = {
  EPR: { nom: 'Ensemble pour la République', couleur: '#000091' },
  RN: { nom: 'Rassemblement National', couleur: '#0D378A' },
  'LFI-NFP': { nom: 'La France Insoumise - NFP', couleur: '#CC2443' },
  SOC: { nom: 'Socialistes et apparentés', couleur: '#FF8080' },
  DR: { nom: 'Droite Républicaine', couleur: '#0066CC' },
  Dem: { nom: 'Les Démocrates', couleur: '#FF9900' },
  DEM: { nom: 'Les Démocrates', couleur: '#FF9900' },
  HOR: { nom: 'Horizons et apparentés', couleur: '#00B0F0' },
  EcoS: { nom: 'Écologiste et Social', couleur: '#00C000' },
  ECOS: { nom: 'Écologiste et Social', couleur: '#00C000' },
  LIOT: { nom: 'Libertés, Indépendants, Outre-mer et Territoires', couleur: '#8B6914' },
  GDR: { nom: 'Gauche Démocrate et Républicaine', couleur: '#C41E3A' },
  NI: { nom: 'Non-inscrits', couleur: '#999999' },
  UDR: { nom: 'Union des droites pour la République', couleur: '#1B3F8B' },
  UDRL: { nom: 'Union des droites pour la République', couleur: '#1B3F8B' },
  UDDPLR: { nom: 'Union des droites pour la République', couleur: '#1B3F8B' },
};

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row as CsvRow);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function toNumber(val: string): number | null {
  if (!val || val === 'NA' || val === '') return null;
  const n = parseFloat(val.replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/** Convert a 0-1 score to a 0-100 percentage, rounded to 1 decimal */
function toPercent(val: string): number | null {
  if (!val || val === 'NA' || val === '') return null;
  const n = parseFloat(val.replace(',', '.'));
  if (isNaN(n)) return null;
  // Scores from CSV are in 0-1 range, convert to percentage
  const pct = n * 100;
  return Math.round(pct * 10) / 10;
}

async function main() {
  console.log('Fetching deputies CSV from data.gouv.fr...');

  let csvText: string;
  try {
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    csvText = await resp.text();
  } catch (err) {
    console.log('Primary URL failed, trying API discovery...');
    const apiResp = await fetch(FALLBACK_CSV_URL);
    const apiData = await apiResp.json();
    const csvResource = apiData.resources?.find(
      (r: { format: string }) => r.format?.toLowerCase() === 'csv'
    );
    if (!csvResource?.url) throw new Error('No CSV resource found');
    const resp = await fetch(csvResource.url);
    csvText = await resp.text();
  }

  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} deputies`);

  // Deduplicate by slug (handle name collisions)
  const slugCounts = new Map<string, number>();

  const personnes = rows.map((row) => {
    const prenom = row.prenom?.trim() || '';
    const nom = row.nom?.trim() || '';
    const nomComplet = `${prenom} ${nom}`;
    let baseSlug = slugify(nomComplet);

    // Handle duplicate slugs
    const count = slugCounts.get(baseSlug) || 0;
    slugCounts.set(baseSlug, count + 1);
    const slug = count > 0 ? `${baseSlug}-${count + 1}` : baseSlug;

    const groupeAbrev = row.groupeAbrev?.trim() || '';
    const groupe = groupeInfo[groupeAbrev] || {
      nom: row.groupe?.trim() || groupeAbrev,
      couleur: '#6B7280',
    };

    const numCirco = row.circo?.trim() || '';
    const departementNom = row.departementNom?.trim() || '';
    const ordinalCirco = numCirco ? (numCirco === '1' ? '1re' : `${numCirco}e`) : '';
    // French elision rules for department names
    const firstChar = departementNom.charAt(0).toLowerCase();
    const isVowelOrH = 'aeiouhéèêàùîôâ'.includes(firstChar);
    const deptPrefix = departementNom
      ? (departementNom.startsWith('d') || departementNom.startsWith("l'") || departementNom.startsWith("La ") ? ''
         : isVowelOrH ? "d'" : 'de ')
      : '';
    const circonscription = numCirco && departementNom
      ? `${ordinalCirco} circ. ${deptPrefix}${departementNom}`
      : '';

    const taux = toPercent(row.scoreParticipation);
    const loyaute = toPercent(row.scoreLoyaute);

    const bioElements: string[] = [];
    if (row.civ === 'M.') {
      bioElements.push(`Député`);
    } else {
      bioElements.push(`Députée`);
    }
    if (groupeAbrev && groupeAbrev !== 'NI') {
      bioElements[0] += ` ${groupe.nom}`;
    } else if (groupeAbrev === 'NI') {
      bioElements[0] += ` non inscrit${row.civ === 'Mme' ? 'e' : ''}`;
    }
    if (departementNom) {
      bioElements.push(departementNom);
    }
    if (numCirco) {
      bioElements.push(`${ordinalCirco} circonscription`);
    }
    const bio_courte = bioElements.join(', ') + '.';

    return {
      id: slug,
      slug,
      nom,
      prenom,
      nom_complet: nomComplet,
      role: 'depute' as const,
      parti: {
        nom: groupe.nom,
        sigle: groupeAbrev,
        couleur: groupe.couleur,
      },
      groupe_parlementaire: groupeAbrev,
      circonscription,
      departement: departementNom,
      bio_courte,
      photo_url: row.id ? `https://www.assemblee-nationale.fr/dyn/deputes/${row.id}/photo` : undefined,
      lien_fiche_an: row.id ? `https://www.assemblee-nationale.fr/dyn/deputes/${row.id}` : undefined,
      parcours: [
        {
          periode: `${(row.datePriseFonction?.trim() || '2024').substring(0, 4)}-présent`,
          fonction: numCirco && departementNom
            ? `Député${row.civ === 'Mme' ? 'e' : ''} de la ${ordinalCirco} circ. ${deptPrefix}${departementNom}`
            : departementNom
              ? `Député${row.civ === 'Mme' ? 'e' : ''} ${deptPrefix}${departementNom}`
              : `Député${row.civ === 'Mme' ? 'e' : ''}`,
        },
      ],
      commissions: [],
      propositions_loi: 0,
      questions_ecrites: 0,
      taux_participation: taux,
      score_loyaute: loyaute,
      condamnations: [],
      votes_recents: [],
      apparitions_media: [],
      ids_externes: {
        assemblee_nationale_id: row.id?.trim() || undefined,
      },
    };
  });

  // Sort by name
  personnes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const outputPath = new URL('../src/data/personnes.json', import.meta.url);
  const fs = await import('node:fs');
  fs.writeFileSync(new URL(outputPath), JSON.stringify(personnes, null, 2), 'utf-8');

  console.log(`✓ Wrote ${personnes.length} deputies to src/data/personnes.json`);

  // Print some stats
  const groups = new Map<string, number>();
  for (const p of personnes) {
    const g = p.groupe_parlementaire || 'NI';
    groups.set(g, (groups.get(g) || 0) + 1);
  }
  console.log('\nGroupes parlementaires:');
  for (const [g, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g}: ${count}`);
  }
}

main().catch(console.error);
