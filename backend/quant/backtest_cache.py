"""
backtest_cache.py
─────────────────
Standalone Vault-style backtest using cached Sportmonks data from .vantage_cache/.

Loads 30 days of cached fixture/odds/scores data, runs the quant pipeline, grades
predictions against actual results, and applies Vault staking rules (Quarter-Kelly,
5% cap, max 7 picks/day, EV >= 2% filter, compounding bankroll).
"""

import os, sys, json, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from dataclasses import dataclass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local'))

LAGOS_TZ = timezone(timedelta(hours=1))

from data_pipeline import MatchData, TeamStats, OddsData
from quant_pipeline import run_pipeline
from ev_engine import evaluate_all_markets, ValueBet
from probability_engine import compute_combined, CombinedProbabilities
from poisson_model import compute_probabilities, compute_dynamic_rho
from elo_rating import get_team_rating, is_derby_match, DEFAULT_ELO
from league_config import get_league_info
from kelly_optimizer import kelly_stake_pct, market_max_stake_pct

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.vantage_cache')

MAX_DAILY_PICKS = 7
MAX_STAKE_PCT = 0.03  # 3% hard cap
KELLY_FRACTION = 0.25

# Sportmonks market_id -> required fields mapping
# market_id=1: 3way result
# market_id=80: Goals Over/Under (total field = line)
# market_id=15: BTTS

def _pick_best_bookmaker(odds_list, market_id):
    """Pick the best bookmaker for a given market, preferring those with all entries."""
    by_bm = defaultdict(list)
    for o in odds_list:
        if o.get('market_id') == market_id:
            by_bm[o.get('bookmaker_id')].append(o)

    # Prefer bookmaker with 3 entries (Home/Draw/Away) for 3way
    best = None
    best_count = 0
    for bm_id, entries in by_bm.items():
        if len(entries) > best_count:
            best_count = len(entries)
            best = entries
    return best or []

def _extract_odds(odds_list):
    """Convert Sportmonks odds array to OddsData."""
    od = OddsData()

    # Get preferred bookmaker first
    bm_3way = _pick_best_bookmaker(odds_list, 1)
    if len(bm_3way) >= 2:
        for o in bm_3way:
            label = (o.get('label', '') or '').lower()
            val = float(o.get('value', 0))
            if 'home' in label and 'away' not in label:
                od.home_odds = val
            elif 'draw' in label:
                od.draw_odds = val
            elif 'away' in label and 'home' not in label:
                od.away_odds = val
        # Opening odds (take the first bookmaker's entry for opening)
        for o in odds_list:
            if o.get('market_id') == 1:
                od.opening_home_odds = od.home_odds
                od.opening_away_odds = od.away_odds
                od.opening_draw_odds = od.draw_odds
                break

    # Goals Over/Under (multiple lines)
    for o in odds_list:
        if o.get('market_id') != 80:
            continue
        total = o.get('total')
        label = (o.get('label', '') or '').lower()
        val = float(o.get('value', 0))
        if total == '2.5' or total == 2.5:
            if 'over' in label:
                od.over25_odds = val
            elif 'under' in label:
                od.under25_odds = val
        elif total == '1.5' or total == 1.5:
            if 'over' in label:
                od.over15_odds = val
            elif 'under' in label:
                od.under15_odds = val
        elif total == '3.5' or total == 3.5:
            if 'over' in label:
                od.over35_odds = val
            elif 'under' in label:
                od.under35_odds = val

    # BTTS
    for o in odds_list:
        if o.get('market_id') != 15:
            continue
        label = (o.get('label', '') or '').lower()
        val = float(o.get('value', 0))
        if 'yes' in label:
            od.btts_yes_odds = val
        elif 'no' in label:
            od.btts_no_odds = val

    # Double Chance
    bm_dc = _pick_best_bookmaker(odds_list, 14)  # DC is market_id=14
    for o in bm_dc:
        label = (o.get('label', '') or '').lower()
        val = float(o.get('value', 0))
        if '1x' in label or 'home/draw' in label:
            od.dc_1x_odds = val
        elif '12' in label or 'home/away' in label:
            od.dc_12_odds = val
        elif 'x2' in label or 'draw/away' in label:
            od.dc_x2_odds = val

    # Asian Handicap -0.5 (market_id=6, handicap=-0.5)
    for o in odds_list:
        if o.get('market_id') == 6:
            handicap = str(o.get('handicap', '') or '')
            label = (o.get('label', '') or '').lower()
            val = float(o.get('value', 0))
            if handicap == '-0.5' and 'home' in label:
                od.ah_home_minus05 = val
            elif handicap == '0.5' and 'away' in label:
                od.ah_away_plus05 = val

    # For backtesting: set odds timestamp to cache time so staleness checks pass
    # (Live freshness guard of 75min would otherwise reject all historical picks)
    od.odds_fetched_at = datetime.now(timezone.utc).isoformat()
    return od


