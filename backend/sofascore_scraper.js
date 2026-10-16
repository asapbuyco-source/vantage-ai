/**
 * sofascore_scraper.js — SofaScore livescore scraper via headless Chromium.
 *
 * Why headless browser: SofaScore's JSON API (api.sofascore.com) is behind a
 * Cloudflare managed challenge; the rendered HTML pages are accessible a real
 * browser passes the challenge. We use a TEMPORARY profile per run (fresh temp
 * dir) so nothing persists, and wait out the "Verifying you are human…" gate.
 *
 * Reliability: the challenge is INTERMITTENT. Optional residential proxy
 * (pass proxy URL) makes it far more consistent. Returns [] if it never clears.
 *
 * Usage:
 *   import { fetchLivescore } from './sofascore_scraper.js';
 *   const matches = await fetchLivescore({ sport: 'football', proxy: process.env.SOFASCORE_PROXY });
 */
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const SPORTS = { football: 'football', basketball: 'basketball', tennis: 'tennis', handball: 'handball', volleyball: 'volleyball', mma: 'mma', hockey: 'ice-hockey' };

function proxyOpts(proxyUrl) {
  if (!proxyUrl) return {};
  try {
    const u = new URL(proxyUrl);
    return { proxy: { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } };
  } catch { return {}; }
}

async function scrapeList(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[data-id][href*="/match/"]')) {
      const href = a.getAttribute('href') || '';
      const id = a.getAttribute('data-id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sport = (href.match(/\/(football|basketball|tennis|handball|volleyball|mma|ice-hockey)\//) || [])[1] || '';
      const slug = (href.match(/\/match\/([^/]+)\//) || [])[1] || '';
      // team links inside the same card (when present) give clean home/away names
      let card = a;
      while (card.parentElement && card.parentElement.querySelectorAll('a[data-id]').length === 1) card = card.parentElement;
      const teamLinks = Array.from(card.querySelectorAll('a[href*="/team/"]')).map(x => (x.textContent || '').trim()).filter(Boolean);
      const time = ((a.textContent || '').match(/\d{1,2}:\d{2}/) || [])[0] || '';
      out.push({ id, sport, slug, home: teamLinks[0] || '', away: teamLinks[1] || '', time, url: `https://www.sofascore.com${href.replace(/#.*$/, '')}` });
    }
    return out;
  });
}

// Returns [] on challenge-block or error; caller decides the fallback.
export async function fetchLivescore({ sport = 'football', proxy = process.env.SOFASCORE_PROXY || '', timeoutMs = 75000, keepProfile = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 1366, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ...proxyOpts(proxy),
  });
  try {
    await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {} });
    const page = await ctx.newPage();
    const pathSeg = SPORTS[sport] || 'football';
    await page.goto(`https://www.sofascore.com/${pathSeg}/livescore`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    let matches = [];
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      matches = await scrapeList(page);
      if (matches.length) break;
      const txt = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 60)).catch(() => '');
      if (/Verifying you are human/i.test(txt)) {
        // challenge page — nudge a reload once and keep waiting
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    return matches;
  } catch (e) {
    return [];
  } finally {
    await ctx.close().catch(() => {});
    if (!keepProfile) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  }
}

export default { fetchLivescore };
