/**
 * Fetch real deputy data from data.gouv.fr CSV + enrichment from AN open data
 * Source: https://www.data.gouv.fr/fr/datasets/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/
 * Enrichment: https://data.assemblee-nationale.fr/acteurs/deputes-en-exercice
 *
 * Usage: npx tsx scripts/fetch-deputes.ts
 */

const CSV_URL =
  'https://static.data.gouv.fr/resources/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/20260215-210804/deputes-active.csv';

const FALLBACK_CSV_URL =
  'https://www.data.gouv.fr/api/1/datasets/deputes-actifs-de-lassemblee-nationale-informations-et-statistiques/';

// AN bulk JSON for commission enrichment
const AN_BULK_URL =
  'http://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip';

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
  EPR: { nom: 'Ensemble pour la R\u00e9publique', couleur: '#000091' },
  RN: { nom: 'Rassemblement National', couleur: '#0D378A' },
  'LFI-NFP': { nom: 'La France Insoumise - NFP', couleur: '#CC2443' },
  SOC: { nom: 'Socialistes et apparent\u00e9s', couleur: '#FF8080' },
  DR: { nom: 'Droite R\u00e9publicaine', couleur: '#0066CC' },
  Dem: { nom: 'Les D\u00e9mocrates', couleur: '#FF9900' },
  DEM: { nom: 'Les D\u00e9mocrates', couleur: '#FF9900' },
  HOR: { nom: 'Horizons et apparent\u00e9s', couleur: '#00B0F0' },
  EcoS: { nom: '\u00c9cologiste et Social', couleur: '#00C000' },
  ECOS: { nom: '\u00c9cologiste et Social', couleur: '#00C000' },
  LIOT: { nom: 'Libert\u00e9s, Ind\u00e9pendants, Outre-mer et Territoires', couleur: '#8B6914' },
  GDR: { nom: 'Gauche D\u00e9mocrate et R\u00e9publicaine', couleur: '#C41E3A' },
  NI: { nom: 'Non-inscrits', couleur: '#999999' },
  UDR: { nom: 'Union des droites pour la R\u00e9publique', couleur: '#1B3F8B' },
  UDRL: { nom: 'Union des droites pour la R\u00e9publique', couleur: '#1B3F8B' },
  UDDPLR: { nom: 'Union des droites pour la R\u00e9publique', couleur: '#1B3F8B' },
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

