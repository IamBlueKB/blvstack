// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://blvstack.com',
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: false },
    imageService: true,
  }),
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/admin') && !page.includes('/start/thank-you'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // `postgres` (the PSRx read driver) uses node:net/tls; let Node load it
    // natively instead of Vite transforming it for SSR (which hangs on connect).
    // `pdfkit` reads its bundled .afm font metrics from disk at runtime — keep it
    // external so Node resolves those assets from node_modules (the proposal PDF
    // export). `fontkit` is pdfkit's embedded-font dependency.
    ssr: { external: ['postgres', 'pdfkit', 'fontkit'] },
  },
  image: {
    domains: [],
  },
});
