/**
 * generate-articles.ts — Generate full deontological MDX articles from pipeline data
 *
 * Reads une.json, ia.json, sujets-chauds.json and generates complete articles
 * following the Citoyens.ai editorial template:
 *   ## Contexte / ## Les faits / ## Pourquoi c'est important
 *
 * Skips articles already written (checks by slug).
 *
 * Usage: npx tsx scripts/generate-articles.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, callLLMWithRetry } from './llm-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

type Rubrique = 'politique' | 'economie' | 'tech';

interface ArticleInput {
  titre: string;
  rubrique: Rubrique;
  resume: string;
  contexte?: string;
  faits?: string[];
  sources: Array<{ nom: string; url: string; type?: string }>;
  slug: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70);
}

function getExistingSlugs(): Set<string> {
  const dir = join(ROOT, 'src/content/articles');
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter(f => f.endsWith('.mdx'))
      .map(f => f.replace('.mdx', ''))
  );
}

// ─── LLM article generation ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es journaliste pour Citoyens.ai — un journal citoyen indépendant, factuel et transparent.

## Mission
Rédiger un article de fond complet à partir d'un briefing éditorial.
L'article suit IMPÉRATIVEMENT ce template en trois sections H2 :

## Contexte
[2-3 paragraphes : historique, causes, acteurs. Pas d'opinion, des faits vérifiables.]

## Les faits
[2-3 paragraphes : ce qui s'est passé concrètement, chiffres précis, déclarations citées. Toujours attribuer les faits à leurs sources.]

## Pourquoi c'est important
[2-3 paragraphes : enjeux concrets pour les citoyens, conséquences prévisibles, questions ouvertes. Peut se terminer par un blockquote avec la question centrale non résolue.]

## Règles éditoriales
- Ton neutre et factuel. Zéro jugement politique.
- Citer les sources par leur nom dans le texte : "(Le Monde)", "(franceinfo)", etc.
- Phrases courtes. Paragraphes de 3-4 phrases max.
- Ne jamais inventer de chiffres ou de faits.
- Le blockquote final (optionnel) : "> **Ce que l'on ne sait pas encore :** [question ouverte]"
- Longueur : 350-550 mots au total.
- Retourne UNIQUEMENT le corps Markdown (pas le frontmatter).`;

async function generateArticleBody(
  config: ReturnType<typeof resolveConfig>,
  input: ArticleInput,
): Promise<string> {
  const sourcesText = input.sources
    .slice(0, 5)
    .map(s => `- ${s.nom} : ${s.url}`)
    .join('\n');

  const factsText = input.faits?.length
    ? `\nFaits clés :\n${input.faits.map(f => `- ${f}`).join('\n')}`
    : '';

  const userMessage = `
Titre : ${input.titre}
Rubrique : ${input.rubrique}
Résumé éditorial : ${input.resume}
${input.contexte ? `Contexte fourni : ${input.contexte}` : ''}
${factsText}

Sources disponibles :
${sourcesText}

Rédige l'article complet (corps uniquement, sans frontmatter YAML).
`;

  return callLLMWithRetry(config, SYSTEM_PROMPT, userMessage, 4000);
}

// ─── Source collection ───────────────────────────────────────────────────────

function collectInputs(): ArticleInput[] {
  const inputs: ArticleInput[] = [];

  // ── 1. une.json → france items ──
  const unePath = join(ROOT, 'src/data/une.json');
  if (existsSync(unePath)) {
    const une = JSON.parse(readFileSync(unePath, 'utf-8'));
    const date: string = une.date ?? new Date().toISOString().slice(0, 10);

    for (const item of (une.france ?? [])) {
      const rubrique = item.rubrique as Rubrique;
      if (!['politique', 'economie'].includes(rubrique)) continue;
      if (!item.titre || !item.sources?.length) continue;

      inputs.push({
        titre: item.titre,
        rubrique,
        resume: item.resume,
        faits: item.faits,
        contexte: item.contexte,
        sources: item.sources.map((s: any) => ({ nom: s.nom, url: s.url, type: s.type })),
        slug: slugify(item.titre),
      });
    }

    // ── 2. une.json → sujet_du_jour (rubrique internationale → politique) ──
    if (une.sujet_du_jour) {
      const s = une.sujet_du_jour;
      const rubrique: Rubrique = s.rubrique === 'economie' ? 'economie'
        : s.rubrique === 'tech' || s.rubrique === 'ia' ? 'tech'
        : 'politique';
      if (s.titre && s.sources?.length) {
        inputs.push({
          titre: s.titre,
          rubrique,
          resume: s.pourquoi_important ?? s.resume ?? '',
          faits: s.faits,
          contexte: s.contexte,
          sources: s.sources.map((src: any) => ({ nom: src.nom, url: src.url, type: src.type })),
          slug: slugify(s.titre),
        });
      }
    }
  }

  // ── 3. sujets-chauds.json → sujets_actifs ──
  const sujetsPath = join(ROOT, 'src/data/sujets-chauds.json');
  if (existsSync(sujetsPath)) {
    const sc = JSON.parse(readFileSync(sujetsPath, 'utf-8'));
    for (const sujet of (sc.sujets_actifs ?? [])) {
      const rubrique: Rubrique = sujet.rubrique === 'economie' ? 'economie'
        : sujet.rubrique === 'tech' || sujet.rubrique === 'ia' ? 'tech'
        : 'politique';
      if (!sujet.titre || !sujet.sources?.length) continue;

      inputs.push({
        titre: sujet.titre,
        rubrique,
        resume: sujet.resume,
        sources: sujet.sources.map((s: any) => ({ nom: s.nom, url: s.url, type: s.type })),
        slug: sujet.slug ?? slugify(sujet.titre),
      });
    }
  }

  // ── 4. ia.json → faits_ia ──
  const iaPath = join(ROOT, 'src/data/ia.json');
  if (existsSync(iaPath)) {
    const ia = JSON.parse(readFileSync(iaPath, 'utf-8'));
    for (const fait of (ia.faits_ia ?? [])) {
      if (!fait.titre || !fait.sources?.length) continue;
      inputs.push({
        titre: fait.titre,
        rubrique: 'tech',
        resume: fait.resume,
        contexte: fait.pourquoi_ca_compte,
        sources: fait.sources.map((s: any) => ({ nom: s.nom, url: s.url, type: s.type })),
        slug: slugify(fait.titre),
      });
    }
  }

  // Deduplicate by slug
  const seen = new Set<string>();
  return inputs.filter(i => {
    if (seen.has(i.slug)) return false;
    seen.add(i.slug);
    return true;
  });
}

// ─── MDX file writer ─────────────────────────────────────────────────────────

function writeMdx(input: ArticleInput, body: string, date: string): void {
  const dir = join(ROOT, 'src/content/articles');
  mkdirSync(dir, { recursive: true });

  const sourcesYaml = input.sources
    .slice(0, 6)
    .map(s => `  - label: "${s.nom.replace(/"/g, '\\"')}"\n    url: "${s.url}"`)
    .join('\n');

  const content = `---
titre: "${input.titre.replace(/"/g, '\\"')}"
rubrique: ${input.rubrique}
date: "${date}"
estUne: false
resume: "${input.resume.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 280)}"
sources:
${sourcesYaml}
---

${body.trim()}
`;

  const path = join(dir, `${input.slug}.mdx`);
  writeFileSync(path, content, 'utf-8');
  console.log(`  ✓ ${input.slug}.mdx`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const config = resolveConfig();
  console.log(`\n📰 generate-articles — provider: ${config.provider} / ${config.model}`);

  const existingSlugs = getExistingSlugs();
  const inputs = collectInputs();
  const today = new Date().toISOString().slice(0, 10);

  const toGenerate = inputs.filter(i => !existingSlugs.has(i.slug));

  console.log(`\nArticles existants : ${existingSlugs.size}`);
  console.log(`Nouveaux à générer : ${toGenerate.length} (sur ${inputs.length} inputs)\n`);

  if (toGenerate.length === 0) {
    console.log('Rien à générer.');
    return;
  }

  let generated = 0;
  let failed = 0;

  for (const input of toGenerate) {
    console.log(`→ [${input.rubrique}] ${input.titre.slice(0, 60)}…`);
    try {
      const body = await generateArticleBody(config, input);
      writeMdx(input, body, today);
      generated++;
      // Small delay between calls
      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      console.error(`  ✗ Erreur : ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✓ ${generated} articles générés · ${failed} erreurs`);
}

main().catch(err => {
  console.error('generate-articles failed:', err);
  process.exit(1);
});
