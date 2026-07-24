const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'pages', 'MatchDetails.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix scrollable tabs
content = content.replace(
    '<div className="flex border-b border-white/10 mb-6 overflow-x-auto no-scrollbar gap-6">',
    '<div className="flex border-b border-white/10 mb-6 overflow-x-auto no-scrollbar gap-6 flex-nowrap">'
);
content = content.replace(
    'className={`py-3 text-sm font-bold whitespace-nowrap',
    'className={`py-3 text-sm font-bold whitespace-nowrap flex-shrink-0'
);


// 2. Replace the Left Column (All Markets) with dynamic code
const allMarketsStart = content.indexOf('{/* Left Column */}');
const middleColumnStart = content.indexOf('{/* Middle Column */}');

if (allMarketsStart > -1 && middleColumnStart > -1) {
    const newLeftColumn = `{/* Left Column */}
                        <div className="md:col-span-4 space-y-6">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <div className="flex justify-between items-center mb-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">ALL MARKETS</h3>
                                </div>
                                <div className="space-y-4">
                                    {[
                                        { g: 'Match Result', items: [
                                            { l: 'Home', p: (match.home_win_prob || 0) * 100 },
                                            { l: 'Draw', p: (match.draw_prob || 0) * 100 },
                                            { l: 'Away', p: (match.away_win_prob || 0) * 100 },
                                        ].sort((a: any, b: any) => b.p - a.p) },
                                        { g: 'Goals', items: [
                                            { l: 'Over 1.5', p: (match.over15_prob || 0) * 100 },
                                            { l: 'Over 2.5', p: (match.over25_prob || 0) * 100 },
                                            { l: 'Under 2.5', p: (match.under25_prob || 0) * 100 },
                                        ].filter((r: any) => r.p > 0).sort((a: any, b: any) => b.p - a.p) },
                                        { g: 'BTTS & FH', items: [
                                            { l: 'BTTS Yes', p: (match.btts_prob || 0) * 100 },
                                            { l: 'FH Over 0.5', p: (match.fh_over05_prob || 0) * 100 },
                                        ].filter((r: any) => r.p > 0) },
                                    ].map((group, gi) => group.items.length > 0 && (
                                        <div key={group.g}>
                                            <span className="text-[10px] text-gray-500 block mb-2">{group.g}</span>
                                            <div className="space-y-2">
                                                {group.items.map((r: any) => (
                                                    <div key={r.l} className="flex items-center gap-3">
                                                        <span className="text-xs text-gray-300 w-16 truncate">{r.l}</span>
                                                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                                            <div className={\`h-full \${r.p >= 70 ? 'bg-emerald-500' : r.p >= 50 ? 'bg-vantage-cyan' : 'bg-slate-500'}\`} style={{width: \`\${Math.min(r.p, 100)}%\`}}></div>
                                                        </div>
                                                        <span className="text-xs font-mono w-10 text-right">{r.p.toFixed(0)}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        `;
    content = content.substring(0, allMarketsStart) + newLeftColumn + content.substring(middleColumnStart);
}

// 3. Replace the Middle Column (Goals Markets) with dynamic top markets
const newMiddleColumnStart = content.indexOf('{/* Middle Column */}');
const rightColumnStart = content.indexOf('{/* Right Column */}');

if (newMiddleColumnStart > -1 && rightColumnStart > -1) {
    const newMiddleColumn = `{/* Middle Column */}
                        <div className="md:col-span-4 space-y-4">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5 h-full">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">TOP MARKETS</h3>
                                <div className="space-y-4">
                                    {(() => {
                                        const topMarkets = [
                                            { l: 'Over 1.5 Goals', p: (match.over15_prob || 0) * 100 },
                                            { l: 'Over 2.5 Goals', p: (match.over25_prob || 0) * 100 },
                                            { l: 'Under 2.5 Goals', p: (match.under25_prob || 0) * 100 },
                                            { l: 'BTTS Yes', p: (match.btts_prob || 0) * 100 },
                                            { l: 'FH Over 0.5', p: (match.fh_over05_prob || 0) * 100 },
                                        ].filter(m => m.p > 0).sort((a, b) => b.p - a.p).slice(0, 2);

                                        if (topMarkets.length === 0) {
                                            return <p className="text-sm text-gray-500">No top markets available.</p>;
                                        }

                                        return topMarkets.map((m, i) => (
                                            <div key={i} className="p-4 rounded-lg bg-emerald-900/10 border border-emerald-500/20 relative overflow-hidden group hover:bg-emerald-900/20 transition-colors">
                                                <div className="flex justify-between items-start mb-2 relative z-10">
                                                    <span className="text-sm font-bold text-white">{m.l}</span>
                                                    <svg className="w-24 h-8 text-emerald-400 opacity-60" viewBox="0 0 100 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d={i === 0 ? "M0 25 Q10 20 20 25 T40 15 T60 20 T80 5 T100 10" : "M0 20 Q10 25 20 15 T40 15 T60 20 T80 5 T100 10"} />
                                                    </svg>
                                                </div>
                                                <div className="flex items-baseline gap-2 relative z-10">
                                                    <span className="text-2xl font-bold font-mono text-emerald-400">{Math.round(m.p)}%</span>
                                                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wide">{m.p >= 80 ? 'Very Strong' : m.p >= 60 ? 'Strong' : 'Moderate'}</span>
                                                </div>
                                                <div className="absolute bottom-0 right-0 w-32 h-24 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-emerald-500/20 to-transparent z-0 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>

                        `;
    content = content.substring(0, newMiddleColumnStart) + newMiddleColumn + content.substring(rightColumnStart);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated MatchDetails.tsx with dynamic markets and scrollable tabs.");
