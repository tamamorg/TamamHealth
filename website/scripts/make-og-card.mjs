/**
 * Renders scripts/og-card.html to the two link-preview JPGs Next serves from
 * src/app (opengraph-image.jpg and twitter-image.jpg — the same picture; the
 * Twitter card is the large-summary variant of it).
 *
 * Run it after the home hero's copy or photograph changes. Playwright is
 * deliberately NOT a dependency of this package: the Dockerfile installs dev
 * dependencies too, so adding a headless browser would land in every deploy
 * build for the sake of a file that changes a few times a year. Install it
 * somewhere scratch instead and point the script at it:
 *
 *   mkdir -p /tmp/og && cd /tmp/og && npm i playwright
 *   PLAYWRIGHT_ROOT=/tmp/og/node_modules/playwright \
 *     node website/scripts/make-og-card.mjs
 *
 * If playwright happens to resolve normally (someone added it), that is used
 * and PLAYWRIGHT_ROOT is not needed.
 *
 * Rendered at 2× and downscaled with sharp (already a dependency, via Next's
 * image optimiser), because Barlow Condensed at card size shows every
 * rasterisation shortcut. Both files must stay 1200×630: that is the ratio
 * every platform crops to, and an off-ratio card gets centre-cropped by the
 * platform instead.
 *
 * Whatever this writes, the two .alt.txt files beside the JPGs must describe —
 * they are what a screen reader announces in place of the card.
 */

import sharp from 'sharp';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const root = process.env.PLAYWRIGHT_ROOT;
    if (!root) {
      throw new Error(
        'playwright is not installed here. Install it in a scratch directory and\n' +
        'set PLAYWRIGHT_ROOT to it — see the header of this file.');
    }
    return (await import(pathToFileURL(join(root, 'index.js')).href)).chromium;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const WIDTH = 1200;
const HEIGHT = 630;

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
});
await page.goto('file://' + join(here, 'og-card.html'), { waitUntil: 'networkidle' });

// The headline is set in Barlow Condensed; falling back to a system face would
// reflow every line and ship a card that is not the site's. Fail rather than
// write that quietly.
await page.evaluate(() => document.fonts.ready);
const condensedLoaded = await page.evaluate(() =>
  document.fonts.check('600 55px "Barlow Condensed"') && document.fonts.check('400 20px "Barlow"'));
if (!condensedLoaded) throw new Error('Barlow / Barlow Condensed did not load — card not written');

const png = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
await browser.close();

const jpg = await sharp(png)
  .resize(WIDTH, HEIGHT, { fit: 'cover' })
  .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toBuffer();

for (const name of ['opengraph-image.jpg', 'twitter-image.jpg']) {
  const out = join(site, 'src', 'app', name);
  await writeFile(out, jpg);
  console.log(`${name}: ${WIDTH}×${HEIGHT}, ${(jpg.length / 1024).toFixed(0)} kB`);
}
