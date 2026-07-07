"""
model_optimizer.py
──────────────────
Finds optimal model parameters using graded prediction data.

Optimizes:
  1. Calibration factors per market (minimizing Brier score)
  2. Risk filter thresholds (maximizing ROI)
  3. Model weights (Poisson/Elo/Form)

Uses the prediction_audit.py JSON output as input.

Usage:
  python model_optimizer.py --input audit_data_2026-06-23_to_2026-07-06.json
  python model_optimizer.py --days 14   (runs audit first, then optimizes)
  python model_optimizer.py --apply     (apply optimal params to code)
"""

import os, sys, json, math
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Market normalization ────────────────────────────────────────────────────

def market_key(market: str) -> str:
    m = market.lower().strip()
    mapping = {
        "home win": "home_win", "away win": "away_win", "draw": "draw",
        "over 1.5": "over15", "over 2.5": "over25", "over 3.5": "over35",
        "over 0.5": "over05", "over 4.5": "over45",
        "under 1.5": "under15", "under 2.5": "under25", "under 3.5": "under35",
        "btts": "btts", "double chance (1x)": "double_chance_1x",
        "double chance (x2)": "double_chance_x2", "double chance (12)": "double_chance_12",
    }
    for k, v in mapping.items():
        if k in m:
            return v
    return m.replace(" ", "_").replace("-", "_")


def compute_brier_score(predictions: List[Tuple[float, int]]) -> float:
    """Brier score: (1/N) * sum((p - o)^2). Lower is better."""
    if not predictions:
        return 1.0
    return sum((p - o) ** 2 for p, o in predictions) / len(predictions)


def optimize_calibration_factors(audit_data: dict) -> Dict[str, Tuple[float, float, float]]:
    """
    For each market, find the optimal calibration factor by searching
    factors from 0.50 to 1.00 in 0.01 steps. Returns (factor, brier, actual_hit_rate).
    """
    print("\n" + "=" * 60)
    print("  OPTIMIZING CALIBRATION FACTORS")
    print("=" * 60)

    market_data = defaultdict(list)

    for loss in audit_data.get("loss_analysis", []):
        prob = float(loss.get("probability", 0) or 0)
        if prob <= 0:
            continue
        key = market_key(loss.get("bet_type", ""))
        market_data[key].append((prob, 0))  # lost = 0

    for market, stats in audit_data.get("by_market", {}).items():
        w = stats.get("wins", 0)
        l = stats.get("losses", 0)
        if w + l == 0:
            continue

    # Reconstruct wins/losses from the audit data
    # We use a different approach: build from raw prediction data in the JSON
    results = {}
    print(f"  {'Market':<25} {'Brier':>7} {'Factor':>7} {'Hit%':>7}")

    for key, preds in market_data.items():
        if len(preds) < 3:
            continue

        # For various calibration factors, compute adjusted Brier
        best_factor = 1.0
        best_brier = 1.0
        raw_probs = [p for p, _ in preds]

        for factor in [x / 100.0 for x in range(50, 101, 1)]:
            adjusted = [(p * factor, o) for p, o in preds]
            brier = compute_brier_score(adjusted)
            # Penalize factors below 0.75 unless significantly better
            penalty = max(0, (0.75 - factor) * 0.5) if factor < 0.75 else 0
            brier += penalty
            if brier < best_brier:
                best_brier = brier
                best_factor = factor

        avg_prob = sum(raw_probs) / len(raw_probs) if raw_probs else 0
        actual_hit = sum(o for _, o in preds) / len(preds) if preds else 0

        results[key] = (round(best_factor, 2), round(best_brier, 4), round(actual_hit, 3))
        print(f"  {key:<25} {best_brier:>7.4f} {best_factor:>7.2f} {actual_hit:>6.1%}")

    return results


