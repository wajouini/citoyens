export interface StatRepublique {
  theme: string;
  valeur: string;
  description: string;
  tendance: string;
  direction: 'up' | 'down' | 'stable';
}

export const statsRepublique: StatRepublique[] = [
  {
    theme: 'Dette publique',
    valeur: '113%',
    description: 'Ratio dette/PIB',
    tendance: '3 300 Md€ fin 2025',
    direction: 'down',
  },
  {
    theme: 'Déficit',
    valeur: '6.1%',
    description: 'Déficit public 2024',
    tendance: '↑ vs 5.5% prévu',
    direction: 'down',
  },
  {
    theme: 'Éducation',
    valeur: '23è',
    description: 'Rang PISA 2025 (maths)',
    tendance: '↓ 3 places vs 2022',
    direction: 'down',
  },
  {
    theme: 'Santé',
    valeur: '5.7',
    description: 'Lits pour 1 000 hab.',
    tendance: '↓ 0.4 depuis 2019',
    direction: 'down',
  },
  {
    theme: 'Chômage',
    valeur: '7.3%',
    description: 'Taux de chômage T4 2025',
    tendance: '↑ 0.2 pts en 1 an',
    direction: 'down',
  },
  {
    theme: 'Immigration',
    valeur: '12%',
    description: "OQTF exécutées",
    tendance: '323 000 titres de séjour',
    direction: 'down',
  },
  {
    theme: 'Fiscalité',
    valeur: '26%',
    description: 'Taux effectif top 0.1%',
    tendance: 'vs 46% taux marginal',
    direction: 'down',
  },
  {
    theme: 'Défense',
    valeur: '2.1%',
    description: 'Budget défense / PIB',
    tendance: '↑ 0.3 pts depuis 2022',
    direction: 'up',
  },
  {
    theme: 'Confiance',
    valeur: '24%',
    description: 'Font confiance au Parlement',
    tendance: '↓ 6 pts en 2 ans',
    direction: 'down',
  },
  {
    theme: 'Participation',
    valeur: '47%',
    description: 'Taux aux législatives 2024',
    tendance: '↑ 1 pt vs 2022',
    direction: 'up',
  },
];
