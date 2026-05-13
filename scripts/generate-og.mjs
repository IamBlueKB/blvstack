// Generates /public/og/default.png — a 1200×630 social card.
// Run: node scripts/generate-og.mjs
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname, resolve } from 'node:path';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'og', 'default.png');

const W = 1200;
const H = 630;

// Use Λ (Greek capital lambda) in the wordmark for the stylized 'A'
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">

  <!-- Background -->
  <defs>
    <radialGradient id="g1" cx="20%" cy="100%" r="60%" fx="20%" fy="100%">
      <stop offset="0%" stop-color="#2563EB" stop-opacity="0.18" />
      <stop offset="60%" stop-color="#2563EB" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="g2" cx="85%" cy="15%" r="50%" fx="85%" fy="15%">
      <stop offset="0%" stop-color="#1E40AF" stop-opacity="0.20" />
      <stop offset="70%" stop-color="#1E40AF" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0A0E1A" />
  <rect width="${W}" height="${H}" fill="url(#g1)" />
  <rect width="${W}" height="${H}" fill="url(#g2)" />

  <!-- Subtle border -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" />

  <!-- Top-left brand row -->
  <g transform="translate(80, 90)">
    <rect x="0" y="6" width="40" height="2" fill="#2563EB" />
    <text x="56" y="14" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="14" letter-spacing="3" fill="#2563EB" font-weight="500">// AI SYSTEMS STUDIO</text>
  </g>

  <!-- Main wordmark -->
  <g transform="translate(80, 280)">
    <text font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="160" font-weight="800" letter-spacing="-6" fill="#FAF8F3">BLVSTΛCK</text>
  </g>

  <!-- Tagline -->
  <g transform="translate(80, 380)">
    <text font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="500" fill="#94A3B8" letter-spacing="-0.5">
      <tspan>Systems that work</tspan>
      <tspan x="0" dy="48" fill="#FAF8F3">while you don&apos;t.</tspan>
    </text>
  </g>

  <!-- Bottom-left meta -->
  <g transform="translate(80, 540)">
    <text font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="14" letter-spacing="3" fill="#64748B" font-weight="500">BLVSTACK.COM</text>
  </g>

  <!-- Bottom-right status pill -->
  <g transform="translate(${W - 320}, 530)">
    <circle cx="8" cy="14" r="4" fill="#2563EB" />
    <text x="24" y="19" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="13" letter-spacing="2.5" fill="#FAF8F3" font-weight="500">ACCEPTING PROJECTS · Q2 / 26</text>
  </g>

</svg>
`;

await mkdir(dirname(outPath), { recursive: true });
await sharp(Buffer.from(svg))
  .png({ quality: 95, compressionLevel: 9 })
  .toFile(outPath);

console.log(`Generated ${outPath}`);