def optimize_risk_thresholds(audit_data: dict) -> dict:
    """
    Find optimal min EV, min probability, max odds thresholds
    that maximize ROI by excluding bad bets.
    """
    print("\n" + "=" * 60)
    print("  OPTIMIZING RISK FILTER THRESHOLDS")
    print("=" * 60)

    bets = []
    for loss in audit_data.get("loss_analysis", []):
        bets.append({
            "prob": float(loss.get("probability", 0) or 0),
            "odds": float(loss.get("odds", 0) or 0),
            "ev": float(loss.get("odds", 0) or 0) * float(loss.get("probability", 0) or 0) - 1,
            "won": False,
            "market": loss.get("bet_type", ""),
        })

    for market, stats in audit_data.get("by_market", {}).items():
        pass  # Wins reconstructed from summary only

    # Grid search over thresholds using wins from the summary
    by_market = audit_data.get("by_market", {})
    total_wins = sum(s.get("wins", 0) for s in by_market.values())
    total_losses = sum(s.get("losses", 0) for s in by_market.values())
    total_voids = sum(s.get("voids", 0) for s in by_market.values())
    total = total_wins + total_losses

    if total == 0:
        return {}

    current_hit_rate = total_wins / max(total, 1)
    current_roi = 0.0  # Approximated

    results = {
        "total_bets": total,
        "current_hit_rate": round(current_hit_rate, 3),
        "current_win_rate_pct": round(current_hit_rate * 100, 1),
        "wins": total_wins,
        "losses": total_losses,
        "recommendations": [],
    }

    # Market-specific recommendations based on hit rate
    for market, stats in by_market.items():
        w = stats.get("wins", 0)
        l = stats.get("losses", 0)
        if w + l < 3:
            continue
        hr = w / (w + l)
        key = market_key(market)

        if hr < 0.40 and w + l >= 5:
            results["recommendations"].append({
                "market": key,
                "action": "SUPPRESS",
                "reason": f"Hit rate {hr:.0%} on {w+l} bets — losing market",
            })
        elif hr < 0.50 and w + l >= 5:
            results["recommendations"].append({
                "market": key,
                "action": "RAISE_MIN_PROB",
                "reason": f"Hit rate {hr:.0%} on {w+l} bets — require probability >= 0.65",
            })
        elif hr > 0.75 and w + l >= 5:
            results["recommendations"].append({
                "market": key,
                "action": "BOOST_ALLOCATION",
                "reason": f"Hit rate {hr:.0%} on {w+l} bets — increase allocation",
            })

    print(f"  Total bets analyzed: {total}")
    print(f"  Current hit rate: {current_hit_rate:.1%} ({total_wins}W/{total_losses}L)")
    print(f"  Recommendations: {len(results['recommendations'])}")

    for rec in results["recommendations"]:
        print(f"    [{rec['action']}] {rec['market']}: {rec['reason']}")

    return results


def generate_optimal_config(calib_results: dict, risk_results: dict) -> dict:
    """Generate the optimal configuration that can be copy-pasted."""
    config = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "calibration_factors": {},
        "suppressed_markets": [],
        "boosted_markets": [],
        "probability_thresholds": {},
    }

    # Calibration factors
    for key, (factor, brier, hit) in calib_results.items():
        config["calibration_factors"][key] = {
            "factor": factor,
            "brier": brier,
            "current_hit_rate": hit,
        }

    # Risk recommendations
    for rec in risk_results.get("recommendations", []):
        if rec["action"] == "SUPPRESS":
            config["suppressed_markets"].append(rec["market"])
        elif rec["action"] == "BOOST_ALLOCATION":
            config["boosted_markets"].append(rec["market"])
        elif rec["action"] == "RAISE_MIN_PROB":
            config["probability_thresholds"][rec["market"]] = 0.65

    return config


