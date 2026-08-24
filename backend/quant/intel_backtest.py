"""
intel_backtest.py
─────────────────
Tests Vantage's probability maths against real historical results using the
Vantage Intelligence Supabase aggregates (team xG/xGA per-90) joined with
API-Football finished fixtures.

For each fixture where BOTH clubs have intel coverage:
    λ_home = (home.xg_per90 + away.xga_per90) / 2
    λ_away = (away.xg_per90 + home.xga_per90) / 2
    → Dixon-Coles score grid → market probabilities
    → graded vs the actual final score

Reports: multi-class Brier (H/D/A), log-loss, O2.5 Brier, BTTS accuracy,
calibration buckets, and a flat-stake ROI on model-favoured picks.

Usage:
    python intel_backtest.py --leagues "Premier League:39" --season-api 2024 --season-intel 2024-2025
    python intel_backtest.py --leagues "Premier League:39,Serie A:135" --season-api 2024 --season-intel 2024-2025 --max-fixtures 400
"""

import os
import sys
import json
import math
import argparse
from collections import defaultdict

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from poisson_model import compute_score_grid, derive_markets, DIXON_COLES_RHO

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get(
    "VITE_INTEL_SUPABASE_URL", "https://fwatymrvrtvcixtpbncu.supabase.co"
)
SUPABASE_ANON = os.environ.get(
    "VITE_INTEL_SUPABASE_ANON_KEY", "sb_publishable_JCgVDFMMrlmGBXHyH3xFtw_VSbWwe8K"
)
AF_BASE = "https://v3.football.api-sports.io"
AF_KEY = os.environ.get("API_FOOTBALL_KEY", "")
LAGOS = None  # not needed


