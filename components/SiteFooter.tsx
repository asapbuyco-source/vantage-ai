import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Mail, Send } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { PLAY_STORE_URL } from './PlayStoreCTA';

const GROUPS = [
    {
        titleEn: 'Explore',
        titleFr: 'Explorer',
        links: [
            { to: '/', en: 'Home', fr: 'Accueil' },
            { to: '/blog', en: 'Blog', fr: 'Blog' },
            { to: '/tools', en: 'Betting Tools', fr: 'Outils de paris' },
            { to: '/football-betting', en: 'Betting by City', fr: 'Paris par ville' },
            { to: '/learn', en: 'Learning Centre', fr: 'Centre d\u2019apprentissage' },
            { to: '/stats', en: 'Results', fr: 'Résultats' },
        ],
    },
    {
        titleEn: 'Company',
        titleFr: 'Entreprise',
        links: [
            { to: '/about', en: 'About Us', fr: 'À propos' },
            { to: '/contact', en: 'Contact Us', fr: 'Contact' },
            { to: '/download', en: 'Android App', fr: 'App Android' },
            { to: '/how-it-works', en: 'How It Works', fr: 'Comment ça marche' },
            { to: '/faq', en: 'FAQ', fr: 'FAQ' },
        ],
    },
    {
        titleEn: 'Legal',
        titleFr: 'Légal',
        links: [
            { to: '/terms', en: 'Terms of Service', fr: 'Conditions d\u2019utilisation' },
            { to: '/privacy-policy', en: 'Privacy Policy', fr: 'Confidentialité' },
            { to: '/responsible-gambling', en: 'Responsible Gambling', fr: 'Jeu responsable' },
        ],
    },
];

export const SiteFooter: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    return (
        <footer className="border-t border-white/10 bg-black/20 mt-12">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                    <div className="col-span-2 sm:col-span-1">
                        <Link to="/" className="text-lg font-black font-orbitron">
                            VANTAGE<span className="text-transparent bg-clip-text bg-vantage-gradient">AI</span>
                        </Link>
                        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                            {fr
                                ? 'Pronostics football data-driven pour le Cameroun. Analyse, valeur et suivi transparent.'
                                : 'Data-driven football predictions for Cameroon. Analysis, value and a transparent track record.'}
                        </p>
                        <a
                            href={PLAY_STORE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white transition-colors"
                        >
                            <Play size={10} fill="currentColor" />
                            {fr ? 'Télécharger sur Play Store' : 'Get it on Google Play'}
                        </a>
                    </div>

                    {GROUPS.map(g => (
                        <div key={g.titleEn}>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                {fr ? g.titleFr : g.titleEn}
                            </h4>
                            <ul className="space-y-1.5">
                                {g.links.map(l => (
                                    <li key={l.to}>
                                        <Link to={l.to} className="text-[11px] text-gray-500 hover:text-vantage-cyan transition-colors">
                                            {fr ? l.fr : l.en}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-8 pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-[10px] text-gray-600">
                        © {new Date().getFullYear()} Vantage AI. {fr ? 'Tous droits réservés.' : 'All rights reserved.'}
                    </p>
                    <div className="flex items-center gap-3 text-gray-500">
                        <a href="mailto:support@vantageai.online" className="hover:text-vantage-cyan transition-colors" aria-label="Email">
                            <Mail size={14} />
                        </a>
                        <a href="https://t.me/vantageai" target="_blank" rel="noopener noreferrer" className="hover:text-vantage-cyan transition-colors" aria-label="Telegram">
                            <Send size={14} />
                        </a>
                    </div>
                </div>
                <p className="text-[10px] text-gray-600 mt-3 leading-relaxed">
                    {fr
                        ? '18+. Les pronostics ne garantissent aucun gain. Jouez de manière responsable et ne misez que ce que vous pouvez perdre.'
                        : '18+. Predictions never guarantee winnings. Bet responsibly and only stake what you can afford to lose.'}
                </p>
            </div>
        </footer>
    );
};
