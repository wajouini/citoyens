/**
 * validate-data.ts
 *
 * Lightweight structural validation for JSON data files at build time.
 * Returns the data if valid, null with a console warning if not.
 *
 * This is intentionally simple — the full Zod validation runs at generation time.
 * This layer catches corrupted or missing data before it reaches the user.
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  data: T | null;
  valid: boolean;
  errors: ValidationError[];
}

function check(errors: ValidationError[], condition: boolean, field: string, message: string) {
  if (!condition) errors.push({ field, message });
}

export function validateUne(raw: unknown): ValidationResult<any> {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    return { data: null, valid: false, errors: [{ field: 'root', message: 'une.json est vide ou invalide' }] };
  }

  const d = raw as Record<string, any>;

  check(errors, typeof d.date === 'string' && d.date.length === 10, 'date', 'date manquante ou invalide');
  check(errors, typeof d.sujet_du_jour === 'object' && d.sujet_du_jour !== null, 'sujet_du_jour', 'sujet_du_jour manquant');
  check(errors, typeof d.sujet_du_jour?.titre === 'string' && d.sujet_du_jour.titre.length > 5, 'sujet_du_jour.titre', 'titre du sujet manquant');
  check(errors, Array.isArray(d.france), 'france', 'section france manquante');
  check(errors, Array.isArray(d.monde), 'monde', 'section monde manquante');

  if (errors.length > 0) {
    console.warn('[validate-data] une.json:', errors.map(e => `${e.field}: ${e.message}`).join(', '));
    return { data: null, valid: false, errors };
  }

  return { data: d, valid: true, errors: [] };
}

export function validateFil(raw: unknown): ValidationResult<any> {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    return { data: null, valid: false, errors: [{ field: 'root', message: 'fil.json est vide ou invalide' }] };
  }

  const d = raw as Record<string, any>;

  check(errors, typeof d.date === 'string' && d.date.length === 10, 'date', 'date manquante');
  check(errors, Array.isArray(d.items) && d.items.length > 0, 'items', 'fil vide ou items manquants');

  if (d.items?.length > 0) {
    const first = d.items[0];
    // Accept either AI-generated 'texte' or RSS-based 'titre' field
    const hasContent = (typeof first.texte === 'string' && first.texte.length > 5)
                    || (typeof first.titre === 'string' && first.titre.length > 5);
    check(errors, hasContent, 'items[0].texte/titre', 'contenu du premier item invalide');
    check(errors, typeof first.source === 'string', 'items[0].source', 'source du premier item manquante');
  }

  if (errors.length > 0) {
    console.warn('[validate-data] fil.json:', errors.map(e => `${e.field}: ${e.message}`).join(', '));
    return { data: null, valid: false, errors };
  }

  return { data: d, valid: true, errors: [] };
}

export function validateSoir(raw: unknown): ValidationResult<any> {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    return { data: null, valid: false, errors: [{ field: 'root', message: 'soir.json est vide ou invalide' }] };
  }

  const d = raw as Record<string, any>;

  check(errors, typeof d.date === 'string', 'date', 'date manquante');
  check(errors, d.edition === 'soir', 'edition', 'champ edition invalide');
  check(errors, typeof d.bilan_journee === 'object' && d.bilan_journee !== null, 'bilan_journee', 'bilan_journee manquant');
  check(errors, typeof d.analyse_approfondie === 'object' && d.analyse_approfondie !== null, 'analyse_approfondie', 'analyse_approfondie manquante');

  if (errors.length > 0) {
    console.warn('[validate-data] soir.json:', errors.map(e => `${e.field}: ${e.message}`).join(', '));
    return { data: null, valid: false, errors };
  }

  return { data: d, valid: true, errors: [] };
}

export function validateSujetsChauds(raw: unknown): ValidationResult<any> {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    return { data: null, valid: false, errors: [{ field: 'root', message: 'sujets-chauds.json est vide ou invalide' }] };
  }

  const d = raw as Record<string, any>;

  check(errors, typeof d.date === 'string', 'date', 'date manquante');
  check(errors, Array.isArray(d.sujets_actifs), 'sujets_actifs', 'sujets_actifs manquant');

  if (errors.length > 0) {
    console.warn('[validate-data] sujets-chauds.json:', errors.map(e => `${e.field}: ${e.message}`).join(', '));
    return { data: null, valid: false, errors };
  }

  return { data: d, valid: true, errors: [] };
}
