import sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'quant'))

from dotenv import load_dotenv
load_dotenv('.env.local')

from datetime import datetime, timedelta, timezone
LAGOS_TZ = timezone(timedelta(hours=1))

from local_cache import LocalCache
from quant_pipeline import run_pipeline
import data_pipeline as dp

cache = LocalCache()

# Patch API calls to use cache
original_get = dp._get
original_get_paginated = dp._get_paginated

def _cached_get(path, params=None):
    return cache.get_or_fetch(path, params, original_get)

def _cached_get_paginated(path, params=None, max_pages=5):
    key = f"{path}_pag"
    if params:
        for k in sorted(params.keys()):
            if k != "api_token":
                key += f"_{k}={params[k]}"
    key += f"_mp{max_pages}"
    cached_val = cache.get(f"_pag_{key}", None)
    if cached_val is not None:
        return cached_val
    result = original_get_paginated(path, params, max_pages)
    if result is not None:
        cache.put(f"_pag_{key}", None, result)
    return result

dp._get = _cached_get
dp._get_paginated = _cached_get_paginated

# Test 3 cached dates (June 5 -> June 3)
end_date = datetime(2026, 6, 6, tzinfo=LAGOS_TZ)
for i in range(3):
    date_str = (end_date - timedelta(days=i+1)).strftime("%Y-%m-%d")
    print(f"\n{'='*50}")
    print(f"Testing: {date_str}")
    try:
        result = run_pipeline(date_str, dry_run=True)
        status = result.get("status", "?")
        preds = len(result.get("predictions", []))
        print(f"Status: {status}, Predictions: {preds}")
        if status == "success" and preds > 0:
            p = result["predictions"][0]
            print(f"  Sample: {p.get('home_team','?')} vs {p.get('away_team','?')} -> {p.get('prediction','?')} @ {p.get('odds','?')}")
    except Exception as e:
        print(f"ERROR: {e}")

print(f"\n{cache.stats()}")
