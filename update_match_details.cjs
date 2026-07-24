const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'pages', 'MatchDetails.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const returnStatementStart = 'return (\n        <div className="min-h-screen bg-vantage-bg pb-20">';

const newReturnBlock = `return (
        <div className="min-h-screen bg-vantage-bg pb-20 font-sans text-white">
            {/* Header (Top Nav) */}
            <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/5">
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button onClick={handleBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <ArrowLeft size={20} className="text-white" />
                        </button>
                        <div className="flex items-center gap-2">
                            <Zap size={16} className="text-vantage-cyan" />
                            <h1 className="text-sm font-bold text-white">Analysis</h1>
                        </div>
                    </div>
                    
                    {/* Desktop-like main tabs / toggle (only active on 'analysis' for now) */}
                    <div className="hidden md:flex bg-white/5 rounded-full p-1 border border-white/10">
                        <button className="px-4 py-1.5 rounded-full bg-vantage-cyan/20 text-vantage-cyan text-xs font-bold">Analysis</button>
                        <button className="px-4 py-1.5 rounded-full text-gray-400 hover:text-white text-xs font-bold transition-colors">Overview</button>
                        <button className="px-4 py-1.5 rounded-full text-gray-400 hover:text-white text-xs font-bold transition-colors">H2H</button>
                        <button className="px-4 py-1.5 rounded-full text-gray-400 hover:text-white text-xs font-bold transition-colors">Lineup</button>
                    </div>
                    
                    <button className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-gray-400">
                        <span className="text-xs font-bold flex items-center gap-1"><Zap size={14}/> Share</span>
                    </button>
                </div>
            </div>

            {/* Match Header */}
            <div className="p-4 border-b border-white/5">
                <div className="flex justify-between items-center px-4 max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 w-1/3">
                        <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-10 h-10 md:w-12 md:h-12" />
                        <span className="text-sm md:text-base font-bold leading-tight">{match.homeTeam}</span>
                        <span className="text-xs text-gray-500 hidden md:inline ml-2">Home</span>
                    </div>
                    
                    <div className="flex flex-col items-center justify-center w-1/3 text-center">
                        <span className="text-sm font-bold text-gray-400 mb-1">VS</span>
                        <span className="text-xs text-gray-300">Today • {match.time}</span>
                        {match.weather && <span className="text-[10px] text-gray-500 mt-1 capitalize flex items-center justify-center gap-1">☁️ 18°C</span>}
                        {match.score && <span className="text-xl font-bold font-mono text-vantage-cyan mt-1">{match.score}</span>}
                    </div>

                    <div className="flex items-center justify-end gap-3 w-1/3 text-right">
                        <span className="text-xs text-gray-500 hidden md:inline mr-2">Away</span>
                        <span className="text-sm md:text-base font-bold leading-tight">{match.awayTeam}</span>
                        <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-10 h-10 md:w-12 md:h-12" />
                    </div>
                </div>
            </div>
            
            {/* VIP Lock Check */}
            {!isVipUser ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-4 max-w-md mx-auto">
                    <div className="w-16 h-16 bg-vantage-purple/20 rounded-full flex items-center justify-center mb-2">
                        <Target size={32} className="text-vantage-purple" />
                    </div>
                    <h3 className="text-lg font-bold">
                        {language === 'fr' ? 'Prédiction VIP Exclusive' : 'Exclusive VIP Prediction'}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {language === 'fr'
                            ? 'Débloquez cette analyse IA complète, la probabilité de réussite et notre pronostic exact en devenant membre VIP.'
                            : 'Unlock this comprehensive AI analysis, the exact success probability, and our precise prediction by becoming a VIP member.'}
                    </p>
                    <button
                        onClick={() => navigate('/vip')}
                        className="mt-4 flex items-center justify-center gap-2 px-6 py-3 bg-vantage-purple hover:bg-purple-600 active:scale-95 transition-all text-white w-full rounded-xl font-bold shadow-lg shadow-vantage-purple/20"
                    >
                        <Zap size={18} className="text-yellow-400 fill-yellow-400" />
                        {language === 'fr' ? 'DEVENIR ALPHA' : 'BECOME ALPHA'}
                    </button>
                </div>
            ) : (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    {/* Safest Pick Banner */}
                    <div className="relative rounded-2xl overflow-hidden mb-4 border border-vantage-cyan/20">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/40 via-vantage-bg to-vantage-bg z-0"></div>
                        <div className="absolute top-0 left-0 w-1/2 h-full bg-[radial-gradient(ellipse_at_left,_var(--tw-gradient-stops))] from-emerald-500/20 via-transparent to-transparent z-0"></div>
                        
                        <div className="relative z-10 p-6 flex flex-col md:flex-row items-center justify-between text-center md:text-left min-h-[160px]">
                            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full mb-4 md:mb-0 md:mr-6 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)] bg-vantage-bg/50 border border-emerald-500/20 shrink-0">
                                 <Trophy size={48} className="text-emerald-400" />
                            </div>
                            
                            <div className="flex-1 flex flex-col items-center md:items-start">
                                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 tracking-widest uppercase mb-2 bg-emerald-500/10 px-2 py-1 rounded-full">
                                    SAFEST PICK <CheckCircle2 size={12} className="ml-1"/>
                                </div>
                                <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
                                    {(() => {
                                        const top = getTopProbPicks(match);
                                        return top.length > 0 ? top.map((p: any) => p.name).join(' / ') : (match.prediction_en || match.prediction || match.bet_type);
                                    })()}
                                </h2>
                                <div className="text-4xl md:text-5xl font-black font-mono text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]">
                                    {(() => {
                                        const top = getTopProbPicks(match);
                                        return top.length > 0 ? Math.round(top[0].prob * 100) : (match.confidence ?? 0);
                                    })()}%
                                </div>
                                <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-500 mt-1 font-bold">CONFIDENCE</span>
                            </div>
                            
                            <div className="hidden md:flex items-end gap-1 h-20 opacity-30">
                                {[20,30,40,25,45,60,50,70,80,90,100,85,95,90].map((h, i) => (
                                    <div key={i} className="w-2 bg-emerald-400 rounded-t-sm" style={{height: \`\${h}%\`}}></div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        {/* AI Confidence Card */}
                        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 flex items-center justify-center relative overflow-hidden group hover:border-vantage-cyan/30 transition-colors">
                            <div className="w-12 h-12 rounded-full border-[3px] border-vantage-cyan flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(45,212,191,0.2)]">
                                <span className="text-xs font-bold font-mono text-white">{match.confidence ?? 0}%</span>
                            </div>
                            <div className="ml-3">
                                <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">AI CONFIDENCE</span>
                                <span className="text-sm font-bold text-vantage-cyan block">Very Strong</span>
                            </div>
                        </div>
                        
                        {/* Expected Goals Card */}
                        {match.expected_goals_home != null && match.expected_goals_away != null && (
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 flex flex-col justify-center relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">EXPECTED GOALS</span>
                                    <Activity size={14} className="text-emerald-400 opacity-50" />
                                </div>
                                <div className="text-xl font-bold font-mono text-white mb-1">
                                    {(match.expected_goals_home + match.expected_goals_away).toFixed(2)}
                                </div>
                                <div className="text-[10px] font-mono flex gap-3 text-gray-400">
                                    <span><span className="text-gray-500">Home</span> <span className="text-emerald-400">{match.expected_goals_home.toFixed(2)}</span></span>
                                    <span><span className="text-gray-500">Away</span> <span className="text-blue-400">{match.expected_goals_away.toFixed(2)}</span></span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Secondary Tabs */}
                    <div className="flex border-b border-white/10 mb-6 overflow-x-auto no-scrollbar gap-6">
                        {['Markets Analysis', 'Scorelines', 'Insights', 'Trends'].map(tab => (
                            <button
                                key={tab}
                                className={\`py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-colors px-1 \${
                                    tab === 'Markets Analysis' 
                                        ? 'border-vantage-cyan text-vantage-cyan' 
                                        : 'border-transparent text-gray-400 hover:text-white'
                                }\`}
                            >
                                <span className="flex items-center gap-2">
                                    {tab === 'Markets Analysis' && <BarChart3 size={14}/>}
                                    {tab === 'Scorelines' && <Target size={14}/>}
                                    {tab === 'Insights' && <Zap size={14}/>}
                                    {tab === 'Trends' && <Activity size={14}/>}
                                    {tab}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Markets Analysis Grid Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-6">
                        {/* Left Column */}
                        <div className="md:col-span-4 space-y-6">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <div className="flex justify-between items-center mb-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">ALL MARKETS</h3>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <span className="text-[10px] text-gray-500 block mb-2">Match Result</span>
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-gray-300 w-12">Home</span>
                                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-blue-500" style={{width: \`\${(match.home_win_prob||0)*100}%\`}}></div></div>
                                                <span className="text-xs font-mono w-10 text-right">{Math.round((match.home_win_prob||0)*100)}%</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-gray-300 w-12">Draw</span>
                                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-blue-500/50" style={{width: \`\${(match.draw_prob||0)*100}%\`}}></div></div>
                                                <span className="text-xs font-mono w-10 text-right">{Math.round((match.draw_prob||0)*100)}%</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-gray-300 w-12">Away</span>
                                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-slate-500" style={{width: \`\${(match.away_win_prob||0)*100}%\`}}></div></div>
                                                <span className="text-xs font-mono w-10 text-right">{Math.round((match.away_win_prob||0)*100)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-gray-500 block mb-2">Total Goals</span>
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-gray-300 w-16">Over 1.5</span>
                                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-emerald-500" style={{width: \`\${(match.over15_prob||0)*100}%\`}}></div></div>
                                                <span className="text-xs font-mono w-10 text-right">{Math.round((match.over15_prob||0)*100)}%</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-gray-300 w-16">Over 2.5</span>
                                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-emerald-500" style={{width: \`\${(match.over25_prob||0)*100}%\`}}></div></div>
                                                <span className="text-xs font-mono w-10 text-right">{Math.round((match.over25_prob||0)*100)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Middle Column */}
                        <div className="md:col-span-4 space-y-4">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5 h-full">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">GOALS MARKETS</h3>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-lg bg-emerald-900/10 border border-emerald-500/20 relative overflow-hidden group hover:bg-emerald-900/20 transition-colors">
                                        <div className="flex justify-between items-start mb-2 relative z-10">
                                            <span className="text-sm font-bold text-white">Over 1.5 Goals</span>
                                            <svg className="w-24 h-8 text-emerald-400 opacity-60" viewBox="0 0 100 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M0 25 Q10 20 20 25 T40 15 T60 20 T80 5 T100 10" />
                                            </svg>
                                        </div>
                                        <div className="flex items-baseline gap-2 relative z-10">
                                            <span className="text-2xl font-bold font-mono text-emerald-400">{Math.round((match.over15_prob||0)*100)}%</span>
                                            <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wide">Very Strong</span>
                                        </div>
                                        <div className="absolute bottom-0 right-0 w-32 h-24 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-emerald-500/20 to-transparent z-0 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                                    </div>

                                    <div className="p-4 rounded-lg bg-emerald-900/10 border border-emerald-500/20 relative overflow-hidden group hover:bg-emerald-900/20 transition-colors">
                                        <div className="flex justify-between items-start mb-2 relative z-10">
                                            <span className="text-sm font-bold text-white">Over 2.5 Goals</span>
                                            <svg className="w-24 h-8 text-emerald-400 opacity-60" viewBox="0 0 100 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M0 20 Q10 25 20 15 T40 15 T60 20 T80 5 T100 10" />
                                            </svg>
                                        </div>
                                        <div className="flex items-baseline gap-2 relative z-10">
                                            <span className="text-2xl font-bold font-mono text-emerald-400">{Math.round((match.over25_prob||0)*100)}%</span>
                                            <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wide">Very Strong</span>
                                        </div>
                                        <div className="absolute bottom-0 right-0 w-32 h-24 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-emerald-500/20 to-transparent z-0 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="md:col-span-4 space-y-6">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">KEY STATS</h3>
                                <div className="space-y-4">
                                    {[
                                        {label: 'Avg. Goals For', home: (match.homeAvgScored||0).toFixed(2), away: (match.awayAvgScored||0).toFixed(2)},
                                        {label: 'Avg. Goals Against', home: (match.homeAvgConceded||0).toFixed(2), away: (match.awayAvgConceded||0).toFixed(2)},
                                        {label: 'Shots Per Game', home: matchStats?.stats?.shots?.home || (match as any).home_shots_on_target || 0, away: matchStats?.stats?.shots?.away || (match as any).away_shots_on_target || 0},
                                        {label: 'Possession', home: matchStats?.stats?.possession?.home || (match as any).home_possession || 50, away: matchStats?.stats?.possession?.away || (match as any).away_possession || 50, isPct: true}
                                    ].map(stat => (
                                        <div key={stat.label}>
                                            <div className="flex justify-between text-[10px] mb-1">
                                                <span className="font-mono text-gray-300">{stat.home}{stat.isPct?'%':''}</span>
                                                <span className="text-gray-500">{stat.label}</span>
                                                <span className="font-mono text-gray-300">{stat.away}{stat.isPct?'%':''}</span>
                                            </div>
                                            <div className="flex h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                <div className="bg-emerald-500 h-full" style={{width: \`\${Number(stat.home) / (Number(stat.home) + Number(stat.away) || 1) * 100}%\`}}></div>
                                                <div className="bg-blue-500 h-full" style={{width: \`\${Number(stat.away) / (Number(stat.home) + Number(stat.away) || 1) * 100}%\`}}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Bottom Row */}
                        <div className="md:col-span-12 space-y-6">
                            {match.top_scorelines?.length > 0 && (
                                <div>
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">LIKELY SCORELINES</h3>
                                    <div className="flex flex-wrap gap-2 md:gap-3">
                                        {match.top_scorelines.slice(0, 5).map((sl: any, i: number) => {
                                            const prob = (sl.prob || sl[1] || 0) * 100;
                                            return (
                                                <div key={i} className={\`flex-1 min-w-[70px] flex flex-col items-center justify-center p-2 rounded-lg border \${i === 0 ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-900/60 border-white/5'} transition-colors\`}>
                                                    <span className="text-sm md:text-base font-bold text-white mb-0.5">{sl.score || sl.scoreline || sl[0] || sl}</span>
                                                    <span className={\`text-[10px] font-mono \${i === 0 ? 'text-emerald-400' : 'text-gray-400'}\`}>{prob.toFixed(0)}%</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">RECENT FORM</h3>
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-8 h-8 opacity-80" />
                                                <div className="flex gap-1">
                                                    {(match.homeForm || 'W W D L W').split(' ').map((res, i) => (
                                                        <span key={i} className={\`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold \${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-500/20 text-slate-400'}\`}>{res}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex gap-1">
                                                    {(match.awayForm || 'L W L D L').split(' ').map((res, i) => (
                                                        <span key={i} className={\`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold \${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-500/20 text-slate-400'}\`}>{res}</span>
                                                    ))}
                                                </div>
                                                <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-8 h-8 opacity-80" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {(match as any).analysis_en && (
                                <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5 flex gap-4 items-start">
                                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                                        <Zap size={20} className="text-blue-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-[10px] font-bold uppercase text-emerald-400 tracking-widest mb-2">AI INSIGHT</h4>
                                        <p className="text-xs text-gray-300 leading-relaxed">
                                            {language === 'fr' ? ((match as any).analysis_fr || (match as any).analysis_en) : (match as any).analysis_en}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );`;

const startIndex = content.indexOf(returnStatementStart);
if (startIndex === -1) {
    console.error("Could not find start index");
    process.exit(1);
}

// Find the last '};' which closes the MatchDetails component
const matchDetailsEndMatch = [...content.matchAll(/};\s*export default MatchDetails;/g)];
if (matchDetailsEndMatch.length === 0) {
    console.error("Could not find end of MatchDetails component");
    process.exit(1);
}

const lastMatch = matchDetailsEndMatch[matchDetailsEndMatch.length - 1];
const endIndex = lastMatch.index;

const newContent = content.substring(0, startIndex) + newReturnBlock + '\n};\n\nexport default MatchDetails;\n';
fs.writeFileSync(filePath, newContent, 'utf8');
console.log("Successfully rewrote MatchDetails.tsx");
