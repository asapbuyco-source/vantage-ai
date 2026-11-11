import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const FAQS = [
    {
        qEn: 'What is Vantage AI?',
        qFr: 'Qu’est-ce que Vantage AI ?',
        aEn: 'Vantage AI is a data-driven football prediction platform for Cameroon. We combine market odds, form, expected goals, injuries and match context to find value bets, and we publish our results openly.',
        aFr: 'Vantage AI est une plateforme de pronostics football data-driven pour le Cameroun. Nous combinons cotes, forme, xG, blessures et contexte pour trouver de la valeur, et nous publions nos résultats.',
    },
    {
        qEn: 'Are the predictions free?',
        qFr: 'Les pronostics sont-ils gratuits ?',
        aEn: 'Yes — free picks are available every day, plus a public track record. VIP unlocks every pick and the exact stakes.',
        aFr: 'Oui — des pronostics gratuits sont disponibles chaque jour, avec un bilan public. Le VIP débloque tous les pronostics et les mises exactes.',
    },
    {
        qEn: 'Do you guarantee wins?',
        qFr: 'Garantissez-vous des gains ?',
        aEn: 'No. Nobody can guarantee betting profits. We focus on positive expected value and long-term discipline, and we show the losing runs too.',
        aFr: 'Non. Personne ne peut garantir des profits. Nous visons la valeur attendue positive et la discipline long terme, et nous montrons aussi les pertes.',
    },
    {
        qEn: 'Which bookmakers are supported?',
        qFr: 'Quels bookmakers sont pris en charge ?',
        aEn: 'The picks work with any bookmaker, and we optimise content for 1xBet, Premier Bet and BetPawa in Cameroon.',
        aFr: 'Les pronostics fonctionnent avec n’importe quel bookmaker, et nous optimisons pour 1xBet, Premier Bet et BetPawa au Cameroun.',
    },
    {
        qEn: 'How is the track record calculated?',
        qFr: 'Comment le bilan est-il calculé ?',
        aEn: 'Every pick is graded against official results, and we compute win rate and ROI by market. You can see it on the Results page.',
        aFr: 'Chaque pronostic est noté selon les résultats officiels, et nous calculons taux de réussite et ROI par marché. Voir la page Résultats.',
    },
    {
        qEn: 'How do I download the app?',
        qFr: 'Comment télécharger l’app ?',
        aEn: 'The app is free on Google Play. Search “Vantage AI” or use the download button on this site.',
        aFr: 'L’app est gratuite sur Google Play. Cherchez « Vantage AI » ou utilisez le bouton de téléchargement.',
    },
    {
        qEn: 'How do I contact support?',
        qFr: 'Comment contacter le support ?',
        aEn: 'Use the Contact page or email asapbuyco@gmail.com. We reply within 24–48 hours.',
        aFr: 'Utilisez la page Contact ou écrivez à asapbuyco@gmail.com. Réponse sous 24–48h.',
    },
];

export const Faq: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr ? 'FAQ | Vantage AI' : 'FAQ | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="mb-6">
                <h1 className="text-2xl font-black font-orbitron flex items-center gap-2">
                    <HelpCircle size={20} className="text-vantage-cyan" />
                    {fr ? 'Questions fréquentes' : 'Frequently Asked Questions'}
                </h1>
                <p className="text-sm text-gray-500 mt-2">
                    {fr ? 'Tout ce qu’il faut savoir sur Vantage AI.' : 'Everything you need to know about Vantage AI.'}
                </p>
            </div>

            <div className="space-y-2">
                {FAQS.map((item, i) => (
                    <details key={i} className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-bold text-white">
                            {fr ? item.qFr : item.qEn}
                            <span className="text-gray-500 group-open:rotate-180 transition-transform">▾</span>
                        </summary>
                        <p className="px-4 pb-4 text-[12px] text-gray-400 leading-relaxed">{fr ? item.aFr : item.aEn}</p>
                    </details>
                ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Link to="/contact" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">
                    {fr ? 'Nous contacter' : 'Contact us'}
                </Link>
                <Link to="/how-it-works" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    {fr ? 'Comment ça marche' : 'How it works'}
                </Link>
            </div>

            <PlayStoreCTA variant="card" className="mt-4" />
        </PublicLayout>
    );
};
