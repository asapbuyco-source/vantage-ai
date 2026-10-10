import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ChevronRight, Trophy, Target } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAppContext } from '../context/AppContext';
import { MotionDiv } from '../components/MotionDiv';
import { GlassCard } from '../components/GlassCard';
import { Match } from '../types';

// League slugs -> display names + the league name aliases found in the
// quant_predictions payload (case-insensitive substring match).
// KEEP IN SYNC with the SSR map in server.js (seo/pronostics route + sitemap).
export const LEAGUE_SLUGS: Record<string, { name: string; nameFr: string; aliases: string[] }> = {
    'premier-league': { name: 'Premier League', nameFr: 'Premier League', aliases: ['premier league', 'english premier league'] },
    'la-liga': { name: 'La Liga', nameFr: 'La Liga', aliases: ['la liga', 'laliga', 'primera division'] },
    'bundesliga': { name: 'Bundesliga', nameFr: 'Bundesliga', aliases: ['bundesliga'] },
    'serie-a': { name: 'Serie A', nameFr: 'Série A', aliases: ['serie a'] },
    'ligue-1': { name: 'Ligue 1', nameFr: 'Ligue 1', aliases: ['ligue 1'] },
    'champions-league': { name: 'UEFA Champions League', nameFr: 'Ligue des Champions', aliases: ['champions league', 'uefa champions league'] },
    'europa-league': { name: 'UEFA Europa League', nameFr: 'Ligue Europa', aliases: ['europa league', 'uefa europa league'] },
    'eredivisie': { name: 'Eredivisie', nameFr: 'Eredivisie', aliases: ['eredivisie'] },
    'primeira-liga': { name: 'Primeira Liga', nameFr: 'Primeira Liga', aliases: ['primeira liga'] },
    'championship': { name: 'EFL Championship', nameFr: 'Championship', aliases: ['championship', 'efl championship'] },
    'elite-one': { name: 'Elite One', nameFr: 'Élite One', aliases: ['elite one', 'mtn elite one'] },
    'liga-mx': { name: 'Liga MX', nameFr: 'Liga MX', aliases: ['liga mx'] },
    'saudi-pro-league': { name: 'Saudi Pro League', nameFr: 'Saudi Pro League', aliases: ['saudi pro league', 'saudi league'] },
    'sueper-lig': { name: 'Süper Lig', nameFr: 'Süper Lig', aliases: ['sueper lig', 'super lig', 'süper lig'] },
    'brasileirao': { name: 'Brasileirão Série A', nameFr: 'Brasileirão Série A', aliases: ['brasileirão série a', 'brasileirao serie a', 'brasileirão'] },
    'mls': { name: 'Major League Soccer', nameFr: 'Major League Soccer', aliases: ['major league soccer', 'mls'] },
    'fifa-world-cup': { name: 'FIFA World Cup', nameFr: 'Coupe du Monde', aliases: ['fifa world cup', 'world cup'] },
};

export function resolveLeague(slug: string) {
    return LEAGUE_SLUGS[slug] || null;
}

function confidenceOf(m: Match): number {
    return m.confidence ?? (m.probability != null ? Math.round(m.probability * 100) : 0);
}