def _extract_score(fixture_data):
    """Extract 'H-A' score string from Sportmonks fixture scores."""
    scores = fixture_data.get('scores', [])
    participants = fixture_data.get('participants', [])
    home_p = next((p for p in participants if p.get('meta', {}).get('location') == 'home'), {})
    away_p = next((p for p in participants if p.get('meta', {}).get('location') == 'away'), {})
    home_id = home_p.get('id')
    away_id = away_p.get('id')
    if not home_id or not away_id:
        return None
    home_goals = away_goals = None
    for s in scores:
        p_id = s.get('participant_id')
        desc = s.get('description', '')
        goals = s.get('score', {}).get('goals')
        if p_id == home_id and desc in ('CURRENT', 'FT', 'FINAL'):
            home_goals = goals
        if p_id == away_id and desc in ('CURRENT', 'FT', 'FINAL'):
            away_goals = goals
    if home_goals is None or away_goals is None:
        return None
    return f"{home_goals}-{away_goals}"


def _grade_prediction(prediction, score_str):
    """Grade a single prediction against an actual score string 'H-A'."""
    if not score_str or '-' not in score_str:
        return 'pending'
    h, a = map(int, score_str.split('-'))
    p = (prediction or '').lower()

    if p in ('home', 'home_win', '1'):
        return 'won' if h > a else 'lost'
    if p in ('draw', 'x'):
        return 'won' if h == a else 'lost'
    if p in ('away', 'away_win', '2'):
        return 'won' if h < a else 'lost'
    if p in ('over25', 'over_25', 'over 2.5'):
        return 'won' if (h + a) > 2 else ('lost' if (h + a) < 2 else 'void')
    if p in ('under25', 'under_25', 'under 2.5'):
        return 'won' if (h + a) < 2 else ('lost' if (h + a) > 2 else 'void')
    if p in ('over15', 'over_15', 'over 1.5'):
        return 'won' if (h + a) > 1 else 'lost'
    if p in ('under15', 'under_15', 'under 1.5'):
        return 'won' if (h + a) < 1 else 'lost'
    if p in ('over35', 'over_35', 'over 3.5'):
        return 'won' if (h + a) > 3 else ('void' if (h + a) == 3 else 'lost')
    if p in ('under35', 'under_35', 'under 3.5'):
        return 'won' if (h + a) < 3 else ('void' if (h + a) == 3 else 'lost')
    if p in ('btts_yes', 'btts', 'btts yes', 'gg'):
        return 'won' if h > 0 and a > 0 else 'lost'
    if p in ('btts_no', 'ng'):
        return 'won' if h == 0 or a == 0 else 'lost'
    if p in ('dc_1x', '1x', 'home_or_draw'):
        return 'won' if h >= a else 'lost'
    if p in ('dc_x2', 'x2', 'draw_or_away'):
        return 'won' if h <= a else 'lost'
    if p in ('dc_12', '12', 'home_or_away'):
        return 'won' if h != a else 'lost'
    if p in ('dnb_home', 'dnb 1', 'home_dnb'):
        return 'won' if h > a else ('void' if h == a else 'lost')
    if p in ('dnb_away', 'dnb 2', 'away_dnb'):
        return 'won' if h < a else ('void' if h == a else 'lost')

    return 'pending'


def load_cached_fixtures(date_str):
    """Load fixtures from Sportmonks cache for a given date."""
    fpath = os.path.join(CACHE_DIR, 'fixtures', f"{date_str}.json")
    if not os.path.exists(fpath):
        return None
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('response', {}).get('data', [])


