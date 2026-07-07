# Vantage AI - Comprehensive Implementation Plan

**Generated:** 2026-07-07  
**Audit Period:** Last 14 days (61 predictions, 36 matches with corner data)  
**Overall Performance:** 60% win rate, +0.7% ROI

---

## Executive Summary

### Critical Findings

1. **Corner predictions are severely broken** - 8.3% actual hit rate vs 80% predicted (Brier: 0.67)
2. **Over 1.5 Goals is the star performer** - 84% win rate, should be promoted
3. **Double Chance X2 is bleeding ROI** - 38% win rate, needs suppression
4. **54% of losses are overconfident** - model gives 65%+ probability to losing bets
5. **First Half markets are dead code** - probabilities computed but no odds fetched
6. **Accumulators have no backtesting** - no way to know if they're profitable
7. **Vault has no circuit breaker** - can lose unlimited bankroll without pause

### Audit Coverage

| Component | Status | Key Issue |
|-----------|--------|-----------|
| **Prediction Accuracy** | ✅ Audited | 60% win rate, 21% fixable losses |
| **Corner Predictions** | ✅ Audited | Broken (8.3% vs 80% predicted) |
| **Market Performance** | ✅ Audited | Over 1.5 (84%), DC X2 (38%) |
| **Vault Strategy** | ✅ Audited | No circuit breaker, no Sharpe ratio |
| **Accumulator Engine** | ✅ Audited | No backtesting, greedy selection |
| **Smart Tickets** | ✅ Audited | TicketWizard diverges from backend |
| **Missing Markets** | ✅ Identified | FH, AH, Correct Score, Corners |

---

## Phase 1: Critical Fixes (Week 1-2)

**Goal:** Fix broken features, suppress underperformers, improve calibration

### 1.1 Fix Corner Multiplier

**Problem:** Corner predictions predict 80% chance of Over 8.5, actual is 8.3%

**Root Cause:** `quant_pipeline.py:73` uses `xG * 3.7` multiplier, but actual data shows ~1.2x

**Files to Change:**
- `backend/quant/quant_pipeline.py` (line 73)

**Implementation:**
```python
# BEFORE (line 73)
def _corner_over_prob(total_xg: float, line: float) -> float:
    lam = max(0.5, total_xg * 3.7)  # WRONG
    ...

# AFTER
def _corner_over_prob(total_xg: float, line: float) -> float:
    lam = max(0.5, total_xg * 1.2)  # Calibrated from 14-day audit
    ...
```

**Validation:**
- Run `prediction_audit.py --days 30 --full` after fix
- Target: Brier score < 0.25, actual hit rate within 10% of predicted

**Expected Impact:** Corner predictions become usable for display (not betting yet)

---

### 1.2 Suppress Double Chance X2

**Problem:** 38% win rate (3/8) over 14 days, worst-performing market

**Root Cause:** Model overestimates away team strength in X2 scenarios

**Files to Change:**
- `backend/quant/ev_engine.py` (line ~350, add to disabled markets)
- `backend/quant/calibration_registry.py` (mark as fragile)

**Implementation:**
```python
# ev_engine.py - Add to disabled markets list
DISABLED_MARKETS = {
    "home_win", "away_win", "draw",  # Already disabled
    "double_chance_x2",  # NEW: 38% win rate
}

# calibration_registry.py
FRAGILE_MARKETS = {
    "home_win", "away_win", "draw", "btts_no", "over35", "under35",
    "double_chance_x2",  # NEW
}
```

**Validation:**
- Monitor next 7 days of predictions
- Confirm DC X2 no longer appears in vault picks

**Expected Impact:** +2-3% ROI improvement by removing worst market

---

### 1.3 Add BTTS Blanking Filter

