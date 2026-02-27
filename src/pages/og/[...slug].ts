/**
 * Dynamic OG image generation using SVG -> PNG conversion.
 * For static builds, this generates OG images at build time.
 *
 * Since Astro static mode doesn't support server-side image generation
 * with canvas/sharp easily, we use an SVG-based approach that gets
 * served as-is (most social platforms accept SVG og:image).
 *
 * For production, consider using Vercel OG or a dedicated og-image service.
 */

import type { APIRoute, GetStaticPaths } from 'astro';

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = [{ params: { slug: 'default' } }];

  try {
    const uneData = await import('../../data/une.json').then(m => m.default);
    if (uneData?.date) {
      paths.push({ params: { slug: `edition-${uneData.date}` }, props: { edition: uneData } });
    }
  } catch { /* no une.json yet */ }

  try {
    const archiveModules = import.meta.glob('../../data/archives/*.json', { eager: true });
    for (const [path, mod] of Object.entries(archiveModules)) {
      const match = path.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) {
        paths.push({ params: { slug: `edition-${match[1]}` }, props: { edition: (mod as any).default } });
      }
    }
  } catch { /* no archives */ }

  return paths;
};

function generateSvg(title: string, subtitle: string, date?: string): string {
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedSub = subtitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedDate = (date || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#F7F5F0"/>
  <rect width="1200" height="8" fill="#000091"/>
  <text x="60" y="80" font-family="Georgia,serif" font-size="36" font-weight="900" fill="#1A1A1A">citoyens<tspan fill="#000091">.ai</tspan></text>
  <text x="60" y="120" font-family="monospace" font-size="14" fill="#9A9A9A" letter-spacing="2">${escapedDate}</text>
  <foreignObject x="60" y="160" width="1080" height="320">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Georgia,serif;font-size:52px;font-weight:900;line-height:1.15;color:#1A1A1A;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;">
      ${escapedTitle}
    </div>
  </foreignObject>
  <text x="60" y="540" font-family="sans-serif" font-size="22" fill="#000091" font-weight="600">${escapedSub}</text>
  <text x="60" y="580" font-family="monospace" font-size="14" fill="#9A9A9A">5 minutes pour savoir · Toutes les sources pour juger</text>
  <rect y="622" width="1200" height="8" fill="#E1000F"/>
</svg>`;
}

export const GET: APIRoute = async ({ props }) => {
  const edition = (props as any)?.edition;

  let title = "L'essentiel de l'actu en 5 minutes";
  let subtitle = 'Politique · Économie · Tech · Science · Société · International';
  let date = '';

  if (edition?.sujet_du_jour) {
    title = edition.sujet_du_jour.titre;
    subtitle = edition.sujet_du_jour.pourquoi_important || subtitle;
    if (edition.date) {
      const d = new Date(edition.date + 'T00:00:00');
      date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    }
  }

  const svg = generateSvg(title, subtitle, date);

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
};
