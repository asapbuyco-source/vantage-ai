"""
intel_model_feed.py
──────────────────
Bridges the Vantage Intelligence Supabase dataset into the quant model for
better predictions. Consumed by elo_rating (VTI seeding), probability_engine
(λ priors, consistency over-dispersion, momentum) and quant_pipeline
(squad-depth injury impact).

Reads are anonymous (public RLS). Cached in-memory per process.
"""
import os
import time
import requests

SUPABASE_URL = os.environ.get(
    "VITE_INTEL_SUPABASE_URL", "https://fwatymrvrtvcixtpbncu.supabase.co"
)
SUPABASE_ANON = os.environ.get(
    "VITE_INTEL_SUPABASE_ANON_KEY", "sb_publishable_JCgVDFMMrlmGBXHyH3xFtw_VSbWwe8K"
)

_cache: dict = {}
_cache_ts: dict = {}
TTL = 6 * 3600  # refresh every 6h


def _sb(table: str, params: dict | None = None) -> list:
    from urllib.parse import quote
    qs = "&".join(f"{k}={quote(str(v), safe='.,()*')}" for k, v in (params or {}).items())
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{qs}", headers={
        "apikey": SUPABASE_ANON, "Authorization": f"Bearer {SUPABASE_ANON}",
    }, timeout=15)
    if r.status_code != 200:
        return []
    return r.json()


def _cached(key: str, fetch, ttl: float = TTL):
    if key in _cache and time.time() - _cache_ts.get(key, 0) < ttl:
        return _cache[key]
    val = fetch()
    _cache[key] = val
    _cache_ts[key] = time.time()
    return val


def _norm(name: str) -> str:
    return (name or "").lower().replace("fc", "").replace("cf", "").strip()


def get_team_rows() -> dict:
    """All team_intelligence rows keyed by (normalized name, season)."""
    def _fetch():
        rows = _sb("team_intelligence", {"select": "*", "limit": "2000"})
        out = {}
        for r in rows:
            out[(_norm(r.get("team_name", "")), r.get("season", ""))] = r
            out[(str(r.get("id", "")).replace("-", " "), r.get("season", ""))] = r
        return out
    return _cached("team_rows", _fetch)


def get_latest_season() -> str | None:
    def _fetch():
        rows = _sb("team_intelligence", {"select": "season", "order": "season.desc", "limit": "1"})
        return rows[0]["season"] if rows else None
    return _cached("latest_season", _fetch)


def _find_team(name: str, season: str | None = None):
    rows = get_team_rows()
    if not season:
        season = get_latest_season()
    if not season:
        return None
    key = _norm(name)
    row = rows.get((key, season))
    if not row:
        # fuzzy: unique substring match
        hits = [v for k, v in rows.items() if k[1] == season and key and (key in k[0] or k[0] in key)]
        if len(hits) == 1:
            row = hits[0]
    return row


def get_team_vti(name: str, season: str | None = None) -> float | None:
    row = _find_team(name, season)
    if not row:
        return None
    vti = (row.get("scores") or {}).get("vti")
    return float(vti) if vti is not None else None


def get_team_xg(name: str, season: str | None = None) -> dict:
    """Return {xg_per90, xga_per90, goals_per90, consistency} or empty dict."""
    row = _find_team(name, season)
    if not row:
        return {}
    raw = row.get("raw_stats") or {}
    scores = row.get("scores") or {}
    return {
        "xg_per90": raw.get("xg_per90"),
        "xga_per90": raw.get("xga_per90"),
        "goals_per90": raw.get("goals_per90"),
        "consistency": scores.get("consistency"),
        "vti": scores.get("vti"),
    }


def get_vti_trend(name: str) -> list:
    """VTI across the 3 stored seasons, oldest → newest. Used for momentum."""
    rows = get_team_rows()
    key = _norm(name)
    out = []
    for (k, season), row in rows.items():
        if k == key:
            vti = (row.get("scores") or {}).get("vti")
            if vti is not None:
                out.append((season, float(vti)))
    out.sort(key=lambda x: x[0])
    return out


def get_squad_top(name: str, season: str | None = None) -> list:
    """Top players by VPII with minutes — for injury impact estimates."""
    row = _find_team(name, season)
    if not row:
        return []
    return row.get("squad") or []


# ── Convenience ────────────────────────────────────────────────────────────────

def vti_to_elo(vti: float) -> float:
    """Map VTI (0-100) to an Elo baseline (1200-2000)."""
    return 1200 + max(0, min(100, vti)) * 8.0


def momentum_from_vti(vti_now: float, vti_prev: float | None) -> float:
    """Return a multiplier (0.98-1.04) for expected goals from VTI trend."""
    if vti_prev is None:
        return 1.0
    delta = vti_now - vti_prev
    if delta >= 4:
        return 1.04
    if delta <= -4:
        return 0.96
    return 1.0


def dispersion_reliability(consistency: float | None) -> float:
    """Consistency score (50 = avg). Low score = streaky team whose short-form
    is unreliable → shrink form-derived λ toward the stable season aggregate.
    Returns a reliability weight in [0.80, 1.00]; blended as:
        final_mu = form_mu * rel + intel_xg * (1 - rel)"""
    if consistency is None:
        return 1.0
    if consistency < 40:
        return 0.80
    if consistency < 48:
        return 0.88
    return 1.0


def squad_injury_penalty(squad: list, sidelined: int) -> float:
    """Refine the count-based injury penalty with squad quality.
    A team whose top-5 VPII is elite loses more per missing player.
    Returns an ADDITIONAL penalty (0.0-0.12) to multiply mu by (1 - penalty)."""
    if sidelined <= 0 or not squad:
        return 0.0
    vpiis = []
    for p in squad:
        try:
            v = float(p.get("vpii") if isinstance(p, dict) else getattr(p, "vpii", None))
            if v:
                vpiis.append(v)
        except (TypeError, ValueError):
            continue
    if not vpiis:
        return min(0.10, sidelined * 0.015)
    top5 = sorted(vpiis, reverse=True)[:5]
    avg = sum(top5) / len(top5)
    star_factor = max(0.5, min(1.5, avg / 80.0))
    return min(0.12, sidelined * 0.03 * star_factor * 0.5)