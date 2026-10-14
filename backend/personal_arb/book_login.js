/**
 * book_login.js — credential login for betpawa + betfrenzy (NO OTP on these books).
 *
 * Selectors were captured from the LIVE login pages (2026-10-14):
 *   betfrenzy: https://betfrenzy.cm/login  → input[name=phone] + input[name=password]
 *              + button[type=submit] "Sign in"   (country code +237 is a static button,
 *              the phone field takes the NATIONAL number only, e.g. 6XXXXXXXX)
 *   betpawa:   https://www.betpawa.cm/login → input[name=username] (#phoneNumber)
 *              + input[name=password] + button[type=submit] "Log In"
 *
 * Credentials: explicit args -> bot_config.json -> Railway env (BETPAWA_USER/PASS,
 * BETFRENZY_USER/PASS). The session cookie lands in the persisted browser profile,
 * so the scanner/auto-bettor stay authenticated.
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
    loginUrl: 'https://betfrenzy.cm/login',
    userSel: 'input[name="phone"]',
    passSel: 'input[name="password"]',
    submitSel: 'button[type="submit"]',
    loginWords: /^(log ?in|connexion|se connecter|sign in)$/i,
  },
  betpawa: {
    home: 'https://www.betpawa.cm/',
    loginUrl: 'https://www.betpawa.cm/login',
    userSel: 'input[name="username"], #phoneNumber',
    passSel: 'input[name="password"]',
    submitSel: 'button[type="submit"]:has-text("Log In"), button:has-text("Log In")',
    loginWords: /^(log ?in|connexion|se connecter|sign in)$/i,
  },
};

async function readBalance(page) {
  for (const sel of ['[class*="balance" i]', '[class*="wallet" i]', '[class*="solde" i]', '[class*="amount" i]']) {
    try { const t = ((await page.locator(sel).first().textContent({ timeout: 1200 })) || '').trim(); if (t && t.length < 40 && /\d/.test(t)) return t; } catch (_) {}
  }
  return null;
}

async function isLoggedIn(page, site) {
  const bal = await readBalance(page);
  if (bal && /XAF|FCFA|\d[\d\s.,]{2,}/i.test(bal)) return { loggedIn: true, balance: bal };
  const pwd = await page.locator('input[type="password"]').count().catch(() => 0);
  let loginLinks = 0;
  try { loginLinks = await page.getByText(site.loginWords).count(); } catch (_) {}
  if (pwd === 0 && loginLinks === 0) return { loggedIn: true, balance: bal };
  return { loggedIn: false, balance: bal };
}

export async function loginBook(book, { user, pass } = {}) {
  const site = SITES[book];
  if (!site) return { ok: false, reason: `unsupported book ${book}` };
  const envKey = book.toUpperCase();
  const finalUser = String(user || process.env[`${envKey}_USER`] || '').trim();
  const finalPass = String(pass || process.env[`${envKey}_PASS`] || '').trim();
  if (!finalUser || !finalPass) return { ok: false, reason: `no credentials — set ${envKey}_USER/${envKey}_PASS on Railway or "setlogin ${book} <phone> <password>"` };
  const out = { ok: false, book };
  let ctx;
  try {
    ctx = await launchBook(book);
    const page = await ctx.newPage();
    await page.goto(site.home, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);

    let state = await isLoggedIn(page, site);
    if (state.loggedIn) { out.ok = true; out.reason = 'already logged in'; out.balance = state.balance; return out; }

    // Go straight to the known login URL.
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);

    const userInput = page.locator(site.userSel).first();
    try { await userInput.waitFor({ state: 'visible', timeout: 8000 }); } catch (_) { out.reason = `login form not found (selector ${site.userSel}) — page may have changed`; return out; }
    await userInput.click().catch(() => {});
    await userInput.fill(finalUser);
    const passInput = page.locator(site.passSel).first();
    const maxLenAttr = await passInput.getAttribute('maxlength').catch(() => null);
    const maxLen = maxLenAttr ? parseInt(maxLenAttr, 10) : null;
    if (maxLen && finalPass.length > maxLen) { out.reason = `${book} expects a ${maxLen}-character ${book === 'betpawa' ? 'PIN' : 'password'} but the stored value has ${finalPass.length} — fix it on Railway (${book.toUpperCase()}_PASS) or with "setlogin ${book} <phone> <pin>"`; return out; }
    await passInput.fill(finalPass);
    await page.waitForTimeout(400);

    let submitted = false;
    try {
      const btns = page.locator(site.submitSel);
      const n = await btns.count();
      for (let i = 0; i < n; i++) {
        const btn = btns.nth(i);
        try {
          if (await btn.isVisible({ timeout: 1500 })) { await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 6000 }); submitted = true; break; }
        } catch (_) {}
      }
    } catch (_) {}
    if (!submitted) { try { await passInput.press('Enter'); submitted = true; } catch (_) {} }
    if (!submitted) { out.reason = 'could not submit the login form (no visible submit button)'; return out; }

    await page.waitForTimeout(7000);
    // Some SPAs show a transient "welcome" then redirect; give it one more beat.
    state = await isLoggedIn(page, site);
    if (!state.loggedIn) {
      await page.waitForTimeout(4000);
      state = await isLoggedIn(page, site);
    }
    out.ok = state.loggedIn;
    out.balance = state.balance;
    out.url = page.url();
    if (!state.loggedIn) out.reason = 'submitted but not logged in — wrong password, or a verification/step appeared';
    return out;
  } catch (e) {
    out.reason = e.message.slice(0, 160);
    return out;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

export async function checkBook(book) {
  const site = SITES[book];
  if (!site) return { ok: false, reason: `unsupported ${book}` };
  let ctx;
  try {
    ctx = await launchBook(book);
    const page = await ctx.newPage();
    await page.goto(site.home, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);
    const state = await isLoggedIn(page, site);
    return { ok: true, loggedIn: state.loggedIn, balance: state.balance, book };
  } catch (e) {
    return { ok: false, book, reason: e.message.slice(0, 120) };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ── DIAGNOSTIC: open the site and dump what the browser actually sees ─────────
export async function diagnoseLogin(book) {
  const site = SITES[book];
  if (!site) return { ok: false, reason: `unsupported ${book}` };
  let ctx;
  try {
    ctx = await launchBook(book);
    const page = await ctx.newPage();
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    const dump = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const inputs = Array.from(document.querySelectorAll('input, select, textarea')).filter(vis).map(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '', placeholder: el.placeholder || '' }));
      const clickables = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(vis).map(el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', text: (el.textContent || '').trim().slice(0, 30) })).filter(x => x.text).slice(0, 25);
      return { url: location.href, title: document.title, hasPassword: !!document.querySelector('input[type=password]'), inputs, clickables };
    });
    const png = await page.screenshot({ fullPage: false });
    return { ok: true, book, dump, screenshot: png.toString('base64') };
  } catch (e) {
    return { ok: false, book, reason: e.message.slice(0, 160) };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}