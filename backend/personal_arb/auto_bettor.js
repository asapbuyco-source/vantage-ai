/**
 * auto_bettor.js — personal semi-auto: polls 7 books, computes arb, sends Telegram alert with 1-click stake
 * No direct bet placement (avoids ToS) — you click the book link and confirm.
 * Usage: node backend/personal_arb/auto_bettor.js
 */
import { calcArb } from './arb_calc.js';
import admin from 'firebase-admin';

if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log('[Telegram] skipped (no token/chatId)', text.slice(0,120)); return; }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function checkArb() {
  // Example: use betfrenzy 1X2 vs betpawa (when fixed) — for now demo with betfrenzy alone vs itself (no arb)
  // In production, fetch all 7, normalize names, find same fixture across books, calcArb per market
  const sample = [
    { book: 'betfrenzy', market: '1', odds: 2.05 },
    { book: 'betpawa', market: '1', odds: 2.15 },
  ];
  const r = calcArb(sample);
  if (r.isArb) {
    const msg = `🎯 Arb ${r.arbPct}% 1:${sample[0].odds} vs ${sample[1].odds}\nStakes: ${r.stakes.map(s => `${s.book} ${s.stake}→${s.payout}`).join(' | ')}`;
    console.log(msg);
    await sendTelegram(msg);
    if (admin.apps.length) {
      await admin.firestore().collection('arb_opportunities').add({ ts: new Date().toISOString(), arb: r, sample });
    }
  } else {
    console.log(`[Arb] No arb ${r.arbPct}% — ${new Date().toISOString()}`);
  }
}

checkArb().catch(e => console.error(e));
