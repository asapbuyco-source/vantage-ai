/**
 * personal_arb/linefeed_poller.js
 * Headless Chrome poller for 1xBet/Melbet LineFeed (covers 2/7 books, same platform)
 * Usage: node backend/personal_arb/linefeed_poller.js --site=1xbet --headed
 * Requires: npm i -D playwright, npx playwright install chromium
 * Notes: Personal use only — keep ToS in mind, you confirm CAPTCHAs manually.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../../.playwright_profile');
const SITES = {
  '1xbet': 'https://1xbet.cm/en/line',
  'melbet': 'https://melbet-cm.com/en/line',
};

const args = process.argv.slice(2);
const siteArg = args.find(a => a.startsWith('--site='))?.split('=')[1] || '1xbet';
const headed = args.includes('--headed');

async function run() {
  const site = SITES[siteArg];
  if (!site) {
    console.error(`Unknown site ${siteArg}, choose 1xbet|melbet`);
    process.exit(1);
  }
  console.log(`[Arb] Launching ${siteArg} -> ${site} headed=${headed}`);
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Intercept GetGamesActions API — log all API calls for discovery
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('GetGamesActions') || url.includes('LineFeed') || url.includes('/Get') || url.includes('/Service/')) {
      console.log(`[API] ${resp.status()} ${url.slice(0,120)}`);
      if (url.includes('GetGameZip') || url.includes('GetGamesActions') || url.includes('LineFeed')) {
        try {
          const json = await resp.json();
          const txt = JSON.stringify(json);
          console.log(`  body keys: ${Object.keys(json).join(', ')}`);
          console.log(`  size: ${txt.length} chars`);
          // Try to locate the 1X2 odds array — dump a window around 'E"' events or first 3000 chars
          console.log(`  sample: ${txt.slice(0, 2500)}`);
          if (txt.length > 2500) console.log(`  ... tail: ${txt.slice(-1500)}`);
        } catch (e) {
          console.log(`[API] parse fail`, e.message);
        }
      }
    }
  });

  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`[Arb] Page loaded, waiting 15s for LineFeed XHR... (confirm any CAPTCHA manually if headed)`);
  await page.waitForTimeout(15000);

  // Try to extract visible 1x2 odds from DOM as fallback
  const domOdds = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[class*="c-events"], [class*="event"]')).slice(0, 3);
    return rows.map(r => r.innerText.slice(0, 300));
  });
  console.log(`[DOM] sample rows:`, domOdds);

  if (!headed) await context.close();
  else console.log(`[Arb] Headed mode — browser stays open for bot confirm. Ctrl+C to exit.`);
}

run().catch(e => { console.error(e); process.exit(1); });