export const LeaguePage: React.FC = () => {
    const { leagueSlug } = useParams<{ leagueSlug: string }>();
    const { predictions, loading } = useData();
    const { language } = useAppContext();

    const cfg = leagueSlug ? resolveLeague(leagueSlug) : null;

    const matches = useMemo(() => {
        if (!cfg) return [];
        return predictions
            .filter(m => {
                const league = String(m.league || '').toLowerCase();
                return cfg.aliases.some(a => league.includes(a));
            })
            .sort((a, b) => confidenceOf(b) - confidenceOf(a));
    }, [cfg, predictions]);

    if (!cfg) {
        return (
            <div className="min-h-screen bg-vantage-bg text-white flex flex-col items-center justify-center px-6 py-24 text-center">
                <h1 className="text-2xl font-bold mb-2">
                    {language === 'fr' ? 'Championnat introuvable' : 'League not found'}
                </h1>
                <Link to="/" className="text-vantage-cyan underline mt-4">
                    {language === 'fr' ? '← Retour à l’accueil' : '← Back to home'}
                </Link>
            </div>
        );
    }

    const dateLabel = new Date().toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
        weekday: 'long', day: 'numeric', month: 'long',
    });

    return (
        <div className="min-h-screen bg-vantage-bg text-white pb-24">
            <div className="mx-auto max-w-3xl px-4 pt-8">
                {/* SEO H1 */}
                <h1 className="text-2xl md:text-3xl font-black font-orbitron tracking-tight">
                    {language === 'fr'
                        ? `Pronostics ${cfg.nameFr} du jour`
                        : `${cfg.name} Predictions Today`}
                    <span className="text-vantage-purple"> | Vantage AI</span>
                </h1>
                <p className="text-sm text-gray-400 mt-2 capitalize">{dateLabel}</p>
                <p className="text-xs text-gray-500 mt-1">
                    {language === 'fr'
                        ? 'Analyses data-driven générées par notre moteur quantitatif : Poisson, Elo, forme, valeurs attendues et gestion du risque.'
                        : 'Data-driven analysis from our quantitative engine: Poisson, Elo, form, expected value and risk management.'}
                </p>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={28} className="animate-spin text-vantage-cyan" />
                    </div>
                ) : matches.length === 0 ? (
                    <div className="py-20 text-center text-gray-500">
                        <Trophy size={36} className="mx-auto mb-4 text-gray-600" />
                        <p>{language === 'fr' ? 'Aucun match publié pour ce championnat aujourd’hui.' : 'No matches published for this league today.'}</p>
                        <p className="text-xs mt-2 text-gray-600">
                            {language === 'fr' ? 'Revenez demain matin après 07h00.' : 'Check back tomorrow morning after 07:00.'}
                        </p>
                    </div>
                ) : (
                    <div className="mt-6 space-y-3">
                        {matches.map((m, i) => {
                            const conf = confidenceOf(m);
                            return (
                                <MotionDiv key={m.id || m.fixture_id || i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}>
                                    <Link to={`/match/${m.id || m.fixture_id}`} className="block">
                                        <GlassCard className="p-4 hover:border-vantage-purple/30 transition-colors">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{m.league}</span>
                                                <span className="text-[10px] text-gray-500 font-mono">{m.time || ''}</span>
                                            </div>
                                            <p className="text-sm font-bold text-white">
                                                {m.homeTeam} <span className="text-gray-500 mx-1">vs</span> {m.awayTeam}
                                            </p>
                                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                                <span className="flex items-center gap-1 text-[11px] font-black text-vantage-purple bg-vantage-purple/10 px-2 py-1 rounded-full">
                                                    <Target size={10} /> {m.prediction || m.prediction_en || '—'}
                                                </span>
                                                <span className="text-[11px] font-mono px-2 py-1 rounded bg-white/5 text-gray-300">
                                                    @ {m.odds ? Number(m.odds).toFixed(2) : '—'}
                                                </span>
                                                <span className="text-[11px] font-bold px-2 py-1 rounded bg-green-500/10 text-green-400">
                                                    {conf}%
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 rounded-full bg-white/5 mt-3 overflow-hidden">
                                                <div
                                                    className={`h-full ${conf >= 70 ? 'bg-emerald-500' : conf >= 55 ? 'bg-vantage-cyan' : 'bg-slate-500'}`}
                                                    style={{ width: `${Math.min(conf, 100)}%` }}
                                                />
                                            </div>
                                        </GlassCard>
                                    </Link>
                                </MotionDiv>
                            );
                        })}
                    </div>
                )}

                <div className="mt-8 flex flex-col gap-3">
                    <Link to="/free" className="w-full py-3 bg-vantage-purple hover:bg-purple-600 text-white text-sm font-bold rounded-xl text-center transition-colors">
                        {language === 'fr' ? 'Voir tous les pronostics du jour →' : 'See all of today’s predictions →'}
                    </Link>
                    <p className="text-center text-[10px] text-gray-600">
                        {language === 'fr'
                            ? 'Les pronostics ne garantissent aucun gain. Jouez de manière responsable.'
                            : 'Predictions do not guarantee winnings. Bet responsibly.'}
                    </p>
                </div>

                <div className="mt-10 flex flex-wrap gap-2 justify-center">
                    {Object.entries(LEAGUE_SLUGS).map(([slug, l]) => (
                        <Link key={slug} to={`/pronostics/${slug}`}
                            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors ${slug === leagueSlug ? 'border-vantage-purple text-vantage-purple' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/25'}`}>
                            {language === 'fr' ? l.nameFr : l.name}
                        </Link>
                    ))}
                </div>

                <div className="mt-6 flex justify-center">
                    <Link to="/" className="flex items-center gap-1 text-xs text-gray-500 hover:text-vantage-cyan transition-colors">
                        <ChevronRight size={12} className="-scale-x-100" />
                        {language === 'fr' ? 'Accueil' : 'Home'}
                    </Link>
                </div>
            </div>
        </div>
    );
};