# Vantage AI — SEO Growth Plan

**Date:** 2026-10-07
**Baseline (Moz):** Domain Authority 2 · Linking Root Domains 22 · Ranking Keywords 0 · Spam Score 2%
**Technical audit:** D+ (58/100) → target A- after Phase 1–3

---

## Phase 1 — Technical Indexability ✅ (done, deploying)
- [x] Canonical on every SSR page + root canonical in `index.html` (kills the 7 "Duplicate without canonical" issues)
- [x] `/predictions/:date` SSR reads **`quant_predictions`** (live pipeline) → unique titles/desc/JSON-LD
- [x] Dynamic sitemap unshadowed (`dist/sitemap.xml` no longer blocks it): quant days + legacy days + blog slugs + match URLs
- [x] `/match/:id` → canonical + `SportsEvent` JSON-LD
- [x] Removed mismatched `FAQPage` schema (Google policy risk)
- [x] Removed `user-scalable=no` (mobile usability)
- [ ] Verify in Search Console ~24–48h after deploy (request indexing on the 7+3 URLs, re-submit sitemap)

## Phase 2 — Public Routes (soft-404 fix)
**Problem:** logged-out crawlers hitting `/vip`, `/guide`, `/stats`, `/match/:id` get the LandingPage with HTTP 200 → near-duplicate thin pages.
- [ ] `App.tsx`: serve real public content without login for `/learn`, `/guide`, `/stats`, `/free` (and keep `/blog`, `/privacy-policy` public)
- [ ] Add an `<h1>` + intro copy per public route so each page is unique
- [ ] Verify logged-out render: `curl` each URL → distinct H1/non-shell content

## Phase 3 — Content Pages (the ranking engine)
Ranking keywords are 0 because there's no indexable, keyword-targeted content. Build:
1. **League pages ×15** — `/pronostics/ligue-1-cameroun`, `/pronostics/premier-league`, `/pronostics/la-liga`, `/pronostics/elite-one`, … each with: upcoming fixtures, form table, model picks, league stats, FAQ snippet.
2. **FAQ page** — visible Q&A on-page + matching `FAQPage` schema (re-add properly this time).
3. **Méthodologie / About page** — how the quant model works (E-E-A-T signal).
4. **Blog cadence** — 5 posts/week minimum (already automated 4×/day programmatic; formalize topics).
5. **Target keywords (FR market):** *pronostic foot cameroun, pronostic 1xbet, pronostic premier bet, pronostic elite one, surebet cameroun, pari sportif ia, meilleur site pronostic cameroun, cote du jour 1xbet*.

## Phase 4 — Off-page / Link Building (DA 2 → 20+, LRD 22 → 100+)
Priority order (quality over quantity; keep Spam Score low — never buy links, no PBNs):
1. **Google Business Profile** (Cameroon) + **Facebook page** — the two strongest local signals.
2. **Social profiles** — LinkedIn company page, YouTube (daily picks recap videos), Instagram.
3. **Press / PR pitch** — Cameroonian tech/football media: Culturebene, 237online, WeAreMister, Koaci, EcoMatin (“Cameroonian builds AI betting assistant” is a pitchable story).
4. **Influencer collabs** — Cameroonian tipster Telegram/WhatsApp/YouTube channels (“picks powered by Vantage AI”, with link).
5. **Guest posts** — 2–3/mo on African betting/football blogs (DA 20+), one backlink each.
6. **Linkable assets** — publish original data studies (“xG trends in Elite One”, “2026 bettor margin analysis”) that earn links organically.
7. **Partnerships** — bookmaker-adjacent portals, betting guide sites (link to the guide).

## Phase 5 — Chrome / Professional Display + Performance
- [ ] **Self-host OG banner** (1200×630) — replace `i.ibb.co` (free host, can break link previews).
- [ ] Replace the **556 KB favicon SVG** with optimized `.png`/`.svg` (~5–20 KB).
- [ ] PWA install prompt polish (manifest icons, splash).
- [ ] **Bundle size:** lazy-load heavy pages (Admin, intel, Vault); target < 250 KB initial JS (currently ~1.5 MB) → LCP/CWV improvement.

## Metrics — 90-day targets
| Metric | Now | Target (90d) |
|---|---|---|
| Indexed pages | ~3 | 100+ |
| Ranking keywords | 0 | 30+ (FR) |
| Domain Authority | 2 | 8–10 |
| Linking Root Domains | 22 | 60+ |
| Organic sessions | ~0 | growing by month 3 |

## Execution order
Phase 1 → (verify GSC) → Phase 2 → Phase 3 → Phase 5 → Phase 4 (ongoing, minimum 3–6 months to compound).