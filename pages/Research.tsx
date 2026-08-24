import React, { useEffect, useMemo, useRef, useState } from 'react';import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, BrainCircuit, User, Users, Clock, ArrowUpRight, X, Loader2, Swords, Trash2, Sparkles } from 'lucide-react';
import { searchIntelligence, fetchCoverageStats, fetchTopXI, fetchPlayersByIds, CoverageStats } from '../services/intelligence/db';
import { SearchResult, PlayerIntelligence } from '../services/intelligence/types';
import { projectGoals } from '../services/intelligence/stats';
import { TeamCrest } from '../components/intel/TeamCrest';
import { PlayerAvatar } from '../components/intel/PlayerAvatar';
import { DreamPitch } from '../components/intel/DreamPitch';

const RECENT_KEY = 'vantage_intel_recent_v2';

interface RecentItem { id: string; type: 'player' | 'team'; name: string; meta: string }

const EXAMPLES = ['Salah', 'Arsenal', 'Real Madrid', 'Haaland', 'Bayern', 'Vinicius'];
const LEAGUE_CHIPS = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];

type Mode = 'search' | 'challenge';
type ChallengeKind = 'teams' | 'players' | 'dream';

export const Research: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('search');
  const [kind, setKind] = useState<ChallengeKind>('teams');
  // Dream builder: user's XI vs the Vantage AI house team
  const [dreamH, setDreamH] = useState<SearchResult[]>([]);
  const [aiXI, setAiXI] = useState<{ count: number; top: SearchResult | null } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<'all' | 'player' | 'team'>('all');
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const debounceRef = useRef<any>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const userPitchRef = useRef<HTMLDivElement>(null);
  const [aiXIRoster, setAiXIRoster] = useState<PlayerIntelligence[] | null>(null);
  const [dreamGoals, setDreamGoals] = useState<number | null>(null);

  // Versus state
  const [homePick, setHomePick] = useState<SearchResult | null>(null);
  const [awayPick, setAwayPick] = useState<SearchResult | null>(null);
  const [pickingSide, setPickingSide] = useState<'home' | 'away'>('home');

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')); } catch { /* ignore */ }
    fetchCoverageStats().then(setCoverage);
    // Pre-build the house team
    fetchTopXI(11).then(xi => {
      setAiXIRoster(xi);
      const top = xi[0];
      setAiXI(top ? {
        count: xi.length,
        top: { id: top.player_id, type: 'player', name: top.player_name, meta: `VPII ${Math.round(top.scores?.vpii ?? 0)}` },
      } : null);
    });
    const h = params.get('h'); const a = params.get('a');
    if (h && a) navigate(`/intel/versus?h=${h}&a=${a}`, { replace: true });
  }, []);

  // Project goals for the user's XI whenever it changes
  useEffect(() => {
    if (dreamH.length === 0) { setDreamGoals(null); return; }
    let mounted = true;
    fetchPlayersByIds(dreamH.map(p => p.id)).then(list => {
      if (!mounted) return;
      const atk = list.map(p => (p.scores as any)?.attacking ?? null).filter((v: any) => v != null) as number[];
      const avgAtk = atk.length ? atk.reduce((s, v) => s + v, 0) / atk.length : null;
      setDreamGoals(projectGoals(avgAtk));
    });
    return () => { mounted = false; };
  }, [dreamH]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const effFilter = mode === 'challenge'
        ? (kind === 'teams' ? 'team' : 'player')
        : (filter === 'all' ? undefined : filter);
      const r = await searchIntelligence(q, effFilter as any);
      setResults(r);
      setSearching(false);
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, filter, mode, kind]);

  const saveRecent = (r: SearchResult) => {
    try {
      const next: RecentItem[] = [
        { id: r.id, type: r.type as any, name: r.name, meta: r.meta },
        ...recent.filter(x => x.id !== r.id),
      ].slice(0, 6);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const openResult = (r: SearchResult) => {
    if (mode === 'challenge') {
      if (kind === 'dream') {
        setDreamH(prev => {
          if (prev.length >= 11 || prev.some(x => x.id === r.id)) return prev;
          return [...prev, r];
        });
        // Close the dropdown and glide to the pitch so the landing animation is visible
        setQuery('');
        setTimeout(() => {
          userPitchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
        return;
      }
      if (pickingSide === 'home') {
        setHomePick(r);
        // Team A set → auto-scroll to search for Team B
        setTimeout(() => {
          setPickingSide('away');
          setQuery('');
          searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
      } else {
        setAwayPick(r);
        setQuery('');
      }
      return;
    }
    saveRecent(r);
    navigate(r.type === 'player' ? `/intel/player/${r.id}` : `/intel/team/${r.id}`);
  };

  const canBattle = useMemo(() => {
    if (kind === 'dream') return dreamH.length >= 5 && (aiXIRoster?.length ?? 0) >= 11;
    if (!homePick || !awayPick || homePick.id === awayPick.id) return false;
    if (kind === 'teams' && (homePick.type !== 'team' || awayPick.type !== 'team')) return false;
    if (kind === 'players' && (homePick.type !== 'player' || awayPick.type !== 'player')) return false;
    return true;
  }, [homePick, awayPick, kind, dreamH, aiXIRoster]);

  const launchChallenge = () => {
    if (kind === 'dream') {
      sessionStorage.setItem('dream_challenge', JSON.stringify({
        h: dreamH.map(p => p.id),
        a: (aiXIRoster ?? []).map(p => p.player_id),
        awayLabel: 'Vantage AI XI',
      }));
      navigate(`/intel/challenge?type=dream`);
      return;
    }
    navigate(`/intel/challenge?type=${kind}&h=${homePick!.id}&a=${awayPick!.id}`);
  };

  const clearRecents = () => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };

  const placeholder = useMemo(() => {
    if (mode === 'challenge') return pickingSide === 'home' ? 'Search HOME selection…' : 'Search AWAY selection…';
    return 'Search players or teams…';
  }, [mode, pickingSide]);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-gradient-to-br from-vantage-cyan/[0.07] via-transparent to-vantage-purple/[0.07] p-6 text-center">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />
        <div className="w-14 h-14 mx-auto rounded-2xl bg-vantage-cyan/15 border border-vantage-cyan/30 flex items-center justify-center mb-3">
          <BrainCircuit size={26} className="text-vantage-cyan" />
        </div>
        <h1 className="text-xl font-black font-display tracking-tight text-white mb-1">
          VANTAGE <span className="text-transparent bg-clip-text bg-vantage-gradient">INTELLIGENCE</span>
        </h1>
        <p className="text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
          Research any team or player — or pit two clubs against each other.
        </p>
        {coverage && (
          <div className="flex items-center justify-center gap-4 mt-4 text-[10px] font-mono">
            <span className="text-gray-300"><span className="font-black text-vantage-cyan">{coverage.players.toLocaleString()}</span> players</span>
            <span className="w-px h-3 bg-white/10" />
            <span className="text-gray-300"><span className="font-black text-vantage-purple">{coverage.teams.toLocaleString()}</span> teams</span>
          </div>
        )}
      </div>

      {/* Mode switch */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200 dark:bg-white/5 rounded-xl">
        <button onClick={() => setMode('search')} className={`py-2 rounded-lg text-xs font-bold transition-colors ${mode === 'search' ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white' : 'text-gray-500'}`}>
          <Search size={12} className="inline mr-1.5" />Research
        </button>
        <button onClick={() => setMode('challenge')} className={`py-2 rounded-lg text-xs font-bold transition-colors ${mode === 'challenge' ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white' : 'text-gray-500'}`}>
          <Swords size={12} className="inline mr-1.5" />Challenge
        </button>
      </div>

      {/* Search bar — always visible, near the top; results drop below it */}
      <div ref={searchRef} className="relative z-30">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-11 pr-11 text-sm font-semibold text-slate-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-vantage-cyan/50 focus:ring-2 focus:ring-vantage-cyan/20 transition-all"
        />
        {searching && <Loader2 size={15} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-vantage-cyan" />}
        {!searching && query && (
          <button onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-white/10">
            <X size={14} className="text-gray-400" />
          </button>
        )}

        {/* Results dropdown */}
        {query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-2 max-h-[340px] overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1219] shadow-glass z-40">
            {results.length === 0 && !searching && (
              <p className="text-center text-xs text-gray-500 py-6">No matches in the intelligence database.</p>
            )}
            {searching && results.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 size={14} className="animate-spin text-vantage-cyan" />
                <span className="text-xs text-gray-500">Searching…</span>
              </div>
            )}
            {results.map((r, i) => (
              <motion.button
                key={`${r.type}-${r.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => openResult(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-vantage-cyan/5 transition-colors ${i > 0 ? 'border-t border-slate-100 dark:border-white/5' : ''}`}
              >
                {r.type === 'player'
                  ? <PlayerAvatar playerId={r.id} name={r.name} size={32} ringColor="#a855f7" />
                  : <TeamCrest teamName={r.name} teamId={r.id} size={30} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{r.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{r.meta}</p>
                </div>
                {mode === 'challenge'
                  ? <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${pickingSide === 'home' ? 'bg-vantage-cyan/15 text-vantage-cyan' : kind === 'dream' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-vantage-purple/15 text-vantage-purple'}`}>
                      {kind === 'dream' ? '+ XI' : `+ ${pickingSide}`}
                    </span>
                  : <ArrowUpRight size={14} className="text-gray-400 shrink-0" />}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* ── CHALLENGE MODE ── */}
      {mode === 'challenge' && (
        <div className="space-y-4">
          {/* Challenge kind */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200 dark:bg-white/5 rounded-xl">
            {([['teams', 'Teams', Users], ['players', 'Players', User], ['dream', 'Dream XI', Sparkles]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setKind(k); setHomePick(null); setAwayPick(null); setDreamH([]); setPickingSide('home'); }}
                className={`py-2 rounded-lg text-[11px] font-bold transition-colors flex items-center justify-center gap-1 ${kind === k ? 'bg-white dark:bg-white/10 shadow text-vantage-cyan' : 'text-gray-500'}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {kind === 'dream' ? (
            /* Dream XI — your pitch vs the house */
            <div className="space-y-3">
              {/* Opponent card */}
              <div className="rounded-xl border border-vantage-purple/30 bg-vantage-purple/5 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-vantage-purple/15 flex items-center justify-center text-lg shrink-0">🤖</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-white leading-tight">Vantage AI XI</p>
                  {aiXIRoster ? (
                    <p className="text-[9px] text-gray-400 truncate">
                      Auto-built from the world's top-ranked players — led by {aiXI?.top?.name}
                    </p>
                  ) : (
                    <p className="text-[9px] text-gray-500">Assembling squad…</p>
                  )}
                </div>
                {(aiXIRoster?.length ?? 0) > 0 && (
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-vantage-purple/15 text-vantage-purple shrink-0">READY</span>
                )}
              </div>

              <div ref={userPitchRef} className="rounded-xl p-2 border border-vantage-cyan/50">
                <DreamPitch
                  roster={dreamH}
                  accent="#22d3ee"
                  label={`Your XI${dreamH.length ? ` (${dreamH.length}/11)` : ''}`}
                  onRemove={id => setDreamH(dreamH.filter(x => x.id !== id))}
                  estGoals={dreamGoals}
                />
              </div>
            </div>
          ) : (
            /* Head-to-head slots */
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {[['home', homePick, 'text-vantage-cyan'], ['away', awayPick, 'text-vantage-purple']].map(([side, pick, color]: any) => (
                <React.Fragment key={side}>
                  {side === 'away' && <span className="text-[11px] font-black text-gray-500">VS</span>}
                  <button
                    onClick={() => { setPickingSide(side); setQuery(pick?.name ?? ''); }}
                    className={`rounded-2xl border p-4 min-h-[92px] flex flex-col items-center justify-center gap-1.5 transition-colors ${
                      pickingSide === side ? `border-dashed ${color.replace('text-', 'border-')}/60` : 'border-white/10'
                    } bg-white/5`}
                  >
                    {pick ? (
                      <>
                        {pick.type === 'player'
                          ? <PlayerAvatar playerId={pick.id} name={pick.name} size={38} ringColor={color.replace('text-', '')} />
                          : <TeamCrest teamName={pick.name} teamId={pick.id} size={38} />}
                        <span className="text-xs font-bold text-white truncate max-w-full">{pick.name}</span>
                        <span className="text-[8px] uppercase tracking-widest text-gray-500">{side} · tap to change</span>
                      </>
                    ) : (
                      <>
                        {kind === 'teams' ? <Users size={18} className="text-gray-500" /> : <User size={18} className="text-gray-500" />}
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>{side}</span>
                        <span className="text-[9px] text-gray-600">tap then search below</span>
                      </>
                    )}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          <button
            disabled={!canBattle}
            onClick={launchChallenge}
            className="w-full py-3.5 rounded-xl bg-vantage-gradient text-white text-sm font-black tracking-wide flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity"
          >
            <Swords size={16} /> Challenge Vantage AI
          </button>
          {kind === 'dream' && dreamH.length < 5 && <p className="text-center text-[10px] text-gray-500">Pick at least 5 players for your XI ({dreamH.length}/11)</p>}
          {!canBattle && kind !== 'dream' && <p className="text-center text-[10px] text-gray-500">Select two different {kind} to continue</p>}
        </div>
      )}

      {/* Filter tabs + league chips (search mode only) */}
      {mode === 'search' && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {([['all', 'All'], ['player', 'Players'], ['team', 'Teams']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-4 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                  filter === key
                    ? 'bg-vantage-cyan/15 text-vantage-cyan border-vantage-cyan/30'
                    : 'text-gray-400 border-slate-200 dark:border-white/10 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {!query && (
            <div className="flex gap-1.5 flex-wrap -mt-1">
              {LEAGUE_CHIPS.map(lg => (
                <button key={lg} onClick={() => setQuery(lg)} className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-gray-500 hover:text-vantage-cyan hover:border-vantage-cyan/30 transition-colors">
                  {lg}
                </button>
              ))}
            </div>
          )}
        </>
      )}


      {/* Empty state: recents + examples */}
      {query.trim().length < 2 && mode === 'search' && (
        <div className="space-y-6">
          {recent.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  <Clock size={11} /> Recent research
                </h3>
                <button onClick={clearRecents} title="Clear history" className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {recent.map(item => (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.type === 'player' ? `/intel/player/${item.id}` : `/intel/team/${item.id}`)}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2 text-left hover:border-vantage-cyan/40 transition-colors"
                  >
                    {item.type === 'player'
                      ? <PlayerAvatar playerId={item.id} name={item.name} size={26} />
                      : <TeamCrest teamName={item.name} teamId={item.id} size={28} />}
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate flex-1">{item.name}</span>
                    <span className="text-[9px] text-gray-500 truncate max-w-[90px]">{item.meta}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Try searching</h3>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setQuery(ex)} className="px-3 py-1.5 rounded-full text-xs font-bold bg-vantage-cyan/10 border border-vantage-cyan/20 text-vantage-cyan hover:bg-vantage-cyan/20 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2.5">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Inside every report</h3>
            {[
              ['Intelligence Index', 'Single headline score vs league (50 = average)'],
              ['6 Dimensions', 'Radar with dashed league-average ring'],
              ['Percentile Bars', 'Honest P-values from normal CDF'],
              ['Team vs Team', 'Full matchup report for any two clubs'],
            ].map(([t, d]) => (
              <div key={t} className="flex items-start gap-2.5">
                <span className="w-1 h-1 rounded-full bg-vantage-cyan mt-1.5 shrink-0" />
                <p className="text-[11px] text-gray-300 leading-snug"><span className="font-bold text-white">{t}</span> — {d}</p>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
};
