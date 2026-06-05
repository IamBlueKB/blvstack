// Generates per-page OG cards (1200×630) for the marketing pages.
// Run: node scripts/generate-og-pages.mjs
// Output: /public/og/{slug}.png — one per entry in PAGES below.
// The default homepage OG card is generated separately by scripts/generate-og.mjs.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname as pathDirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'og');

const W = 1200;
const H = 630;

// Per-page OG cards. Top-left eyebrow, two-line title in mixed cream + electric,
// sub-tagline below, BLVSTACK.COM meta at bottom — mirrors the hero treatment on the site.
const PAGES = [
  {
    slug: 'services',
    eyebrow: '// SERVICES',
    title: 'Three layers,',
    titleAccent: 'one system.',
    sub: 'L1 Agents · L2 Systems · L3 Interfaces',
  },
  {
    slug: 'work',
    eyebrow: '// SELECTED WORK',
    title: 'Built systems,',
    titleAccent: 'not just sites.',
    sub: 'Case studies from BLVSTACK engagements.',
  },
  {
    slug: 'work-precise-aesthetics',
    eyebrow: '// CASE STUDY',
    title: 'Precise',
    titleAccent: 'Aesthetics.',
    sub: 'Medical aesthetics platform — design + build.',
  },
  {
    slug: 'about',
    eyebrow: '// ABOUT',
    title: 'Founder-led,',
    titleAccent: 'scope-controlled.',
    sub: 'AI systems studio. Built like infrastructure.',
  },
];

function buildSvg({ eyebrow, title, titleAccent, sub }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g1" cx="20%" cy="100%" r="60%">
      <stop offset="0%" stop-color="#2563EB" stop-opacity="0.18" />
      <stop offset="60%" stop-color="#2563EB" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="g2" cx="85%" cy="15%" r="50%">
      <stop offset="0%" stop-color="#1E40AF" stop-opacity="0.20" />
      <stop offset="70%" stop-color="#1E40AF" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0A0E1A" />
  <rect width="${W}" height="${H}" fill="url(#g1)" />
  <rect width="${W}" height="${H}" fill="url(#g2)" />
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" />

  <!-- Top-left eyebrow -->
  <g transform="translate(80, 90)">
    <rect x="0" y="6" width="40" height="2" fill="#2563EB" />
    <text x="56" y="14" font-family="ui-monospace,'JetBrains Mono',monospace" font-size="14" letter-spacing="3" fill="#2563EB" font-weight="500">${eyebrow}</text>
  </g>

  <!-- Main title — two lines, cream + electric accent -->
  <g transform="translate(80, 250)">
    <text font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="96" font-weight="800" letter-spacing="-4">
      <tspan x="0" fill="#FAF8F3">${title}</tspan>
      <tspan x="0" dy="108" fill="#2563EB">${titleAccent}</tspan>
    </text>
  </g>

  <!-- Sub-tagline -->
  <g transform="translate(80, 490)">
    <text font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="26" font-weight="500" fill="#94A3B8" letter-spacing="-0.2">${sub}</text>
  </g>

  <!-- Bottom-left meta -->
  <g transform="translate(80, 555)">
    <text font-family="ui-monospace,'JetBrains Mono',monospace" font-size="14" letter-spacing="3" fill="#64748B" font-weight="500">BLVSTACK.COM</text>
  </g>

  <!-- Bottom-right accent line + dot -->
  <g transform="translate(${W - 130}, 555)">
    <circle cx="0" cy="6" r="4" fill="#2563EB" />
    <rect x="14" y="5" width="36" height="2" fill="#2563EB" />
  </g>
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });

for (const page of PAGES) {
  const svg = buildSvg(page);
  const outPath = join(OUT_DIR, `${page.slug}.png`);
  await sharp(Buffer.from(svg))
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(outPath);
  console.log(`Generated ${outPath}`);
}
