# Citoyens.ai

## Project Overview
French civic tech platform — tracks parliamentary activity, profiles public figures, cross-references media coverage. Built with Astro 5 (static), Tailwind CSS 4, Zod-validated JSON data.

## Tech Stack
- **Framework**: Astro 5 (static output, zero JS by default)
- **Styling**: Tailwind CSS 4 with CSS-first `@theme` config in `src/styles/global.css`
- **Data**: JSON files in `src/data/` validated by Zod schemas in `src/content.config.ts`
- **Content**: MDX files in `src/content/dossiers/` for editorial long-form content
- **Fonts**: Playfair Display (display), Source Sans 3 (body), JetBrains Mono (data/mono)
- **Deployment**: Static to Vercel

## Key Commands
```bash
npm run dev      # Start dev server
npm run build    # Build static site to dist/
npm run preview  # Preview built site
```

## Architecture
- `src/data/personnes.json` — Central data file for all person profiles (deputies, senators, journalists)
- `src/data/votes.json` — Recent parliamentary votes
- `src/data/medias.json` — Curated media content (videos, articles)
- `src/content.config.ts` — Zod schemas for all collections
- `src/pages/fiche/[slug].astro` — Dynamic profile page template
- `src/components/home/` — Homepage section components
- `src/utils/colors.ts` — Party colors and role styling
- `src/utils/format.ts` — French date formatting

## Design Tokens
Colors are defined in `src/styles/global.css` under `@theme`:
- `bleu-rep` (#000091) — Primary, republican blue
- `rouge-rep` (#E1000F) — Accent, republican red
- `creme` (#F7F5F0) — Background
- `vert` (#18753C) — Positive/factual
- `orange` (#D4760A) — Warning/editorial
- `rouge-doux` (#C9191E) — Negative/critical

## Adding Content
- **New person**: Add entry to `src/data/personnes.json` following the Zod schema
- **New vote**: Add entry to `src/data/votes.json`
- **New media**: Add entry to `src/data/medias.json`
- **New dossier**: Create MDX file in `src/content/dossiers/`

## Node.js
Node is at `/opt/homebrew/Cellar/node@20/20.20.0/bin/node`. Use:
```bash
export PATH="/opt/homebrew/Cellar/node@20/20.20.0/bin:$PATH"
```
