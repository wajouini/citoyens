const frenchMonths = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const frenchDays = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
];

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  const day = frenchDays[d.getDay()];
  const num = d.getDate();
  const month = frenchMonths[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${num} ${month} ${year}`;
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()} ${frenchMonths[d.getMonth()]} ${d.getFullYear()}`;
}

export function getInitials(prenom: string, nom: string): string {
  return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();
}
