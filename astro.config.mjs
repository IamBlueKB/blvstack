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
    // @astrojs/vercel honors maxDuration ONLY as an adapter option (applied to the
    // single bundled function) — per-route `export const maxDuration` is dead code.
    // The heavy crons (booker discovery, PSRx release/sweep, JANET chat) assume a
    // 300s ceiling (see src/lib/booker/engine.ts FN_TIME_BUDGET_MS); make it real.
    maxDuration: 300,
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