/** Try to fetch commission data from AN bulk JSON */
async function fetchCommissions(): Promise<Map<string, { commissions: string[]; profession?: string; dateNaissance?: string; email?: string; twitter?: string }>> {
  const enrichmentMap = new Map<string, { commissions: string[]; profession?: string; dateNaissance?: string; email?: string; twitter?: string }>();

  try {
    console.log('Fetching AN bulk JSON for commission enrichment...');
    const resp = await fetch(AN_BULK_URL, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      console.log(`AN bulk download failed: HTTP ${resp.status}, skipping enrichment`);
      return enrichmentMap;
    }

    // The response is a ZIP file, we need to decompress it
    const buffer = await resp.arrayBuffer();
    const { Readable } = await import('node:stream');
    const { createGunzip } = await import('node:zlib');
    const { default: unzipper } = await import('unzipper');

    // Parse the ZIP
    const entries: any[] = [];
    const directory = await unzipper.Open.buffer(Buffer.from(buffer));

    // Build organe name lookup from organes/ files
    const organeNames = new Map<string, string>();
    const deputeFiles: any[] = [];

    for (const entry of directory.files) {
      if (entry.path.includes('organe/') && entry.path.endsWith('.json')) {
        try {
          const content = await entry.buffer();
          const organe = JSON.parse(content.toString());
          const o = organe.organe;
          if (o) {
            const uid = typeof o.uid === 'string' ? o.uid : o.uid?.['#text'] || '';
            const libelle = o.libelle || o.libelleAbrege || '';
            if (uid && libelle) {
              organeNames.set(uid, libelle);
            }
          }
        } catch {}
      } else if (entry.path.includes('acteur/') && entry.path.endsWith('.json')) {
        deputeFiles.push(entry);
      }
    }

    console.log(`Found ${organeNames.size} organes, ${deputeFiles.length} deputy files`);

    for (const entry of deputeFiles) {
      try {
        const content = await entry.buffer();
        const data = JSON.parse(content.toString());
        const acteur = data.acteur;
        if (!acteur?.uid) continue;

        // uid can be a string or an object with '#text'
        const rawUid = acteur.uid;
        const paId = typeof rawUid === 'string' ? rawUid : rawUid?.['#text'] || ''; // e.g., PA794478
        const commissions: string[] = [];

        // Extract commissions from mandats
        const mandats = acteur.mandats?.mandat;
        const mandatList = Array.isArray(mandats) ? mandats : mandats ? [mandats] : [];

        for (const mandat of mandatList) {
          // COMPER = permanent commission (dateFin === null means active)
          if (mandat.typeOrgane === 'COMPER' && (mandat.dateFin === null || mandat.dateFin === undefined || mandat.dateFin === '')) {
            const orgId = mandat.organes?.organeRef;
            if (orgId && organeNames.has(orgId)) {
              const commName = organeNames.get(orgId)!;
              if (!commissions.includes(commName)) {
                commissions.push(commName);
              }
            }
          }
        }

        // Extract profession
        const profession = acteur.profession?.libelleCourant || undefined;

        // Extract date of birth (can be ISO datetime or just date)
        const rawDate = acteur.etatCivil?.infoNaissance?.dateNais;
        const dateNaissance = rawDate
          ? rawDate.substring(0, 10)
          : undefined;

        // Extract email and social from adresses
        let email: string | undefined;
        let twitter: string | undefined;
        const adresses = acteur.adresses?.adresse;
        const adresseList = Array.isArray(adresses) ? adresses : adresses ? [adresses] : [];
        for (const addr of adresseList) {
          if (addr.typeLibelle === 'Mél' || addr['xsi:type'] === 'AdresseMail_Type') {
            if (addr.valElec && !email) email = addr.valElec;
          }
          if (addr.typeLibelle === 'Twitter' || (addr.typeLibelle?.includes?.('Twitter'))) {
            if (addr.valElec && !twitter) {
              twitter = addr.valElec.replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitter\.com\//, '').replace(/^https?:\/\/(www\.)?x\.com\//, '');
            }
          }
        }

        enrichmentMap.set(paId, { commissions, profession, dateNaissance, email, twitter });
      } catch {}
    }

    console.log(`Enriched ${enrichmentMap.size} deputies with AN data`);
  } catch (err) {
    console.log(`AN enrichment failed: ${err}, continuing with CSV data only`);
  }

  return enrichmentMap;
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
  console.log(`Parsed ${rows.length} deputies from CSV`);

  // Try to fetch commission enrichment from AN
  const anData = await fetchCommissions();

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
    const isVowelOrH = 'aeiouh\u00e9\u00e8\u00ea\u00e0\u00f9\u00ee\u00f4\u00e2'.includes(firstChar);
    const deptPrefix = departementNom
      ? (departementNom.startsWith('d') || departementNom.startsWith("l'") || departementNom.startsWith("La ") ? ''
         : isVowelOrH ? "d'" : 'de ')
      : '';
    const circonscription = numCirco && departementNom
      ? `${ordinalCirco} circ. ${deptPrefix}${departementNom}`
      : '';

    const taux = toPercent(row.scoreParticipation);
    const loyaute = toPercent(row.scoreLoyaute);

    // Extract data from CSV that we weren't using before
    const csvEmail = row.mail?.trim() || undefined;
    const csvTwitter = row.twitter?.trim() || undefined;
    const csvAge = row.age?.trim() ? parseInt(row.age.trim()) : null;
    const csvNaissance = row.naissance?.trim() || undefined;
    const csvJob = row.job?.trim() || undefined;
    const csvNbMandats = row.nombreMandats?.trim() ? parseInt(row.nombreMandats.trim()) : null;
    const csvDatePrise = row.datePriseFonction?.trim() || undefined;

    // AN enrichment (commissions, profession, date of birth, email, twitter)
    const paId = row.id?.trim() || '';
    const anEnrichment = anData.get(paId);

    // Merge: prefer AN data where available, fallback to CSV
    const commissions = anEnrichment?.commissions || [];
    const profession = anEnrichment?.profession || csvJob || undefined;
    const dateNaissance = anEnrichment?.dateNaissance || csvNaissance || undefined;
    const email = csvEmail || anEnrichment?.email || undefined;
    const twitter = csvTwitter || anEnrichment?.twitter || undefined;

    // Compute age from date of birth if CSV doesn't have it
    let age = csvAge;
    if (!age && dateNaissance) {
      const birthDate = new Date(dateNaissance);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    const bioElements: string[] = [];
    if (row.civ === 'M.') {
      bioElements.push(`D\u00e9put\u00e9`);
    } else {
      bioElements.push(`D\u00e9put\u00e9e`);
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
      date_naissance: dateNaissance || undefined,
      age: age || undefined,
      profession: profession || undefined,
      email: email || undefined,
      twitter: twitter || undefined,
      nb_mandats: csvNbMandats || undefined,
      date_prise_fonction: csvDatePrise || undefined,
      bio_courte,
      photo_url: row.id ? `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${row.id.replace('PA', '')}.jpg` : undefined,
      lien_fiche_an: row.id ? `https://www.assemblee-nationale.fr/dyn/deputes/${row.id}` : undefined,
      parcours: [
        {
          periode: `${(row.datePriseFonction?.trim() || '2024').substring(0, 4)}-pr\u00e9sent`,
          fonction: numCirco && departementNom
            ? `D\u00e9put\u00e9${row.civ === 'Mme' ? 'e' : ''} de la ${ordinalCirco} circ. ${deptPrefix}${departementNom}`
            : departementNom
              ? `D\u00e9put\u00e9${row.civ === 'Mme' ? 'e' : ''} ${deptPrefix}${departementNom}`
              : `D\u00e9put\u00e9${row.civ === 'Mme' ? 'e' : ''}`,
        },
      ],
      commissions,
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

  console.log(`\u2713 Wrote ${personnes.length} deputies to src/data/personnes.json`);

  // Print some stats
  const groups = new Map<string, number>();
  let withCommissions = 0;
  let withEmail = 0;
  let withTwitter = 0;
  let withProfession = 0;
  for (const p of personnes) {
    const g = p.groupe_parlementaire || 'NI';
    groups.set(g, (groups.get(g) || 0) + 1);
    if (p.commissions.length > 0) withCommissions++;
    if (p.email) withEmail++;
    if (p.twitter) withTwitter++;
    if (p.profession) withProfession++;
  }
  console.log('\nGroupes parlementaires:');
  for (const [g, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g}: ${count}`);
  }
  console.log(`\nEnrichment stats:`);
  console.log(`  With commissions: ${withCommissions}/${personnes.length}`);
  console.log(`  With email: ${withEmail}/${personnes.length}`);
  console.log(`  With Twitter: ${withTwitter}/${personnes.length}`);
  console.log(`  With profession: ${withProfession}/${personnes.length}`);
}

main().catch(console.error);