def sb_get(table: str, params: dict) -> list:
    """Manual PostgREST query builder. Callers MUST pass operator prefixes
    (e.g. 'league': 'eq.Premier League'). Spaces encoded as %20 (+ breaks PGRST)."""
    from urllib.parse import quote
    qs = "&".join(
        f"{k}={quote(str(v), safe='.,()*')}"
        for k, v in (params or {}).items()
    )
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{qs}",
        headers={
            "apikey": SUPABASE_ANON,
            "Authorization": f"Bearer {SUPABASE_ANON}",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def norm(name: str) -> str:
    n = (name or "").lower()
    for w in ("fc", "cf", "sc", "afc", "calcio", "club"):
        n = n.replace(f" {w}", "").replace(f"{w} ", "")
    return " ".join(n.replace("&", " and ").split())


def lookup(tm: dict, name: str):
    """Exact norm match, else unique substring match on significant words."""
    key = norm(name)
    if key in tm:
        return tm[key]
    hits = [v for k, v in tm.items() if key and (key in k or k in key) and abs(len(k) - len(key)) < 12]
    if len(hits) == 1:
        return hits[0]
    # last-resort: first significant word, unique
    first = key.split()[0] if key.split() else ""
    if len(first) >= 5:
        w = [v for k, v in tm.items() if k.startswith(first)]
        if len(w) == 1:
            return w[0]
    return None


def fetch_teams(league_name: str, season_intel: str) -> dict:
    """Return {normalized_name: team_row} for one intel league/season."""
    rows = sb_get("team_intelligence", {
        "league": f"eq.{league_name}",
        "season": f"eq.{season_intel}",
        "select": "*",
    })
    out = {}
    for r in rows:
        out[norm(r["team_name"])] = r
        out[str(r["id"]).replace("-", " ")] = r
    return out


def fetch_fixtures(league_id: int, season_api: int, max_fixtures: int) -> list:
    if not AF_KEY:
        print("[Backtest] MISSING API_FOOTBALL_KEY", file=sys.stderr)
        return []
    r = requests.get(
        f"{AF_BASE}/fixtures",
        headers={"x-apisports-key": AF_KEY},
        params={"league": league_id, "season": season_api, "status": "FT"},
        timeout=30,
    )
    r.raise_for_status()
    out = r.json().get("response", [])
    return out[:max_fixtures]


def lambdas(home: dict, away: dict):
    hs, as_ = home.get("raw_stats") or {}, away.get("raw_stats") or {}
    xgf_h, xga_h = hs.get("xg_per90"), hs.get("xga_per90")
    xgf_a, xga_a = as_.get("xg_per90"), as_.get("xga_per90")
    if None in (xgf_h, xga_h, xgf_a, xga_a):
        return None
    lam_h = max(0.15, (float(xgf_h) + float(xga_a)) / 2)
    lam_a = max(0.15, (float(xgf_a) + float(xga_h)) / 2)
    return lam_h, lam_a


def brier_multiclass(probs: tuple, actual_idx: int) -> float:
    return sum((p - (1 if i == actual_idx else 0)) ** 2 for i, p in enumerate(probs))


def run(args):
    leagues = [pair.split(":") for pair in args.leagues.split(",")]
    fixtures_all = []
    team_maps = {}

    print(f"[Backtest] Pulling intel teams for {len(leagues)} league(s)…")
    for lg_name, lg_id in leagues:
        tm = fetch_teams(lg_name.strip(), args.season_intel)
        team_maps[int(lg_id)] = tm
        print(f"   {lg_name}: {len(tm)} club entries")

    print("[Backtest] Pulling finished fixtures from API-Football…")
    for lg_name, lg_id in leagues:
        fx = fetch_fixtures(int(lg_id), args.season_api, args.max_fixtures)
        print(f"   {lg_name} ({lg_id}): {len(fx)} FT fixtures")
        fixtures_all.extend((int(lg_id), f) for f in fx)

    # ── Grade ──
    n = 0
    brier_hd, brier_o25, ll_sum = 0.0, 0.0, 0.0
    o25_hits = btts_hits = btts_n = 0
    fav_hits = fav_n = 0
    stake, ret = 0.0, 0.0
    calib = defaultdict(lambda: [0, 0])  # bucket → [wins, total]
    MK = defaultdict(lambda: [0.0, 0, 0])  # label -> [brier, hits, n]
    OVER_LINES = [
        ("Over 1.5", lambda m: m.over15), ("Over 2.5", lambda m: m.over25),
        ("Over 3.5", lambda m: m.over35), ("Over 0.5", lambda m: 1 - m.under05),
        ("Over 4.5", lambda m: 1 - m.under45),
    ]

    def acc(label, pm, actual):
        s = MK[label]
        s[0] += (pm - (1 if actual else 0)) ** 2
        if (pm > 0.5) == actual: s[1] += 1
        s[2] += 1

    # Ensemble sweep: poisson vs blended with VTI-gap logistic
    BLEND_W = [0.0, 0.2, 0.3, 0.4, 0.5]
    blend_brier = {w: [0.0, 0] for w in BLEND_W}
    lg_stats = defaultdict(lambda: [0.0, 0])  # league_id -> [brier, n]

    def vti_p3(home_row, away_row):
        hv = (home_row.get("scores") or {}).get("vti")
        av = (away_row.get("scores") or {}).get("vti")
        if hv is None or av is None:
            return None
        diff = float(hv) - float(av)
        score = 1 / (1 + math.exp(-diff / 60))
        pd_ = 0.26 * math.exp(-((diff / 90) ** 2))
        ph = max(0.02, score - pd_ / 2)
        pa = 1 - ph - pd_
        return (ph, pd_, pa)

    skipped = 0
    for lg_id, fx in fixtures_all:
        tm = team_maps.get(lg_id, {})
        h_name = fx["teams"]["home"]["name"]
        a_name = fx["teams"]["away"]["name"]
        home = lookup(tm, h_name)
        away = lookup(tm, a_name)
        if not home or not away:
            skipped += 1
            continue
        lams = lambdas(home, away)
        if not lams:
            skipped += 1
            continue
        lam_h, lam_a = lams

        goals = fx["goals"]
        hg, ag = goals["home"], goals["away"]
        if hg is None or ag is None:
            skipped += 1
            continue

        # ── Our maths ──
        grid = compute_score_grid(lam_h, lam_a, DIXON_COLES_RHO)
        mp = derive_markets(grid)
        p3 = (mp.home_win, mp.draw, mp.away_win)

        actual_idx = 0 if hg > ag else (1 if hg == ag else 2)
        total_goals = hg + ag
        over25 = total_goals > 2
        btts = hg > 0 and ag > 0
        for label, fn in OVER_LINES:
            acc("O/U " + label.split()[1], fn(mp), total_goals > float(label.split()[1]))
        acc("BTTS Yes", mp.btts, btts)
        acc("BTTS No", mp.btts_no, not btts)
        acc("DC Home/Draw", mp.home_win + mp.draw, not (ag > hg))
        acc("DC Draw/Away", mp.away_win + mp.draw, not (hg > ag))
        acc("DC Home/Away", mp.home_win + mp.away_win, hg != ag)
        dnb_h = mp.home_win / max(1e-9, mp.home_win + mp.away_win)
        acc("DNB Home", dnb_h, hg > ag)

        # Ensemble blend tracking
        v3 = vti_p3(home, away)
        for w in BLEND_W:
            if v3:
                pb = tuple((1 - w) * p + w * q for p, q in zip(p3, v3))
            else:
                pb = p3
            blend_brier[w][0] += brier_multiclass(pb, actual_idx)
            blend_brier[w][1] += 1
        ls = lg_stats[lg_id]
        ls[0] += brier_multiclass(p3, actual_idx); ls[1] += 1

        # Metrics
        brier_hd += brier_multiclass(p3, actual_idx)
        brier_o25 += (mp.over25 - (1 if over25 else 0)) ** 2
        p_act = max(p3[actual_idx], 1e-9)
        ll_sum -= math.log(p_act)

        if (mp.over25 > 0.5) == over25:
            o25_hits += 1
        if ("btts" if btts else "btts_no") == (
            "btts" if mp.btts > mp.btts_no else "btts_no"
        ):
            btts_hits += 1
        btts_n += 1

        fav_i = max(range(3), key=lambda i: p3[i])
        odds_fx = fx.get("odds") or []
        fav_odds = None
        if odds_fx:
            try:
                vals = odds_fx[0].get("bookmakers", [])
                if vals:
                    bets = {b["id"]: b for b in vals[0].get("bets", [])}
                    m = bets.get(1, {}).get("values", [])
                    if len(m) >= 3:
                        fav_odds = float(m[fav_i]["odd"])
            except Exception:
                pass
        if fav_i == actual_idx:
            fav_hits += 1
        if fav_odds and fav_odds > 1.0:
            stake += 1
            if fav_i == actual_idx:
                ret += fav_odds - 1

        bucket = min(9, int(max(p3[fav_i], 0) * 10)) / 10
        calib[bucket][0] += 1 if fav_i == actual_idx else 0
        calib[bucket][1] += 1
        n += 1

    if n == 0:
        print("[Backtest] ❌ No gradable fixtures (coverage mismatch?).")
        return

    print("\n══════════════ INTEL BACKTEST REPORT ══════════════")
    print(f"  Fixtures graded          : {n}  (skipped {skipped})")
    print(f"  Brier H/D/A              : {brier_hd / n:.4f}   (random ≈ 0.667)")
    print(f"  Log-loss                 : {ll_sum / n:.4f}   (random ≈ 1.099)")
    print(f"  Brier Over 2.5           : {brier_o25 / n:.4f}")
    print(f"  O/U 2.5 directional acc  : {o25_hits}/{n} = {o25_hits/n:.1%}")
    print(f"  BTTS directional acc     : {btts_hits}/{n} = {btts_hits/n:.1%}")
    print(f"  Favourite hit rate       : {fav_hits}/{n} = {fav_hits/n:.1%}")
    if stake:
        print(f"  Flat-stake favourite ROI : {(ret - stake) / stake:+.1%}  ({stake:.0f} units)")
    print("  Calibration (model fav prob → actual):")
    for b in sorted(calib):
        w, t = calib[b]
        if t >= 5:
            print(f"    {b:.0%}-{b+0.1:.0%}: {w}/{t} = {w/t:.1%}")
    print("\n  ── Per-market accuracy / Brier ──")
    for label in sorted(MK):
        b, h, t = MK[label]
        print(f"    {label:<16}: acc {h/t:5.1%}   brier {b/t:.4f}")
    print("\n  ── Per-league Brier H/D/A ──")
    for lg_id, (b, t) in sorted(lg_stats.items()):
        print(f"    league {lg_id:<4}: {b/t:.4f}  ({t} fixtures)")
    print("\n  ── Ensemble sweep (Poisson + w×VTI logistic) ──")
    for w in BLEND_W:
        b, t = blend_brier[w]
        tag = "  ← pure Poisson" if w == 0 else ("  ← best" if b == min(v[0] for v in blend_brier.values()) and t else "")
        print(f"    w={w:.1f}: brier {b/t:.4f}{tag}")
    print("════════════════════════════════════════════════════")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", required=True,
                    help='Comma list "IntelLeagueName:ApiFootballId" e.g. "Premier League:39"')
    ap.add_argument("--season-api", type=int, required=True, help="API-Football season year, e.g. 2024")
    ap.add_argument("--season-intel", required=True, help="Intel DB season label, e.g. 2024-2025")
    ap.add_argument("--max-fixtures", type=int, default=380)
    run(ap.parse_args())
