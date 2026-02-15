export interface StatRepublique {
  theme: string;
  valeur: string;
  description: string;
  tendance: string;
  direction: 'up' | 'down' | 'stable';
}

export const statsRepublique: StatRepublique[] = [
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
];
