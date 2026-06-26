import json, os

cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.vantage_cache')
scores_dir = os.path.join(cache_dir, 'scores')
fixtures_dir = os.path.join(cache_dir, 'fixtures')

# Check if a fixture has scores directly
files = [f for f in os.listdir(fixtures_dir) if f.endswith('.json') and '_pag' not in f]
fpath = os.path.join(fixtures_dir, files[0])
with open(fpath, 'r', encoding='utf-8') as f:
    data = json.load(f)
resp = data.get('response', {})
fixtures = resp.get('data', [])

# Show first fixture with scores
for f1 in fixtures[:50]:
    scores = f1.get('scores', [])
    if scores:
        print(f"Fixture {f1.get('id')} {f1.get('name')}")
        print(f"  state_id={f1.get('state_id')} result_info={f1.get('result_info','')}")
        participants = f1.get('participants', [])
        home = next((p for p in participants if p.get('meta',{}).get('location')=='home'), {})
        away = next((p for p in participants if p.get('meta',{}).get('location')=='away'), {})
        print(f"  Home: {home.get('name')} (id={home.get('id')})")
        print(f"  Away: {away.get('name')} (id={away.get('id')})")
        for s in scores:
            desc = s.get('description', '')
            goals = s.get('score', {}).get('goals', '?')
            pid = s.get('participant_id', '?')
            print(f"    {desc}: team={pid} goals={goals}")
        print()
        break
else:
    print("No fixture with scores in fixture file")
    # Check if any have state_id=5
    completed = [f for f in fixtures if f.get('state_id') == 5]
    print(f"Fixtures with state_id=5: {len(completed)}")
    if completed:
        f1 = completed[0]
        print(f"First completed: {f1.get('id')} {f1.get('name')}")
        print(f"  Scores count: {len(f1.get('scores',[]))}")
        for s in f1.get('scores', []):
            desc = s.get('description', '')
            goals = s.get('score', {}).get('goals', '?')
            print(f"    {desc}: goals={goals}")

# Check scores cache files
print("\n--- Scores cache files ---")
score_files = os.listdir(scores_dir)
print(f"Total score files: {len(score_files)}")
if score_files:
    sf = os.path.join(scores_dir, score_files[0])
    with open(sf, 'r', encoding='utf-8') as f:
        sdata = json.load(f)
    resp2 = sdata.get('response', {})
    match_data = resp2.get('data', {})
    print(f"Score file fixture_id: {match_data.get('id','?')}")
    print(f"  state_id: {match_data.get('state_id')}")
    print(f"  result_info: {match_data.get('result_info','')}")
    scores = match_data.get('scores', [])
    for s in scores:
        desc = s.get('description', '')
        goals = s.get('score', {}).get('goals', '?')
        pid = s.get('participant_id', '?')
        print(f"    {desc}: team={pid} goals={goals}")
