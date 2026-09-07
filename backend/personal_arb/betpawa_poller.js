/**
 * betpawa_poller.js — intercept betpawa Next.js data for 1X2 odds
 * Usage: node backend/personal_arb/betpawa_poller.js
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '../../.playwright_profile');

async function run() {
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('response', async r => {
    const url = r.url();
    if (url.includes('/api/integration/v3/aggregator/games/categorized') || url.includes('/api/sportsbook/v1/combo-cards/list')) {
      console.log(`[API] ${r.status()} ${url.slice(0,130)}`);
      try {
        const j = await r.json();
        console.log(`  body keys: ${Object.keys(j).join(', ')}`);
        const txt = JSON.stringify(j).slice(0, 1200);
        console.log(`  sample: ${txt.slice(0,1000)}`);
      } catch (e) { console.log('  parse fail', e.message); }
    }
  });
  console.log('[betpawa] goto https://www.betpawa.cm/');
  await page.goto('https://www.betpawa.cm/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  // try to click Football
  try {
    const fb = page.locator('text=Football').first();
    if (await fb.count()) { await fb.click(); await page.waitForTimeout(5000); }
  } catch {}
  // log visible odds from DOM
  const dom = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[class*="odds"], [class*="price"], [class*="market"]')).slice(0,5);
    return els.map(e => e.innerText.slice(0,200));
  });
  console.log('[DOM] odds els:', dom);
  await ctx.close();
}
run().catch(e => { console.error(e); process.exit(1); });
