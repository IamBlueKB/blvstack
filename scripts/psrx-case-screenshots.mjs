/**
 * PSRx Body & Skin case study screenshots
 * Pulls real shots from psrxbodyandskin.com for the case study page + homepage feature.
 * Run: node scripts/psrx-case-screenshots.mjs
 *
 * Outputs:
 *   public/case-studies/psrx-body-and-skin.png      (homepage feature on /, 16:10)
 *   public/case-studies/psrx-body-and-skin-1.jpg    (case study screens — public site)
 *   public/case-studies/psrx-body-and-skin-2.jpg    (case study screens — Skin Intelligence Portal)
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../public/case-studies');
mkdirSync(OUT, { recursive: true });

const BASE = 'https://psrxbodyandskin.com';

// 16:10 aspect at 1600×1000 — matches the case study + homepage feature framing.
const W = 1600;
const H = 1000;

const SHOTS = [
  {
    name: 'psrx-body-and-skin',
    ext: 'png',
    url: '/',
    description: 'Homepage feature — brand-led landing (used on blvstack homepage CaseStudiesPreview)',
  },
  {
    name: 'psrx-body-and-skin-1',
    ext: 'jpg',
    url: '/',
    description: 'Case study screen 1 — public site, brand and conversion',
  },
  {
    name: 'psrx-body-and-skin-2',
    ext: 'jpg',
    url: '/portal',
    description: 'Case study screen 2 — Skin Intelligence Portal, member layer',
  },
];

// Dismiss any popup / modal / consent banner so the screenshot shows the editorial page.
// Tries Escape first (most modals respect it), then a list of text-based selectors.
async function dismissOverlays(page) {
  // Give the popup a moment to mount
  await page.waitForTimeout(1800);

  // Escape twice — handles most modals + any focus traps
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // Then text-based dismissal selectors in priority order
  const selectors = [
    'button:has-text("No thanks")',
    'a:has-text("No thanks")',
    'button:has-text("Close")',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    'button[aria-label*="Dismiss" i]',
    'button[aria-label*="lose" i]', // "Close"
    '[role="dialog"] button:last-child',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 1000, force: true });
        await page.waitForTimeout(600);
        break;
      }
    } catch {
      // Selector didn't match / didn't render — try next
    }
  }

  // Final settle for any close animation
  await page.waitForTimeout(700);
}

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: W, height: H });

  console.log(`→ ${shot.name}.${shot.ext} (${shot.url})`);
  try {
    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    // Fallback to domcontentloaded if networkidle times out
    console.log(`   (networkidle timed out, falling back to domcontentloaded)`);
    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  // Dismiss any popup / modal so the editorial page is visible
  await dismissOverlays(page);

  // Scroll back to top in case dismissal jostled the view
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  const outPath = join(OUT, `${shot.name}.${shot.ext}`);
  const screenshotOpts = {
    path: outPath,
    clip: { x: 0, y: 0, width: W, height: H },
  };
  if (shot.ext === 'jpg') {
    screenshotOpts.type = 'jpeg';
    screenshotOpts.quality = 88;
  }
  await page.screenshot(screenshotOpts);
  console.log(`   ✓ saved → public/case-studies/${shot.name}.${shot.ext}  (${W}×${H})`);
  await page.close();
}

await browser.close();
console.log(`\nDone. ${SHOTS.length} screenshots saved.`);
