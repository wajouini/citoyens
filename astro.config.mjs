// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://citoyens.ai',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    mdx(),
    sitemap({
      serialize(item) {
        if (item.url.includes('/guide/')) {
          item.changefreq = 'weekly';
          item.priority = 0.9;
        } else if (item.url.includes('/eclairage/')) {
          item.changefreq = 'daily';
          item.priority = 0.8;
        } else if (item.url.includes('/fiche/')) {
          item.priority = 0.7;
        }
        return item;
      },
    }),
  ],
});