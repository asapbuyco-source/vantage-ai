import React, { useMemo, useState } from 'react';
import { Calculator, Layers, TrendingUp, Split, Percent, Wallet, Plus, Minus, Repeat } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { PlayStoreCTA } from './PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const toNum = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : '—');

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

const decimalToFraction = (dec: number): string => {
    if (!Number.isFinite(dec) || dec <= 1) return '—';
    const target = dec - 1;
    let bestN = 1;
    let bestD = 1;
    let bestErr = Infinity;
    for (let d = 1; d <= 50; d += 1) {
        const n = Math.round(target * d);
        if (n < 1) continue;
        const err = Math.abs(target - n / d);
        if (err < bestErr) {
            bestErr = err;
            bestN = n;
            bestD = d;
            if (err < 1e-6) break;
        }
    }
    const g = gcd(bestN, bestD) || 1;
    return `${bestN / g}/${bestD / g}`;
};

const decimalToAmerican = (dec: number): string => {
    if (!Number.isFinite(dec) || dec <= 1) return '—';
    if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
    return `${Math.round(-100 / (dec - 1))}`;
};

type ToolId = 'odds' | 'acca' | 'ev' | 'dutch' | 'kelly' | 'bank';

const inputCls =
    'w-full rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-mono text-slate-900 dark:text-white outline-none focus:border-vantage-cyan/60';
const labelCls = 'text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1 block';
const resultRow = 'flex items-center justify-between py-1.5 border-b border-slate-200/60 dark:border-white/5 last:border-0';