def build_match_data(raw_fixtures):
    """Convert Sportmonks fixture list to MatchData objects."""
    matches = []
    for fix in raw_fixtures:
        fid = fix.get('id')
        if not fid:
            continue
        league_raw = fix.get('league', {}) or {}
        league_id = league_raw.get('id', 0)
        league_name = league_raw.get('name', 'Unknown')
        league_info = get_league_info(league_id)
        league_tier = league_info.get('tier', 3) if league_info else 3

        participants = fix.get('participants', [])
        home_p = next((p for p in participants if p.get('meta', {}).get('location') == 'home'), {})
        away_p = next((p for p in participants if p.get('meta', {}).get('location') == 'away'), {})
        home_id = home_p.get('id', 0)
        away_id = away_p.get('id', 0)
        home_name = home_p.get('name', 'Home')
        away_name = away_p.get('name', 'Away')

        kickoff = fix.get('starting_at', '')
        try:
            kt = datetime.strptime(kickoff, '%Y-%m-%d %H:%M:%S')
            kickoff_utc = kt.isoformat() + 'Z'
            kickoff_local = (kt + timedelta(hours=1)).strftime('%H:%M')
        except Exception:
            kickoff_utc = kickoff
            kickoff_local = ''

        md = MatchData(
            fixture_id=str(fid),
            league=league_name,
            league_id=league_id,
            league_tier=min(league_tier, 3),  # cap at 3 for cache backtest
            home_team=home_name,
            home_team_id=home_id,
            away_team=away_name,
            away_team_id=away_id,
            kickoff_utc=kickoff_utc,
            kickoff_local=kickoff_local,
            provider_source='sportmonks_cache',
        )

        # Extract odds
        md.odds = _extract_odds(fix.get('odds', []))

        # Estimated expected goals from league averages
        league_avg = 2.65  # default
        md.expected_goals_home = league_avg / 2 * 1.15  # home advantage
        md.expected_goals_away = league_avg / 2 * 0.85

        # Default TeamStats (no form data in cache for this format)
        md.home_stats = TeamStats(team_id=home_id, team_name=home_name)
        md.away_stats = TeamStats(team_id=away_id, team_name=away_name)

        # Sidelined count
        sidelined = fix.get('sidelined', []) or []
        md.home_sidelined_count = sum(1 for s in sidelined if s.get('participant_id') == home_id)
        md.away_sidelined_count = sum(1 for s in sidelined if s.get('participant_id') == away_id)

        matches.append(md)

    return matches


