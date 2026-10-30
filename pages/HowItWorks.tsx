import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Database, BrainCircuit, TrendingUp, ListChecks, BarChart3, ShieldCheck } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const STEPS = [
    { icon: Database, en: '1. Data collection', fr: '1. Collecte des données', descEn: 'Fixtures, odds, form, expected goals, injuries and lineups from multiple sources.', descFr: 'Matchs, cotes, forme, xG, blessures et compositions depuis plusieurs sources.' },
    { icon: BrainCircuit, en: '2. Quantitative model', fr: '2. Modèle quantitatif', descEn: 'A Poisson/Elo-style model estimates the probability of every market for each match.', descFr: 'Un modèle de type Poisson/Elo estime la probabilité de chaque marché.' },
    { icon: TrendingUp, en: '3. Value detection', fr: '3. Détection de valeur', descEn: 'Model probability is compared with the bookmaker’s implied probability to find +EV picks.', descFr: 'La probabilité du modèle est comparée à celle du bookmaker pour trouver +EV.' },
    { icon: ListChecks, en: '4. Pick selection', fr: '4. Sélection', descEn: 'We keep the strongest value picks, ranked by expected value and confidence.', descFr: 'Nous gardons les meilleures sélections, classées par EV et confiance.' },
    { icon: BarChart3, en: '5. Grading', fr: '5. Notation', descEn: 'Every pick is graded against official results to build a transparent track record.', descFr: 'Chaque pronostic est noté selon les résultats officiels pour un bilan transparent.' },
    { icon: ShieldCheck, en: '6. Discipline', fr: '6. Discipline', descEn: 'No guarantees, no chasing. Stake flat and treat betting as entertainment.', descFr: 'Pas de garantie, pas de course aux pertes. Misez à plat et restez dans le divertissement.' },
];

export const HowItWorks: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr ? 'Comment ça marche | Vantage AI' : 'How It Works | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="mb-6">
                <h1 className="text-2xl font-black font-orbitron">{fr ? 'Comment ça marche' : 'How It Works'}</h1>
                <p className="text-sm text-gray-500 mt-2">
                    {fr
                        ? 'De la donnée brute à un pronostic noté — notre pipeline expliqué simplement.'
                        : 'From raw data to a graded pick — our pipeline explained simply.'}
                </p>
            </div>

            <div className="space-y-3">
                {STEPS.map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.en} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="w-9 h-9 rounded-xl bg-vantage-cyan/10 border border-vantage-cyan/20 flex items-center justify-center shrink-0">
                                <Icon size={16} className="text-vantage-cyan" />
                            </div>
                            <div>
                                <h2 className="text-sm font-black text-white">{fr ? s.fr : s.en}</h2>
                                <p className="text-[12px] text-gray-400 mt-0.5 leading-relaxed">{fr ? s.descFr : s.descEn}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <p className="text-[12px] text-gray-300">
                    {fr
                        ? 'Nous ne promettons pas de gains garantis. Notre objectif est la valeur attendue positive et la transparence sur le long terme.'
                        : 'We do not promise guaranteed wins. Our goal is positive expected value and long-term transparency.'}
                </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Link to="/" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">{fr ? 'Voir les pronostics' : 'See predictions'}</Link>
                <Link to="/stats" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">{fr ? 'Bilan public' : 'Public record'}</Link>
                <Link to="/faq" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">FAQ</Link>
            </div>

            <PlayStoreCTA variant="card" className="mt-4" />
        </PublicLayout>
    );
};
