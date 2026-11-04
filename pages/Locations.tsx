import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, ChevronRight } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';
import { LOCATIONS } from '../locations';

export const Locations: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr
            ? 'Paris football par ville au Cameroun | Vantage AI'
            : 'Football Betting by City in Cameroon | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                    <MapPin size={18} className="text-vantage-cyan" />
                    <h1 className="text-2xl font-black font-orbitron">
                        {fr ? 'Paris football par ville' : 'Football Betting by City'}
                    </h1>
                </div>
                <p className="text-sm text-gray-500">
                    {fr
                        ? 'Pronostics et conseils de paris adaptés à chaque ville du Cameroun — Elite One, 1xBet, Premier Bet et BetPawa.'
                        : 'Football predictions and betting tips tailored to each Cameroonian city — Elite One, 1xBet, Premier Bet and BetPawa.'}
                </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                {LOCATIONS.map(city => (
                    <Link
                        key={city.slug}
                        to={`/football-betting/${city.slug}`}
                        className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-vantage-cyan/50 transition-colors"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-black text-white">{city.name}</p>
                                <p className="text-[10px] text-gray-500">{city.region} · {city.leagues[0]}</p>
                            </div>
                            <ChevronRight size={16} className="text-gray-500 group-hover:text-vantage-cyan transition-colors" />
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2 line-clamp-2">{fr ? city.introFr : city.introEn}</p>
                    </Link>
                ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Link to="/" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">
                    {fr ? 'Pronostics du jour' : "Today's predictions"}
                </Link>
                <Link to="/blog" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">Blog</Link>
                <Link to="/tools" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    {fr ? 'Outils de paris' : 'Betting tools'}
                </Link>
                <Link to="/stats" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    {fr ? 'Bilan public' : 'Track record'}
                </Link>
            </div>

            <PlayStoreCTA variant="card" className="mt-4" />
        </PublicLayout>
    );
};
