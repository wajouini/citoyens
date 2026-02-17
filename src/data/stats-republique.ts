export interface StatRepublique {
  theme: string;
  valeur: string;
  description: string;
  tendance: string;
  direction: 'up' | 'down' | 'stable';
  source: string;
  source_url: string;
}

export const statsRepublique: StatRepublique[] = [
  {
    theme: 'Dette publique',
    valeur: '113%',
    description: 'Ratio dette/PIB',
    tendance: '3 300 Md€ fin 2025',
    direction: 'down',
    source: 'INSEE',
    source_url: 'https://www.insee.fr/fr/statistiques/2830301',
  },
  {
    theme: 'Déficit',
    valeur: '5.8%',
    description: 'Déficit public 2024',
    tendance: '↑ vs 4.4% prévu en PLF',
    direction: 'down',
    source: 'INSEE',
    source_url: 'https://www.insee.fr/fr/metadonnees/source/serie/s1185',
  },
  {
    theme: 'Éducation',
    valeur: '23è',
    description: 'Rang PISA 2025 (maths)',
    tendance: '↓ 3 places vs 2022',
    direction: 'down',
    source: 'OCDE PISA',
    source_url: 'https://www.oecd.org/fr/pisa/',
  },
  {
    theme: 'Santé',
    valeur: '5.7',
    description: 'Lits pour 1 000 hab.',
    tendance: '↓ 0.4 depuis 2019',
    direction: 'down',
    source: 'DREES',
    source_url: 'https://drees.solidarites-sante.gouv.fr/publications-communique-de-presse/panoramas-de-la-drees/les-etablissements-de-sante',
  },
  {
    theme: 'Chômage',
    valeur: '7.3%',
    description: 'Taux de chômage T4 2025',
    tendance: '↑ 0.2 pts en 1 an',
    direction: 'down',
    source: 'INSEE',
    source_url: 'https://www.insee.fr/fr/statistiques/serie/001688525',
  },
  {
    theme: 'Immigration',
    valeur: '12%',
    description: "OQTF exécutées",
    tendance: '323 000 titres de séjour',
    direction: 'down',
    source: 'Min. Intérieur',
    source_url: 'https://www.immigration.interieur.gouv.fr/Info-ressources/Etudes-et-statistiques/Statistiques/Essentiel-de-l-immigration/Chiffres-cles',
  },
  {
    theme: 'Fiscalité',
    valeur: '26%',
    description: 'Taux effectif top 0.1%',
    tendance: 'vs 46% taux marginal',
    direction: 'down',
    source: 'IPP',
    source_url: 'https://www.ipp.eu/publication/fiscalite-des-hauts-revenus/',
  },
  {
    theme: 'Défense',
    valeur: '2.1%',
    description: 'Budget défense / PIB',
    tendance: '↑ 0.3 pts depuis 2022',
    direction: 'up',
    source: 'Min. Armées',
    source_url: 'https://www.defense.gouv.fr/loi-programmation-militaire-2024-2030',
  },
  {
    theme: 'Confiance',
    valeur: '24%',
    description: 'Font confiance au Parlement',
    tendance: '↓ 6 pts en 2 ans',
    direction: 'down',
    source: 'CEVIPOF',
    source_url: 'https://www.sciencespo.fr/cevipof/fr/etudes-enquetes/barometre-confiance-politique/',
  },
  {
    theme: 'Participation',
    valeur: '47%',
    description: 'Taux aux législatives 2024',
    tendance: '↑ 1 pt vs 2022',
    direction: 'up',
    source: 'Min. Intérieur',
    source_url: 'https://www.resultats-elections.interieur.gouv.fr/legislatives2024/',
  },
];