**Problem:** 5 of 6 BTTS losses were "blankings" (one team didn't score)

**Root Cause:** Model doesn't check if either team has low scoring rate

**Files to Change:**
- `backend/quant/risk_filters.py` (add new filter)
- `backend/quant/quant_pipeline.py` (apply filter before vault eligibility)

**Implementation:**
```python
# risk_filters.py - Add new function
def check_btts_blanking_risk(pred: dict) -> tuple[bool, str]:
    """Check if BTTS bet is at risk of blanking."""
    if "btts" not in pred.get("bet_type", "").lower():
        return False, ""
    
    home_avg_scored = pred.get("home_avg_scored", 0) or 0
    away_avg_scored = pred.get("away_avg_scored", 0) or 0
    
    # If either team averages < 0.8 goals per game, high blanking risk
    if home_avg_scored < 0.8 or away_avg_scored < 0.8:
        return True, f"BTTS blanking risk: {pred.get('home_team')} avg {home_avg_scored:.1f}, {pred.get('away_team')} avg {away_avg_scored:.1f}"
    
    return False, ""

# quant_pipeline.py - Apply filter
if "btts" in bet_type.lower():
    blanking_risk, reason = check_btts_blanking_risk(pred)
    if blanking_risk:
        pred["vault_eligible"] = False
        pred["btts_blanking_risk"] = True
```

**Validation:**
- Check next 14 days: BTTS win rate should improve from 54% to 65%+

**Expected Impact:** Reduce BTTS losses by ~30%

---

### 1.4 Fix Overconfidence Calibration

**Problem:** 54% of losses had 65%+ predicted probability

**Root Cause:** Calibration factors in `calibration_registry.py` are too generous

**Files to Change:**
- `backend/quant/calibration_registry.py` (adjust MARKET_FACTORS)

**Implementation:**
```python
# calibration_registry.py - Tighten calibration
MARKET_FACTORS = {
    # BEFORE
    "over25": (0.88, 0.82, 0.82, 130, "2026-06-25"),
    "btts": (0.57, 0.50, 0.87, 160, "2026-06-25"),
    
    # AFTER (more conservative)
    "over25": (0.88, 0.82, 0.75, 130, "2026-07-07"),  # 0.82 → 0.75
    "btts": (0.57, 0.50, 0.80, 160, "2026-07-07"),  # 0.87 → 0.80
}
```

**Validation:**
- Run backtest on last 30 days
- Target: Overconfident losses drop from 54% to <30%

**Expected Impact:** Fewer high-confidence losses, more realistic probabilities

---

### 1.5 Promote Over 1.5 Goals

**Problem:** 84% win rate but only 19 picks in 14 days (underutilized)

**Root Cause:** EV engine doesn't prioritize Over 1.5 enough

**Files to Change:**
- `backend/quant/ev_engine.py` (boost Over 1.5 EV calculation)
- `backend/quant/quant_pipeline.py` (increase allocation)

**Implementation:**
```python
# ev_engine.py - Boost Over 1.5 EV
def evaluate_all_markets(...):
    ...
    if market == "Over 1.5 Goals":
        ev *= 1.3  # 30% EV boost for proven market
    ...

# quant_pipeline.py - Increase allocation
# In _select_vault_picks(), prioritize Over 1.5
if "over 1.5" in pred.get("bet_type", "").lower():
    pred["vault_priority_boost"] = True
```

**Validation:**
- Monitor next 14 days: Over 1.5 should appear in 40%+ of vault picks (currently ~30%)

**Expected Impact:** +3-5% overall ROI by increasing best market allocation

---

### 1.6 Add "Hedge Over 1.5" Saver

**Problem:** 7 losses (29%) were close (1 goal short), mostly Over 2.5 → Over 1.5 would have won

**Root Cause:** No hedge recommendation for high-confidence Over 2.5 picks

**Files to Change:**
- `backend/quant/quant_pipeline.py` (add hedge field)
- `components/MatchCardAlpha.tsx` (display hedge suggestion)

**Implementation:**
```python
# quant_pipeline.py - Add hedge recommendation
if "over 2.5" in bet_type.lower() and probability > 0.70:
    over15_prob = pred.get("over15_prob", 0)
    if over15_prob > 0.85:
        pred["hedge_suggestion"] = {
            "market": "Over 1.5 Goals",
            "probability": over15_prob,
            "reason": "Insurance bet: if Over 2.5 fails by 1 goal, Over 1.5 still wins"
        }

# MatchCardAlpha.tsx - Display hedge
{match.hedge_suggestion && (
  <div className="text-xs text-blue-400 mt-1">
    💡 Hedge: {match.hedge_suggestion.market} ({(match.hedge_suggestion.probability * 100).toFixed(0)}%)
  </div>
)}
```

**Validation:**
- Track hedge suggestions vs actual outcomes
- Target: 50%+ of "close losses" would have been saved by hedge

**Expected Impact:** Reduce close losses by ~40%

---

## Phase 2: Market Expansion (Week 3-4)

**Goal:** Add missing markets that have high expected value

### 2.1 Wire First Half Markets (P0 - Lowest Hanging Fruit)

**Problem:** First Half probabilities are computed but no odds fetched (dead code)

**Root Cause:** `ev_engine.py:MARKET_TO_ODDS_FIELD` missing FH entries

**Files to Change:**
- `backend/quant/api_football_client.py` (fetch FH odds)
- `backend/quant/ev_engine.py` (add FH to odds field map)

**Implementation:**
```python
# api_football_client.py - Fetch FH odds
def fetch_odds_for_fixture(fixture_id: int, bookmaker_id: int = 8) -> dict:
    ...
    elif market_name == "Goals Over/Under First Half":
        for v in values:
            if v["value"] == "Over 0.5": odds_data["fh_over05_odds"] = float(v["odd"])
            elif v["value"] == "Over 1.5": odds_data["fh_over15_odds"] = float(v["odd"])
    elif market_name == "Match Winner First Half":
        for v in values:
            if v["value"] == "Home": odds_data["fh_home_odds"] = float(v["odd"])
            elif v["value"] == "Draw": odds_data["fh_draw_odds"] = float(v["odd"])
            elif v["value"] == "Away": odds_data["fh_away_odds"] = float(v["odd"])
    ...

# ev_engine.py - Add to MARKET_TO_ODDS_FIELD
MARKET_TO_ODDS_FIELD = {
    ...
    "FH Over 0.5": "fh_over05_odds",
    "FH Over 1.5": "fh_over15_odds",
    "FH BTTS": "fh_btts_odds",  # If available
    "1H Home Win": "fh_home_odds",
    "1H Draw": "fh_draw_odds",
    "1H Away Win": "fh_away_odds",
}
```

**Validation:**
- Run pipeline on test date
- Confirm FH markets appear in `all_value_bets`

**Expected Impact:** 3-5 new markets, FH Over 0.5 typically has 70%+ hit rate

---

### 2.2 Add Correct Score Market (P1)

**Problem:** High-odds market with Poisson grid ready but no odds fetched

**Root Cause:** No correct score odds in API-Football fetch

**Files to Change:**
- `backend/quant/api_football_client.py` (fetch correct score odds)
- `backend/quant/ev_engine.py` (evaluate correct score EV)
- `backend/quant/quant_pipeline.py` (add to value bets)

**Implementation:**
```python
# api_football_client.py
def fetch_odds_for_fixture(fixture_id: int, bookmaker_id: int = 8) -> dict:
    ...
    elif market_name == "Correct Score":
        correct_scores = {}
        for v in values:
            # v["value"] = "1-0", "2-1", etc.
            correct_scores[v["value"]] = float(v["odd"])
        odds_data["correct_score_odds"] = correct_scores
    ...

# ev_engine.py - Evaluate correct score
def evaluate_correct_score(pred: dict, odds_data: dict) -> list[ValueBet]:
    top_scorelines = pred.get("top_scorelines", [])
    correct_odds = odds_data.get("correct_score_odds", {})
    
    value_bets = []
    for scoreline, prob in top_scorelines:
        if scoreline in correct_odds:
            odds = correct_odds[scoreline]
            ev = (prob * odds) - (1 - prob)
            if ev > 0.05:  # 5% EV threshold
                value_bets.append(ValueBet(
                    market=f"Correct Score {scoreline}",
                    probability=prob,
                    odds=odds,
                    expected_value=ev,
                ))
    return value_bets
```

**Validation:**
- Backtest last 30 days
- Target: Correct score EV > 8% on average

**Expected Impact:** High-odds value bets (5.0-15.0 odds), 2-3% ROI boost

---

### 2.3 Add Full Asian Handicap Lines (P1)

**Problem:** Only AH -0.5 wired, missing -1.0, -1.5, -2.0, +0.5, +1.0

**Root Cause:** API-Football fetch doesn't parse full AH market

**Files to Change:**
- `backend/quant/api_football_client.py` (parse AH lines)
- `backend/quant/poisson_model.py` (compute AH probabilities)
- `backend/quant/ev_engine.py` (evaluate AH EV)

**Implementation:**
```python
# api_football_client.py
def fetch_odds_for_fixture(fixture_id: int, bookmaker_id: int = 8) -> dict:
    ...
    elif market_name == "Asian Handicap":
        ah_odds = {}
        for v in values:
            # v["value"] = "-1.5", "+0.5", etc.
            handicap = v["value"]
            ah_odds[handicap] = float(v["odd"])
        odds_data["asian_handicap_odds"] = ah_odds
    ...

# poisson_model.py - Compute AH probabilities
def compute_handicap_prob(mu_home: float, mu_away: float, handicap: float) -> float:
    """P(home wins with handicap)."""
    # Use Poisson grid to compute P(home_goals - away_goals > handicap)
    ...
```

**Validation:**
- Backtest AH -1.5 on high-xG matches
- Target: 55%+ win rate

**Expected Impact:** 4-6 new markets, especially valuable for mismatched fixtures

---

### 2.4 Add Over/Under 0.5 & 4.5 Goals (P2)

**Problem:** Missing extreme goal lines

**Root Cause:** Not in EV engine market list

**Files to Change:**
- `backend/quant/ev_engine.py` (add markets)
- `backend/quant/api_football_client.py` (fetch odds if available)

**Implementation:**
```python
# ev_engine.py
MARKET_TO_PROB = {
    ...
    "Over 0.5 Goals": lambda p: p.over05,  # Add to CombinedProbabilities
    "Under 0.5 Goals": lambda p: 1 - p.over05,
    "Over 4.5 Goals": lambda p: p.over45,  # Add to CombinedProbabilities
    "Under 4.5 Goals": lambda p: 1 - p.over45,
}

# probability_engine.py - Compute these
over05 = 1 - poisson_cdf(0, mu_home + mu_away)
over45 = 1 - poisson_cdf(4, mu_home + mu_away)
```

**Validation:**
- Over 0.5 should have 90%+ hit rate (like Over 1.5)
- Under 4.5 should have 85%+ hit rate in defensive leagues

**Expected Impact:** 2 new safe markets for vault

---

### 2.5 Wire Corner Odds (P2 - After Fixing Multiplier)

**Problem:** Corner probabilities computed but no odds fetched

**Prerequisite:** Phase 1.1 (fix corner multiplier) must be complete

**Files to Change:**
- `backend/quant/api_football_client.py` (fetch corner odds)
- `backend/quant/ev_engine.py` (evaluate corner EV)

**Implementation:**
```python
# api_football_client.py
def fetch_odds_for_fixture(fixture_id: int, bookmaker_id: int = 8) -> dict:
    ...
    elif market_name == "Corners Over/Under":
        for v in values:
            if v["value"] == "Over 8.5": odds_data["corners_over85_odds"] = float(v["odd"])
            elif v["value"] == "Over 9.5": odds_data["corners_over95_odds"] = float(v["odd"])
    ...

# ev_engine.py
MARKET_TO_PROB = {
    ...
    "Over 8.5 Corners": lambda p: p.over85_corners,
    "Over 9.5 Corners": lambda p: p.over95_corners,
}
```

**Validation:**
- After multiplier fix, run 30-day backtest
- Target: Corner Brier < 0.20, EV > 5%

**Expected Impact:** 2 new markets, but only after calibration is fixed

---

## Phase 3: Vault & Accumulator Improvements (Week 5-6)

**Goal:** Improve bankroll management, add backtesting, fix selection algorithms

### 3.1 Add Vault Circuit Breaker

**Problem:** Vault can lose unlimited bankroll without pause

**Root Cause:** No stop-loss mechanism in `vault_simulator.py` or `VaultTab.tsx`

**Files to Change:**
- `components/VaultTab.tsx` (add circuit breaker logic)
- `backend/quant/vault_simulator.py` (add to backtest)

**Implementation:**
```typescript
// VaultTab.tsx - Add circuit breaker
const CIRCUIT_BREAKER_THRESHOLD = 0.50; // Pause if bankroll drops 50%

function checkCircuitBreaker(startingBankroll: number, currentBankroll: number): boolean {
  const drawdown = (startingBankroll - currentBankroll) / startingBankroll;
  if (drawdown >= CIRCUIT_BREAKER_THRESHOLD) {
    toast.error(`Vault paused: ${drawdown * 100}% drawdown. Review strategy.`);
    return true;
  }
  return false;
}

// In autoPopulate()
if (checkCircuitBreaker(userProfile.startingBankroll, portfolioBankroll)) {
  return; // Don't generate new picks
}
```

**Validation:**
- Simulate 30-day backtest with circuit breaker
- Confirm vault pauses at 50% drawdown

**Expected Impact:** Prevent catastrophic losses, protect user bankroll

---

### 3.2 Add Accumulator Backtesting

**Problem:** No way to know if accumulators are profitable

**Root Cause:** No settlement pipeline for accas

**Files to Change:**
- `backend/quant/accumulator_backtester.py` (new file)
- `backend/scheduler.js` (add daily acca grading job)

**Implementation:**
```python
# accumulator_backtester.py
def grade_accumulators(date_str: str):
    """Grade all accumulators for a given date."""
    doc = db.collection("quant_vip").document(date_str).get()
    if not doc.exists:
        return
    
    accas = doc.to_dict().get("accumulators", {})
    results_map = fetch_results_for_date(date_str)
    
    for tier, acca_list in accas.items():
        for acca in acca_list:
            legs = acca.get("legs", [])
            all_won = True
            for leg in legs:
                fid = leg.get("fixture_id")
                result = results_map.get(fid)
                if not result:
                    continue
                status = grade_bet(leg["market"], result["home_goals"], result["away_goals"])
                if status != "won":
                    all_won = False
                    break
            
            acca["status"] = "won" if all_won else "lost"
            acca["graded_at"] = datetime.now(timezone.utc).isoformat()
    
    # Save back to Firestore
    doc.reference.set({"accumulators": accas}, merge=True)
```

**Validation:**
- Run on last 30 days of accas
- Calculate hit rate per tier (Baseline, Alpha Edge, Syndicate, Variance Play)

**Expected Impact:** Data-driven accumulator optimization

---

### 3.3 Add Time-Based Correlation Guard

**Problem:** Accumulator legs can all kick off at same time (no time to hedge)

**Root Cause:** No kickoff time check in `accumulator_engine.py`

**Files to Change:**
- `backend/quant/accumulator_engine.py` (add time diversification)

**Implementation:**
```python
# accumulator_engine.py - Add time guard
def _select_legs(pool: list, tier: str) -> list:
    ...
    selected_kickoffs = set()
    
    for candidate in sorted_pool:
        kickoff = candidate.get("kickoff_utc", "")
        kickoff_hour = kickoff.split("T")[1][:2] if kickoff else "00"
        
        # Max 2 legs per hour
        hour_count = sum(1 for k in selected_kickoffs if k[:2] == kickoff_hour)
        if hour_count >= 2:
            continue  # Skip to diversify kickoff times
        
        selected_kickoffs.add(kickoff)
        selected.append(candidate)
    ...
```

**Validation:**
- Check next 7 days of accas
- Confirm no more than 2 legs per hour

**Expected Impact:** Better hedging opportunities, reduced correlation risk

---

### 3.4 Add Vault Diversification Constraints

**Problem:** 7 daily picks can all be from same league/time

**Root Cause:** No diversification rules in vault selection

**Files to Change:**
- `backend/quant/quant_pipeline.py` (add diversification to `_select_vault_picks`)

**Implementation:**
```python
# quant_pipeline.py - Add diversification
def _select_vault_picks(predictions: list, max_picks: int = 7) -> list:
    ...
    selected = []
    league_counts = defaultdict(int)
    hour_counts = defaultdict(int)
    
    for pred in sorted_predictions:
        league = pred.get("league", "")
        kickoff = pred.get("kickoff_utc", "")
        kickoff_hour = kickoff.split("T")[1][:2] if kickoff else "00"
        
        # Max 2 picks per league
        if league_counts[league] >= 2:
            continue
        
        # Max 3 picks per hour
        if hour_counts[kickoff_hour] >= 3:
            continue
        
        selected.append(pred)
        league_counts[league] += 1
        hour_counts[kickoff_hour] += 1
        
        if len(selected) >= max_picks:
            break
    
    return selected
```

**Validation:**
- Check next 14 days of vault picks
- Confirm no league has >2 picks, no hour has >3 picks

**Expected Impact:** Reduced correlation, better risk-adjusted returns

---

### 3.5 Add Sharpe/Sortino Ratio Tracking

**Problem:** No risk-adjusted return metrics for vault

**Root Cause:** `performance_tracker.py` only tracks raw ROI

**Files to Change:**
- `backend/quant/performance_tracker.py` (add Sharpe/Sortino)
- `backend/quant/vault_simulator.py` (add to backtest report)

**Implementation:**
```python
# performance_tracker.py
def compute_sharpe_ratio(daily_returns: list, risk_free_rate: float = 0.02) -> float:
    """Annualized Sharpe ratio."""
    if len(daily_returns) < 2:
        return 0.0
    mean_return = np.mean(daily_returns)
    std_return = np.std(daily_returns)
    if std_return == 0:
        return 0.0
    return (mean_return - risk_free_rate / 252) / std_return * np.sqrt(252)

def compute_sortino_ratio(daily_returns: list, risk_free_rate: float = 0.02) -> float:
    """Sortino ratio (downside deviation only)."""
    if len(daily_returns) < 2:
        return 0.0
    mean_return = np.mean(daily_returns)
    downside_returns = [r for r in daily_returns if r < 0]
    if not downside_returns:
        return float('inf')
    downside_std = np.std(downside_returns)
    if downside_std == 0:
        return 0.0
    return (mean_return - risk_free_rate / 252) / downside_std * np.sqrt(252)
```

**Validation:**
- Compute Sharpe/Sortino for last 30 days
- Target: Sharpe > 1.0, Sortino > 1.5

**Expected Impact:** Better performance benchmarking, risk-aware optimization

---

### 3.6 Fix Vault Documentation

**Problem:** Docstring says "Quarter-Kelly (0.25)" but code uses 1/8th Kelly (0.125)

**Files to Change:**
- `backend/quant/vault_simulator.py` (update docstring)

**Implementation:**
```python
# vault_simulator.py - Fix docstring
"""
vault_simulator.py
──────────────────
...
  - 1/8th Kelly staking (0.125 fraction, 2% hard cap)  # FIXED
  - Max 7 picks per day (top by composite score, matching Vault auto-populate)
...
"""
```

**Expected Impact:** Accurate documentation, no confusion

---

## Phase 4: Advanced Features (Week 7-8)

**Goal:** Long-term improvements for competitive advantage

### 4.1 Combinatorial Accumulator Optimizer

**Problem:** Greedy selection misses globally optimal combinations

**Root Cause:** `_select_legs` is greedy, not combinatorial

**Files to Change:**
- `backend/quant/accumulator_engine.py` (replace greedy with optimizer)

**Implementation:**
```python
# accumulator_engine.py - Use dynamic programming or branch-and-bound
def _optimize_legs(pool: list, tier: str, max_legs: int) -> list:
    """Find globally optimal combination using branch-and-bound."""
    best_combo = []
    best_ev = 0.0
    
    def backtrack(combo: list, remaining: list, depth: int):
        nonlocal best_combo, best_ev
        
        if depth == max_legs or not remaining:
            ev = compute_combo_ev(combo)
            if ev > best_ev:
                best_combo = combo[:]
                best_ev = ev
            return
        
        # Prune: if upper bound < best_ev, skip
        upper_bound = compute_upper_bound(combo, remaining)
        if upper_bound < best_ev:
            return
        
        for i, candidate in enumerate(remaining):
            if passes_filters(combo + [candidate]):
                backtrack(combo + [candidate], remaining[i+1:], depth + 1)
    
    backtrack([], pool, 0)
    return best_combo
```

**Validation:**
- Compare greedy vs optimizer on 30 days
- Target: Optimizer EV > Greedy EV by 10%+

**Expected Impact:** Better accumulator quality, higher EV

---

### 4.2 Multi-Alternative Accumulator Generation

**Problem:** Only 1 accumulator per tier (take-it-or-leave-it)

**Root Cause:** `count: 1` in accumulator config

**Files to Change:**
- `backend/quant/accumulator_engine.py` (generate top-3 per tier)

**Implementation:**
```python
# accumulator_engine.py
def generate_accumulators(pool: list) -> dict:
    ...
    for tier in ["baseline", "alpha_edge", "syndicate", "variance_play"]:
        accas = []
        for i in range(3):  # Generate top 3
            legs = _select_legs(pool, tier, exclude_previous=accas)
            if legs:
                accas.append(build_acca(legs, tier))
        result[tier] = accas
    ...
```

**Validation:**
- Show 3 alternatives per tier in UI
- Track which alternative users pick

**Expected Impact:** Better user choice, higher engagement

---

### 4.3 HT/FT Compound Markets

**Problem:** Complex compound market (Half Time / Full Time) not implemented

**Root Cause:** Requires joint FH+FT probability distribution

**Files to Change:**
- `backend/quant/poisson_model.py` (compute HT/FT grid)
- `backend/quant/ev_engine.py` (evaluate HT/FT EV)

**Implementation:**
```python
# poisson_model.py - Compute HT/FT probabilities
def compute_htft_probabilities(mu_home_fh: float, mu_away_fh: float,
                                mu_home_ft: float, mu_away_ft: float) -> dict:
    """
    P(HT result, FT result) using conditional Poisson.
    Example: P(Home/Draw) = P(home leads at HT) * P(draw at FT | home leads at HT)
    """
    # This is complex - requires correlation modeling
    # Start with independence assumption, then calibrate
    ...
```

**Validation:**
- Backtest HT/FT on last 30 days
- Target: 15%+ hit rate (high odds market)

**Expected Impact:** High-odds value bets (10.0-30.0 odds), niche market edge

---

### 4.4 TicketWizard ↔ Backend Alignment

**Problem:** TicketWizard (client) and accumulator_engine (backend) use different rules

**Root Cause:** Divergent implementations

**Files to Change:**
- `components/TicketWizard.tsx` (align with backend rules)
- OR `backend/quant/accumulator_engine.py` (align with TicketWizard)

**Implementation:**
- Extract shared rules to `backend/quant/ticket_rules.py`
- Call from both backend and expose via API to frontend

**Validation:**
- Generate tickets from both systems on same date
- Confirm they produce similar results

**Expected Impact:** Consistent user experience, no conflicting recommendations

---

## Testing & Validation Strategy

### Automated Testing

1. **Unit Tests**
   - `backend/quant/test_corner_calibration.py` - Validate corner multiplier fix
   - `backend/quant/test_market_suppression.py` - Confirm DC X2 disabled
   - `backend/quant/test_btts_filter.py` - Validate blanking filter

2. **Integration Tests**
   - `backend/quant/test_full_pipeline.py` - End-to-end pipeline with new markets
   - `backend/quant/test_accumulator_backtester.py` - Acca grading pipeline

3. **Backtesting**
   - Run `prediction_audit.py --days 90` after each phase
   - Run `vault_simulator.py 90` to validate vault improvements

### Manual Validation

1. **Daily Monitoring**
   - Check `quant_predictions/{today}` for new markets
   - Verify corner predictions are reasonable (< 15 corners)
   - Confirm DC X2 not in vault picks

2. **Weekly Review**
   - Run `prediction_audit.py --days 7 --full`
   - Check win rate by market
   - Review accumulator performance

3. **Monthly Review**
   - Compute Sharpe/Sortino ratios
   - Compare ROI before/after each phase
   - Adjust calibration factors

---

## Success Metrics

| Metric | Current | Target (Phase 1) | Target (Phase 4) |
|--------|---------|------------------|------------------|
| **Overall Win Rate** | 60% | 65% | 70% |
| **ROI** | +0.7% | +5% | +12% |
| **Corner Brier Score** | 0.67 | < 0.25 | < 0.15 |
| **Overconfident Losses** | 54% | < 30% | < 20% |
| **Close Losses** | 29% | < 20% | < 15% |
| **Vault Sharpe Ratio** | N/A | > 0.8 | > 1.2 |
| **Accumulator Hit Rate** | Unknown | Baseline: 40% | Baseline: 50% |
| **Markets Available** | 8 | 15 | 20+ |

---

## Timeline

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| **Phase 1** | Week 1-2 | Fix corners, suppress DC X2, BTTS filter, calibration |
| **Phase 2** | Week 3-4 | FH markets, correct score, Asian handicap |
| **Phase 3** | Week 5-6 | Vault circuit breaker, acca backtesting, diversification |
| **Phase 4** | Week 7-8 | Combinatorial optimizer, HT/FT, Sharpe ratio |

**Total Duration:** 8 weeks  
**Expected ROI Improvement:** +0.7% → +12% (17x improvement)

---

## Conclusion

This implementation plan addresses all critical issues identified in the audit:

1. ✅ **Corner predictions fixed** (Phase 1.1)
2. ✅ **Underperforming markets suppressed** (Phase 1.2)
3. ✅ **Overconfidence calibrated** (Phase 1.4)
4. ✅ **Missing markets added** (Phase 2)
5. ✅ **Vault protected** (Phase 3.1)
6. ✅ **Accumulators backtested** (Phase 3.2)
7. ✅ **Risk-adjusted metrics added** (Phase 3.5)

The plan is prioritized by **effort vs impact**, with quick wins in Phase 1 and advanced features in Phase 4. Each phase includes validation steps to ensure improvements are measurable and data-driven.

**Next Steps:**
1. Review and approve this plan
2. Begin Phase 1 implementation
3. Set up daily monitoring with `prediction_audit.py`
4. Track success metrics weekly

---

**Generated by:** Vantage AI Audit System  
**Audit Script:** `backend/quant/prediction_audit.py`  
**Last Updated:** 2026-07-07
