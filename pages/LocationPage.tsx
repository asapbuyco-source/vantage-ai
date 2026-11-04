import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, ChevronRight, Trophy, Lightbulb } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';
import { getLocation } from '../locations';

export const LocationPage: React.FC = () => {
    const { city } = useParams<{ city: string }>();
    const { language } = useAppContext();
    const fr = language === 'fr';
    const loc = getLocation(city || '');

    useEffect(() => {
        if (!loc) return;
        document.title = fr
            ? `${loc.name} : pronostics football & conseils de paris | Vantage AI`
            : `${loc.name} Football Predictions & Betting Tips | Vantage AI`;
        const desc = document.querySelector('meta[name="description"]');
        if (desc) {
            desc.setAttribute('content', fr
                ? `Pronostics football et conseils de paris pour ${loc.name}, ${loc.region} (Cameroun) : Elite One, 1xBet, Premier Bet et BetPawa.`
                : `Football predictions and betting tips for ${loc.name}, ${loc.region} (Cameroon): Elite One, 1xBet, Premier Bet and BetPawa.`);
        }
    }, [loc, fr]);

    if (!loc) {
        return (
            <PublicLayout>
                <div className="text-center py-16">
                    <h1 className="text-xl font-black text-white">{fr ? 'Ville introuvable' : 'City not found'}</h1>
                    <Link to="/football-betting" className="mt-4 inline-block text-vantage-cyan font-bold">
                        {fr ? 'Voir toutes les villes →' : 'View all cities →'}
                    </Link>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <nav className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-4">
                <Link to="/" className="hover:text-vantage-cyan">{fr ? 'Accueil' : 'Home'}</Link>
                <ChevronRight size={11} />
                <Link to="/football-betting" className="hover:text-vantage-cyan">{fr ? 'Par ville' : 'By city'}</Link>
                <ChevronRight size={11} />
                <span className="text-gray-300">{loc.name}</span>
            </nav>

            <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                    <MapPin size={18} className="text-vantage-cyan" />
                    <h1 className="text-2xl font-black font-orbitron">
                        {fr ? `${loc.name} : pronostics football` : `${loc.name} Football Predictions`}
                    </h1>
                </div>
                <p className="text-[11px] text-gray-500">{loc.region}, Cameroon</p>
                <p className="text-sm text-gray-400 mt-3 leading-relaxed">{fr ? loc.introFr : loc.introEn}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                    <Trophy size={15} className="text-vantage-cyan" />
                    <h2 className="text-sm font-black text-white">{fr ? 'Clubs & ligues' : 'Clubs & leagues'}</h2>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {[...loc.clubs, ...loc.leagues].map(x => (
                        <span key={x} className="text-[10px] font-bold bg-white/5 text-gray-300 px-2 py-1 rounded-full">{x}</span>
                    ))}
                </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                    <Lightbulb size={15} className="text-amber-400" />
                    <h2 className="text-sm font-black text-white">{fr ? 'Conseils de paris locaux' : 'Local betting tips'}</h2>
                </div>
                <ul className="space-y-1.5">
                    {(fr ? loc.tipsFr : loc.tipsEn).map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] text-gray-400">
                            <span className="text-vantage-cyan mt-0.5">•</span>
                            {t}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
                <h2 className="text-sm font-black text-white mb-1">{fr ? 'Bookmakers populaires' : 'Popular bookmakers'}</h2>
                <p className="text-[12px] text-gray-400 leading-relaxed">
                    {fr
                        ? 'Les parieurs de ' + loc.name + ' utilisent principalement 1xBet, Premier Bet, BetPawa, PMUC et Supergoal. Comparez toujours les cotes avant de miser.'
                        : 'Bettors in ' + loc.name + ' mainly use 1xBet, Premier Bet, BetPawa, PMUC and Supergoal. Always compare odds before staking.'}
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <Link to="/" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">
                    {fr ? 'Pronostics du jour' : "Today's predictions"}
                </Link>
                <Link to="/blog" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">Blog</Link>
                <Link to="/tools" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    {fr ? 'Outils' : 'Tools'}
                </Link>
                <Link to="/stats" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    {fr ? 'Bilan' : 'Track record'}
                </Link>
            </div>

            <PlayStoreCTA variant="card" className="mt-4" />
        </PublicLayout>
    );
};
