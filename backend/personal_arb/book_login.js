/**
 * book_login.js — credential login for betpawa + betfrenzy (NO OTP on these books).
 *
 * Flow: open the book with the persisted browser profile → find the login form
 * (generic, multi-fallback selectors) → fill phone/username + password → submit →
 * verify we're logged in (balance visible / login form gone) → the cookie session
 * is saved in the profile automatically (persistent context).
 *
 * Credentials live in bot_config.json (Railway volume, gitignored, owner-only bot).
 * Nothing is ever echoed back to chat; reports show status + balance only.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_ROOT = process.env.ARB_PROFILE_ROOT
  || (fs.existsSync('/app/.playwright_profile') ? '/app/.playwright_profile' : path.join(__dirname, '../../.playwright_profile'));
const ARB_PROXY = process.env.ARB_PROXY || '';

async function launchBook(profileName) {
  // Mobile viewport — the same layout the scanner's locators/screenshots use.
  const launchOpts = { headless: true, viewport: { width: 390, height: 844, isMobile: true } };
  if (ARB_PROXY && process.env.SCREENSHOT_PROXY === '1') {
    const u = new URL(ARB_PROXY);
    launchOpts.proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  }
  const prof = path.join(PROFILE_ROOT, profileName);
  if (!fs.existsSync(prof)) fs.mkdirSync(prof, { recursive: true });
  return chromium.launchPersistentContext(prof, launchOpts);
}

const SITES = {
  betfrenzy: {
    home: 'https://betfrenzy.cm/',
    loginPaths: ['', 'auth/login', 'login', 'connexion'],
    loginWords: /connexion|se connecter|login|sign in/i,
    userSel: ['input[type="tel"]', 'input[type="email"]', 'input[type="text"]', 'input[name*="phone" i]', 'input[name*="user" i]', 'input[placeholder*="téléphone" i]', 'input[placeholder*="phone" i]'],
    passSel: ['input[type="password"]'],
    submitWords: /connexion|se connecter|login|sign in|valider|submit/i,
  },
  betpawa: {
    home: 'https://www.betpawa.cm/',
    loginPaths: ['', 'en/login', 'login'],
    loginWords: /log ?in|sign in|connexion/i,
    userSel: ['input[type="tel"]', 'input[type="email"]', 'input[type="text"]', 'input[name*="phone" i]', 'input[name*="user" i]', 'input[name*="msisdn" i]', 'input[placeholder*="phone" i]'],
    passSel: ['input[type="password"]'],
    submitWords: /log ?in|sign in|connexion|continue|suivant|submit/i,
  },
};

async function findFirst(page, selectors, { visible = true } = {}) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try { if (await loc.isVisible({ timeout: 800 })) return loc; } catch (_) { if (!visible) return loc; }
  }
  return null;
}

async function isLoggedIn(page, site) {
  // Logged in = a balance-ish element is visible OR no password field & no login link
  const balSelectors = ['[class*="balance" i]', '[class*="wallet" i]', '[class*="solde" i]'];
  const bal = await findFirst(page, balSelectors);
  if (bal) { const t = (await bal.textContent().catch(() => '')) || ''; if (/\d/.test(t) && /XAF|FCFA/i.test(t)) return { loggedIn: true, balance: t.trim() }; }
  const pwd = await page.locator('input[type="password"]').count().catch(() => 0);
  const loginLink = await page.getByText(site.loginWords).count().catch(() => 0);
  if (pwd === 0 && loginLink === 0) return { loggedIn: true, balance: null };
  return { loggedIn: false, balance: null };
}

export async function loginBook(book, { user, pass, sendPhoto } = {}) {
  const site = SITES[book];
  if (!site) return { ok: false, reason: `unsupported book ${book}` };
  // Credentials: explicit args -> stored config (bot_config.json) -> Railway env vars
  // (BETPAWA_USER/BETPAWA_PASS, BETFRENZY_USER/BETFRENZY_PASS).
  const envKey = book.toUpperCase();
  const finalUser = user || process.env[`${envKey}_USER`];
  const finalPass = pass || process.env[`${envKey}_PASS`];
  if (!finalUser || !finalPass) return { ok: false, reason: `no credentials for ${book} — set ${envKey}_USER/${envKey}_PASS on Railway or use "setlogin ${book} <phone> <password>"` };
  const out = { ok: false, book };
  let ctx;
  try {
    ctx = await launchBook(book);
    const page = await ctx.newPage();
    await page.goto(site.home, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Already logged in? Then nothing to do.
    let state = await isLoggedIn(page, site);
    if (state.loggedIn) { out.ok = true; out.reason = 'already logged in'; out.balance = state.balance; return out; }

    // Find the login form — open the login page if not on it.
    let userInput = await findFirst(page, site.userSel);
    if (!userInput) {
      for (const lp of site.loginPaths.filter(Boolean)) {
        try {
          await page.goto(`${site.home}${lp}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2500);
          userInput = await findFirst(page, site.userSel);
          if (userInput) break;
        } catch (_) {}
      }
    }
    if (!userInput) {
      // try clicking a login link/button
      try {
        const link = page.getByText(site.loginWords).first();
        if (await link.isVisible({ timeout: 1200 })) { await link.click().catch(() => {}); await page.waitForTimeout(2500); }
      } catch (_) {}
      userInput = await findFirst(page, site.userSel);
    }
    if (sendPhoto) { try { await sendPhoto(await page.screenshot(), `🔐 ${book}: login page as I see it`); } catch (_) {} }
    if (!userInput) { out.reason = 'could not find the login form'; return out; }

    await userInput.fill(String(finalUser));
    const passInput = await findFirst(page, site.passSel);
    if (!passInput) { out.reason = 'login form found but no password field'; return out; }
    await passInput.fill(String(finalPass));

    // Submit
    let clicked = false;
    for (const w of [/connexion/i, /se connecter/i, /log ?in/i, /sign in/i, /valider/i, /submit/i]) {
      try {
        const b = page.getByRole('button', { name: w }).first();
        if (await b.isVisible({ timeout: 600 })) { await b.click(); clicked = true; break; }
      } catch (_) {}
    }
    if (!clicked) {
      try { await passInput.press('Enter'); clicked = true; } catch (_) {}
    }
    await page.waitForTimeout(6000);

    state = await isLoggedIn(page, site);
    out.ok = state.loggedIn;
    out.balance = state.balance;
    if (!state.loggedIn) {
      out.reason = 'submitted but still not logged in (wrong credentials, or a validation step appeared)';
      if (sendPhoto) { try { await sendPhoto(await page.screenshot(), `⚠️ ${book}: still not logged in after submit`); } catch (_) {} }
    }
    return out;
  } catch (e) {
    out.reason = e.message.slice(0, 160);
    return out;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// Light check: logged-in state + balance, no form interaction.
export async function checkBook(book) {
  const site = SITES[book];
  if (!site) return { ok: false, reason: `unsupported ${book}` };
  let ctx;
  try {
    ctx = await launchBook(book);
    const page = await ctx.newPage();
    await page.goto(site.home, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const state = await isLoggedIn(page, site);
    return { ok: true, loggedIn: state.loggedIn, balance: state.balance, book };
  } catch (e) {
    return { ok: false, book, reason: e.message.slice(0, 120) };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}