def run_cache_backtest(days=30, starting_bankroll=10000.0):
    print(f"\n{'='*70}")
    print(f"  CACHE BACKTEST — {days}-DAY VAULT SIMULATION")
    print(f"  Starting Bankroll: {starting_bankroll:,.0f} FCFA")
    print(f"  Strategy: Quarter-Kelly ({KELLY_FRACTION}x), {MAX_STAKE_PCT*100:.0f}% cap, max {MAX_DAILY_PICKS} picks/day")
    print(f"{'='*70}\n")

    end_date = datetime(2026, 6, 6, tzinfo=LAGOS_TZ)  # day after last cached date

    bankroll = starting_bankroll
    all_picks = []
    daily_log = []
    market_stats = defaultdict(lambda: {"wins": 0, "losses": 0, "voids": 0, "staked": 0.0, "returned": 0.0, "picks": 0})
    max_bankroll = bankroll
    max_drawdown_pct = 0.0
    total_picks = 0
    wins = losses = voids = 0

    for i in range(days):
        date_str = (end_date - timedelta(days=i+1)).strftime("%Y-%m-%d")
        print(f"\n[Day {i+1}/{days}] {date_str} ", end='', flush=True)

        raw_fixtures = load_cached_fixtures(date_str)
        if not raw_fixtures:
            print("- No cached data")
            continue

        print(f"- {len(raw_fixtures)} fixtures")

        # Only process completed matches (state_id=5)
        completed = [f for f in raw_fixtures if f.get('state_id') == 5]
        if not completed:
            print(f"  No completed matches")
            continue

        matches = build_match_data(completed)
        matches_with_odds = [m for m in matches if m.odds.has_odds()]
        if not matches_with_odds:
            print(f"  No matches with valid odds")
            continue

        # Run pipeline with preloaded matches
        try:
            result = run_pipeline(date_str, dry_run=True, preloaded_matches=matches_with_odds)
        except Exception as e:
            print(f"  Pipeline error: {e}")
            continue

        if result.get('status') != 'success':
            print(f"  Pipeline: {result.get('reason', 'unknown')}")
            continue

        predictions = result.get('predictions', [])
        if not predictions:
            print(f"  No predictions")
            continue

        # Deduplicate
        seen_fids = set()
        deduped = []
        for pred in predictions:
            fid = pred.get('fixture_id', '')
            if fid not in seen_fids:
                seen_fids.add(fid)
                deduped.append(pred)
        predictions = deduped

        # Build map of fixture_id -> actual score
        score_map = {}
        for fix in completed:
            fid = str(fix.get('id'))
            sc = _extract_score(fix)
            if sc:
                score_map[fid] = sc

        # Apply Vault filters and grade
        daily_picks = []
        for pred in predictions:
            fid = pred.get('fixture_id', '')
            actual_score = score_map.get(fid)
            if not actual_score:
                continue

            prediction = pred.get('prediction', pred.get('bet_type', ''))
            if not prediction or prediction == 'N/A':
                continue

            odds = pred.get('odds', 0)
            probability = pred.get('probability', 0)
            ev_pct = pred.get('ev_pct', 0)
            league_tier = pred.get('league_tier', 2)

            if odds <= 1.0 or probability <= 0:
                continue
            if ev_pct < 2:
                continue

            # Compute Kelly stake on-the-fly (bypass vault_eligible guard for backtesting)
            cal_tier = pred.get('calibration_tier', 'none')
            base_k = kelly_stake_pct(probability, odds, prediction, cal_tier)
            kelly_pct = max(0, base_k)
            if kelly_pct <= 0:
                continue
            max_sp = market_max_stake_pct(prediction, cal_tier)
            stake_pct = min(kelly_pct / 100.0, MAX_STAKE_PCT, max_sp)
            stake_amount = round(bankroll * stake_pct, 2)
            if stake_amount < 1:
                continue

            grade = _grade_prediction(prediction, actual_score)
            if grade == 'pending':
                continue

            if grade == 'won':
                profit = round(stake_amount * (odds - 1), 2)
            elif grade == 'lost':
                profit = -stake_amount
            else:  # void
                profit = 0.0

            daily_picks.append({
                'fixture_id': fid,
                'match': pred.get('home_team', '?') + ' vs ' + pred.get('away_team', '?'),
                'prediction': prediction,
                'odds': odds,
                'probability': probability,
                'ev_pct': ev_pct,
                'stake': stake_amount,
                'grade': grade,
                'profit': profit,
            })

        if not daily_picks:
            print(f"  {len(predictions)} preds, 0 passed filters")
            continue

        daily_picks.sort(key=lambda p: p['ev_pct'], reverse=True)
        selected = daily_picks[:MAX_DAILY_PICKS]

        day_profit = 0.0
        for pick in selected:
            total_picks += 1
            if pick['grade'] == 'won':
                wins += 1
            elif pick['grade'] == 'lost':
                losses += 1
            else:
                voids += 1
            day_profit += pick['profit']
            bankroll += pick['profit']

            symbol = '++' if pick['profit'] > 0 else ('--' if pick['profit'] < 0 else '~~')
            print(f"  {symbol} {pick['match'][:40]} | {pick['prediction']} @ {pick['odds']:.2f} | "
                  f"stake={pick['stake']:.0f} | {pick['grade']} ({pick['profit']:+.0f})")

        max_bankroll = max(max_bankroll, bankroll)
        drawdown = (max_bankroll - bankroll) / max_bankroll if max_bankroll > 0 else 0
        max_drawdown_pct = max(max_drawdown_pct, drawdown)

        for pick in selected:
            market = pick['prediction']
            market_stats[market]['picks'] += 1
            market_stats[market]['staked'] += pick['stake']
            if pick['grade'] == 'won':
                market_stats[market]['wins'] += 1
                market_stats[market]['returned'] += pick['stake'] * pick['odds']
            elif pick['grade'] == 'lost':
                market_stats[market]['losses'] += 1

        daily_log.append({
            'date': date_str,
            'picks': len(selected),
            'profit': day_profit,
            'bankroll': bankroll,
        })
        print(f"  Day: {len(selected)} picks | P&L: {day_profit:+.0f} | Bankroll: {bankroll:,.0f}")

    # ── Final Report ─────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  BACKTEST RESULTS")
    print(f"{'='*70}")
    roi = ((bankroll - starting_bankroll) / starting_bankroll * 100) if starting_bankroll > 0 else 0
    hit_rate = (wins / (wins + losses) * 100) if (wins + losses) > 0 else 0

    print(f"  Starting Bankroll: {starting_bankroll:,.0f} FCFA")
    print(f"  Final Bankroll:    {bankroll:,.0f} FCFA")
    print(f"  Total P&L:         {bankroll - starting_bankroll:+,.0f} FCFA")
    print(f"  ROI:               {roi:+.1f}%")
    print(f"  Total Picks:       {total_picks}")
    print(f"  Wins/Losses/Voids: {wins}/{losses}/{voids}")
    print(f"  Hit Rate:          {hit_rate:.1f}%")
    print(f"  Max Drawdown:      {max_drawdown_pct*100:.1f}%")

    print(f"\n{'─'*70}")
    print(f"  Per-Market Breakdown:")
    for market, stats in sorted(market_stats.items(), key=lambda x: -x[1]['picks']):
        m_wins = stats['wins']
        m_losses = stats['losses']
        m_total = m_wins + m_losses
        m_hr = (m_wins / m_total * 100) if m_total > 0 else 0
        m_roi = ((stats['returned'] - stats['staked']) / stats['staked'] * 100) if stats['staked'] > 0 else 0
        print(f"    {market:20s}  picks={stats['picks']:3d}  HR={m_hr:5.1f}%  ROI={m_roi:+.1f}%  "
              f"W={m_wins} L={m_losses}")

    return {
        'final_bankroll': bankroll,
        'roi': roi,
        'total_picks': total_picks,
        'wins': wins,
        'losses': losses,
        'voids': voids,
        'hit_rate': hit_rate,
        'max_drawdown_pct': max_drawdown_pct,
        'daily_log': daily_log,
        'market_stats': dict(market_stats),
    }


if __name__ == '__main__':
    result = run_cache_backtest(days=30, starting_bankroll=10000.0)