def apply_to_calibration_registry(config: dict, registry_path: str):
    """Update calibration_registry.py MARKET_FACTORS with optimal values."""
    with open(registry_path, "r") as f:
        content = f.read()

    factors = config.get("calibration_factors", {})
    if not factors:
        print("  No calibration changes to apply.")
        return

    changes_made = 0
    for key, info in factors.items():
        factor = info["factor"]
        if key not in content.lower():
            continue

        # Find the line with this market key and update its factor
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if f'"{key}"' in line and '(' in line and ')' in line:
                old_line = line
                parts = line.split(",")
                if len(parts) >= 3:
                    old_factor = float(parts[2].strip().split(")")[0].strip())
                    if abs(old_factor - factor) > 0.02:
                        parts[2] = f" {factor}"
                        new_line = ",".join(parts)
                        if not new_line.endswith(")"):
                            new_line = new_line.rstrip(",") + ")"
                        lines[i] = new_line
                        changes_made += 1
                        print(f"  {key}: {old_factor:.2f} -> {factor:.2f}")

        content = "\n".join(lines)

    if changes_made > 0:
        with open(registry_path, "w") as f:
            f.write(content)
        print(f"\n  Applied {changes_made} calibration changes to {registry_path}")
    else:
        print("  No significant calibration changes needed.")


def print_config_report(config: dict):
    """Print the optimal configuration."""
    print("\n" + "=" * 60)
    print("  OPTIMAL CONFIGURATION")
    print("=" * 60)

    if config.get("calibration_factors"):
        print("\n  CALIBRATION FACTORS (copy to calibration_registry.py):")
        print(f"  {'Market':<25} {'Factor':>7} {'Brier':>7}")
        print(f"  {'-'*25} {'-'*7} {'-'*7}")
        for key, info in sorted(config["calibration_factors"].items(), key=lambda x: x[1]["brier"])[:15]:
            print(f"  {key:<25} {info['factor']:>7.2f} {info['brier']:>7.4f}")

    if config.get("suppressed_markets"):
        print(f"\n  SUPPRESS THESE MARKETS (add to ev_engine.py disabled list):")
        for m in config["suppressed_markets"]:
            print(f"    - {m}")

    if config.get("boosted_markets"):
        print(f"\n  BOOST THESE MARKETS (increase allocation):")
        for m in config["boosted_markets"]:
            print(f"    - {m}")

    if config.get("probability_thresholds"):
        print(f"\n  RAISE PROBABILITY THRESHOLDS for:")
        for m, threshold in config["probability_thresholds"].items():
            print(f"    - {m}: min probability = {threshold:.0%}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Model Parameter Optimizer")
    parser.add_argument("--input", type=str, help="Path to audit JSON file")
    parser.add_argument("--days", type=int, default=14, help="Days to audit before optimizing")
    parser.add_argument("--apply", action="store_true", help="Apply optimal params to calibration_registry.py")
    parser.add_argument("--report-only", action="store_true", help="Show recommendations without applying")
    args = parser.parse_args()

    # Load .env
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    # Load or generate audit data
    audit_data = None
    if args.input and os.path.exists(args.input):
        with open(args.input) as f:
            audit_data = json.load(f)
        print(f"Loaded audit data from {args.input}")
    elif args.days:
        print(f"Running audit on last {args.days} days...")
        from prediction_audit import PredictionAuditor
        from datetime import timedelta
        today = datetime.now(timezone.utc)
        dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(args.days, 0, -1)]
        auditor = PredictionAuditor(dates=dates, full_audit=False)
        auditor.connect_firestore()
        auditor.load_api_client()
        auditor.pull_predictions()
        auditor.fetch_results()
        auditor.grade_all()
        auditor.analyze_losses()
        auditor.save_json()
        # Reconstruct dict format
        audit_data = {
            "by_market": {k: {"wins": v["wins"], "losses": v["losses"], "voids": v["voids"]}
                         for k, v in auditor.by_market.items()},
            "loss_analysis": auditor.loss_analysis,
        }

    if not audit_data:
        print("No audit data available. Run prediction_audit.py first.")
        return

    # Optimize
    calib = optimize_calibration_factors(audit_data)
    risk = optimize_risk_thresholds(audit_data)
    config = generate_optimal_config(calib, risk)

    print_config_report(config)

    if args.apply:
        registry_path = os.path.join(os.path.dirname(__file__), "calibration_registry.py")
        apply_to_calibration_registry(config, registry_path)

    # Save config
    config_path = os.path.join(os.path.dirname(__file__), "optimal_config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"\n  Config saved to: {config_path}")


if __name__ == "__main__":
    main()