export const ToolsHub: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { language } = useAppContext();
    const fr = language === 'fr';
    const [active, setActive] = useState<ToolId>('odds');

    const [oddsInput, setOddsInput] = useState('1.85');
    const [accaLegs, setAccaLegs] = useState<string[]>(['1.80', '1.95']);
    const [accaStake, setAccaStake] = useState('10');
    const [evProb, setEvProb] = useState('55');
    const [evOdds, setEvOdds] = useState('2.10');
    const [evStake, setEvStake] = useState('10');
    const [dutchOdds, setDutchOdds] = useState<string[]>(['2.10', '3.40', '3.80']);
    const [dutchStake, setDutchStake] = useState('100');
    const [kellyProb, setKellyProb] = useState('55');
    const [kellyOdds, setKellyOdds] = useState('2.10');
    const [kellyBank, setKellyBank] = useState('1000');
    const [bankRoll, setBankRoll] = useState('1000');
    const [bankPct, setBankPct] = useState('2');
    const [bankBets, setBankBets] = useState('5');

    const tabs: { id: ToolId; label: string; icon: React.ElementType }[] = [
        { id: 'odds', label: fr ? 'Cotes' : 'Odds', icon: Repeat },
        { id: 'acca', label: fr ? 'Combiné' : 'Acca', icon: Layers },
        { id: 'ev', label: fr ? 'Valeur' : 'Value', icon: TrendingUp },
        { id: 'dutch', label: fr ? 'Répartition' : 'Dutching', icon: Split },
        { id: 'kelly', label: 'Kelly', icon: Percent },
        { id: 'bank', label: fr ? 'Bankroll' : 'Bankroll', icon: Wallet },
    ];

    const oddsDec = toNum(oddsInput);
    const accaTotal = useMemo(() => accaLegs.reduce((acc, l) => acc * Math.max(toNum(l), 1), 1), [accaLegs]);
    const accaReturn = toNum(accaStake) * accaTotal;

    const p = toNum(evProb) / 100;
    const evOddsNum = toNum(evOdds);
    const evPct = (p * evOddsNum - 1) * 100;
    const evAmount = toNum(evStake) * (p * evOddsNum - 1);
    const evImplied = evOddsNum > 0 ? 100 / evOddsNum : 0;

    const validDutch = dutchOdds.map(toNum).filter(o => o > 1);
    const invSum = validDutch.reduce((s, o) => s + 1 / o, 0);
    const dutchTotalStake = toNum(dutchStake);
    const dutchPayout = invSum > 0 ? dutchTotalStake / invSum : 0;

    const kP = toNum(kellyProb) / 100;
    const kOdds = toNum(kellyOdds);
    const kBank = toNum(kellyBank);
    const kellyB = kOdds - 1;
    const kellyF = kellyB > 0 ? (kellyB * kP - (1 - kP)) / kellyB : 0;

    const bankTotal = toNum(bankRoll);
    const bankUnit = bankTotal * (toNum(bankPct) / 100);

    return (
        <GlassCard className={`p-0 overflow-hidden ${className}`}>
            <div className="px-4 pt-4 pb-3 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-vantage-cyan/10 border border-vantage-cyan/20 flex items-center justify-center">
                        <Calculator size={16} className="text-vantage-cyan" />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                            {fr ? 'Outils de paris' : 'Betting Tools'}
                        </h2>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                            {fr ? 'Cotes, valeur, mises — gratuits et instantanés' : 'Odds, value, staking — free and instant'}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5 border-b border-slate-200 dark:border-white/10 no-scrollbar">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const on = active === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActive(tab.id)}
                            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                                on
                                    ? 'bg-vantage-cyan text-black'
                                    : 'bg-slate-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-white/10'
                            }`}
                        >
                            <Icon size={12} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="p-4">
                {active === 'odds' && (
                    <div className="space-y-3">
                        <div>
                            <label className={labelCls}>{fr ? 'Cote décimale' : 'Decimal odds'}</label>
                            <input className={inputCls} inputMode="decimal" value={oddsInput} onChange={e => setOddsInput(e.target.value)} placeholder="1.85" />
                        </div>
                        <div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Fractionnaire' : 'Fractional'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{decimalToFraction(oddsDec)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Américaine' : 'American'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{decimalToAmerican(oddsDec)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Probabilité implicite' : 'Implied probability'}</span><span className="text-sm font-mono font-bold text-vantage-cyan">{oddsDec > 0 ? `${fmt(100 / oddsDec, 1)}%` : '—'}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Mise pour gagner 100' : 'Stake to win 100'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{oddsDec > 1 ? fmt(100 / (oddsDec - 1), 2) : '—'}</span></div>
                        </div>
                    </div>
                )}

                {active === 'acca' && (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            {accaLegs.map((leg, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500 w-10">{fr ? 'Leg' : 'Leg'} {i + 1}</span>
                                    <input className={inputCls} inputMode="decimal" value={leg} onChange={e => setAccaLegs(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} placeholder="1.80" />
                                    <button onClick={() => setAccaLegs(prev => (prev.length > 2 ? prev.filter((_, j) => j !== i) : prev))} className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 disabled:opacity-30" disabled={accaLegs.length <= 2}>
                                        <Minus size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setAccaLegs(prev => [...prev, '1.50'])} className="inline-flex items-center gap-1 text-[11px] font-bold text-vantage-cyan">
                            <Plus size={12} /> {fr ? 'Ajouter une sélection' : 'Add a leg'}
                        </button>
                        <div>
                            <label className={labelCls}>{fr ? 'Mise' : 'Stake'}</label>
                            <input className={inputCls} inputMode="decimal" value={accaStake} onChange={e => setAccaStake(e.target.value)} placeholder="10" />
                        </div>
                        <div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Cote totale' : 'Total odds'}</span><span className="text-sm font-mono font-bold text-vantage-cyan">{fmt(accaTotal)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Retour potentiel' : 'Potential return'}</span><span className="text-sm font-mono font-bold text-emerald-500">{fmt(accaReturn)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Bénéfice' : 'Profit'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{fmt(accaReturn - toNum(accaStake))}</span></div>
                        </div>
                    </div>
                )}

                {active === 'ev' && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className={labelCls}>{fr ? 'Votre probabilité %' : 'Your probability %'}</label>
                                <input className={inputCls} inputMode="decimal" value={evProb} onChange={e => setEvProb(e.target.value)} placeholder="55" />
                            </div>
                            <div>
                                <label className={labelCls}>{fr ? 'Cote' : 'Odds'}</label>
                                <input className={inputCls} inputMode="decimal" value={evOdds} onChange={e => setEvOdds(e.target.value)} placeholder="2.10" />
                            </div>
                        </div>
                        <div>
                            <label className={labelCls}>{fr ? 'Mise' : 'Stake'}</label>
                            <input className={inputCls} inputMode="decimal" value={evStake} onChange={e => setEvStake(e.target.value)} placeholder="10" />
                        </div>
                        <div>
                            <div className={resultRow}><span className="text-xs text-gray-500">EV %</span><span className={`text-sm font-mono font-bold ${evPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{evPct >= 0 ? '+' : ''}{fmt(evPct, 1)}%</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'EV en argent' : 'EV in money'}</span><span className={`text-sm font-mono font-bold ${evAmount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{evAmount >= 0 ? '+' : ''}{fmt(evAmount)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Probabilité implicite' : 'Implied probability'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{fmt(evImplied, 1)}%</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Marge' : 'Edge'}</span><span className={`text-sm font-mono font-bold ${evPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmt(toNum(evProb) - evImplied, 1)} pp</span></div>
                        </div>
                        <p className="text-[10px] text-gray-500">{evPct >= 0 ? (fr ? 'Valeur positive — la cote paie plus que la probabilité.' : 'Positive value — the price pays more than the probability.') : (fr ? 'Pas de valeur — passez ce pari.' : 'No value — skip this bet.')}</p>
                    </div>
                )}

                {active === 'dutch' && (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            {dutchOdds.map((o, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500 w-14">{fr ? 'Issue' : 'Outcome'} {i + 1}</span>
                                    <input className={inputCls} inputMode="decimal" value={o} onChange={e => setDutchOdds(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} placeholder="2.10" />
                                </div>
                            ))}
                        </div>
                        <div>
                            <label className={labelCls}>{fr ? 'Mise totale' : 'Total stake'}</label>
                            <input className={inputCls} inputMode="decimal" value={dutchStake} onChange={e => setDutchStake(e.target.value)} placeholder="100" />
                        </div>
                        <div>
                            {validDutch.map((o, i) => (
                                <div key={i} className={resultRow}>
                                    <span className="text-xs text-gray-500">{fr ? 'Issue' : 'Outcome'} {i + 1} @ {fmt(o)}</span>
                                    <span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{fmt(invSum > 0 ? (dutchTotalStake / invSum) / o : 0)}</span>
                                </div>
                            ))}
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Retour garanti' : 'Guaranteed return'}</span><span className="text-sm font-mono font-bold text-vantage-cyan">{fmt(dutchPayout)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Profit' : 'Profit'}</span><span className={`text-sm font-mono font-bold ${dutchPayout - dutchTotalStake >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmt(dutchPayout - dutchTotalStake)}</span></div>
                        </div>
                        <p className="text-[10px] text-gray-500">{invSum > 0 && invSum < 1 ? (fr ? 'Arbitrage détecté — profit sans risque.' : 'Arbitrage detected — risk-free profit.') : (fr ? 'Pas d\'arbitrage : le retour est inférieur à la mise.' : 'No arbitrage: return is below the stake.')}</p>
                    </div>
                )}

                {active === 'kelly' && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className={labelCls}>{fr ? 'Probabilité %' : 'Probability %'}</label>
                                <input className={inputCls} inputMode="decimal" value={kellyProb} onChange={e => setKellyProb(e.target.value)} placeholder="55" />
                            </div>
                            <div>
                                <label className={labelCls}>{fr ? 'Cote' : 'Odds'}</label>
                                <input className={inputCls} inputMode="decimal" value={kellyOdds} onChange={e => setKellyOdds(e.target.value)} placeholder="2.10" />
                            </div>
                        </div>
                        <div>
                            <label className={labelCls}>{fr ? 'Bankroll' : 'Bankroll'}</label>
                            <input className={inputCls} inputMode="decimal" value={kellyBank} onChange={e => setKellyBank(e.target.value)} placeholder="1000" />
                        </div>
                        <div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Kelly complet' : 'Full Kelly'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{fmt(kellyF * 100, 1)}% · {fmt(kellyF * kBank)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Demi Kelly' : 'Half Kelly'}</span><span className="text-sm font-mono font-bold text-vantage-cyan">{fmt(kellyF * 50, 1)}% · {fmt(kellyF * kBank / 2)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Quart Kelly' : 'Quarter Kelly'}</span><span className="text-sm font-mono font-bold text-emerald-500">{fmt(kellyF * 25, 1)}% · {fmt(kellyF * kBank / 4)}</span></div>
                        </div>
                        <p className="text-[10px] text-gray-500">{kellyF <= 0 ? (fr ? 'Aucun avantage — ne pariez pas.' : 'No edge — do not bet.') : (fr ? 'La plupart des pros utilisent un quart ou un demi Kelly.' : 'Most pros use quarter or half Kelly to cut variance.')}</p>
                    </div>
                )}

                {active === 'bank' && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className={labelCls}>{fr ? 'Bankroll' : 'Bankroll'}</label>
                                <input className={inputCls} inputMode="decimal" value={bankRoll} onChange={e => setBankRoll(e.target.value)} placeholder="1000" />
                            </div>
                            <div>
                                <label className={labelCls}>{fr ? 'Unité %' : 'Unit %'}</label>
                                <input className={inputCls} inputMode="decimal" value={bankPct} onChange={e => setBankPct(e.target.value)} placeholder="2" />
                            </div>
                        </div>
                        <div>
                            <label className={labelCls}>{fr ? 'Paris max / jour' : 'Max bets / day'}</label>
                            <input className={inputCls} inputMode="decimal" value={bankBets} onChange={e => setBankBets(e.target.value)} placeholder="5" />
                        </div>
                        <div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Mise par pari' : 'Stake per bet'}</span><span className="text-sm font-mono font-bold text-vantage-cyan">{fmt(bankUnit)}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Exposition journalière max' : 'Max daily exposure'}</span><span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{fmt(bankUnit * toNum(bankBets))}</span></div>
                            <div className={resultRow}><span className="text-xs text-gray-500">{fr ? 'Perte max (10 paris)' : 'Max loss (10 bets)'}</span><span className="text-sm font-mono font-bold text-rose-500">{fmt(bankUnit * 10)}</span></div>
                        </div>
                        <p className="text-[10px] text-gray-500">{fr ? 'Règle : 1–2% par pari protège votre bankroll des séries perdantes.' : 'Rule of thumb: 1–2% per bet survives losing streaks.'}</p>
                    </div>
                )}
            </div>

            <div className="px-4 pb-4">
                <PlayStoreCTA variant="banner" />
            </div>
        </GlassCard>
    );
};
