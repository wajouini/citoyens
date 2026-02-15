export const partiColors: Record<string, string> = {
  'Renaissance': '#000091',
  'RE': '#000091',
  'LFI': '#CC2443',
  'RN': '#0D378A',
  'LR': '#0066CC',
  'PS': '#FF8080',
  'EELV': '#00C000',
  'PCF': '#DD0000',
  'MoDem': '#FF9900',
  'Horizons': '#00B0F0',
  'LIOT': '#8B6914',
  'GDR': '#C41E3A',
  'Non inscrit': '#999999',
};

export function getPartiColor(sigle: string): string {
  return partiColors[sigle] ?? '#6B7280';
}

export const roleColors: Record<string, { bg: string; text: string; border: string }> = {
  depute: { bg: 'bg-bleu-clair', text: 'text-bleu-rep', border: 'border-bleu-rep' },
  senateur: { bg: 'bg-red-50', text: 'text-rouge-rep', border: 'border-rouge-rep' },
  journaliste: { bg: 'bg-orange-50', text: 'text-orange', border: 'border-orange' },
  editorialiste: { bg: 'bg-orange-50', text: 'text-orange', border: 'border-orange' },
  ministre: { bg: 'bg-bleu-clair', text: 'text-bleu-rep', border: 'border-bleu-rep' },
};

export const roleLabels: Record<string, string> = {
  depute: 'Député·e',
  senateur: 'Sénateur·rice',
  journaliste: 'Journaliste',
  editorialiste: 'Éditorialiste',
  ministre: 'Ministre',
};

export function getCoherenceColor(score: number): string {
  if (score >= 70) return '#18753C';
  if (score >= 50) return '#D4760A';
  return '#C9191E';
}
