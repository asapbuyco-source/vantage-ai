import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calculator } from 'lucide-react';
import { ToolsHub } from '../components/ToolsHub';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

export const ToolsPage: React.FC = () => {
    const { language } = useAppContext();
    const navigate = useNavigate();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr
            ? 'Outils de paris gratuits | Vantage AI'
            : 'Free Football Betting Tools | Vantage AI';
    }, [fr]);

    return (
        <div className="min-h-screen bg-vantage-bg text-slate-900 dark:text-white pb-24">
            <div className="max-w-2xl mx-auto px-4 pt-6">
                <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-vantage-cyan transition-colors mb-4"
                >
                    <ArrowLeft size={14} />
                    {fr ? 'Retour' : 'Back'}
                </button>

                <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-vantage-cyan/10 border border-vantage-cyan/20 flex items-center justify-center">
                        <Calculator size={20} className="text-vantage-cyan" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black leading-tight">
                            {fr ? 'Outils de paris' : 'Betting Tools'}
                        </h1>
                        <p className="text-[11px] text-gray-500">
                            {fr ? 'Convertisseur de cotes, valeur, Kelly et gestion de bankroll.' : 'Odds converter, value, Kelly and bankroll management.'}
                        </p>
                    </div>
                </div>

                <ToolsHub />

                <div className="mt-4">
                    <PlayStoreCTA variant="card" />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4">
                    <p className="text-xs font-bold text-slate-900 dark:text-white mb-1">
                        {fr ? 'Prêt à utiliser ces outils ?' : 'Ready to use these tools?'}
                    </p>
                    <p className="text-[11px] text-gray-500 mb-3">
                        {fr ? 'Comparez vos calculs avec nos pronostics du jour.' : 'Compare your numbers with our daily predictions.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => navigate('/')} className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">
                            {fr ? 'Pronostics du jour' : "Today's predictions"}
                        </button>
                        <button onClick={() => navigate('/learn')} className="rounded-lg bg-slate-100 dark:bg-white/10 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-white">
                            {fr ? 'Centre d\u2019apprentissage' : 'Learning centre'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
