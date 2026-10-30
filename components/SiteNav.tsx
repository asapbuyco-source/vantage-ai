import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Play, Menu, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { PLAY_STORE_URL } from './PlayStoreCTA';

const LINKS = [
    { to: '/', en: 'Home', fr: 'Accueil' },
    { to: '/blog', en: 'Blog', fr: 'Blog' },
    { to: '/tools', en: 'Tools', fr: 'Outils' },
    { to: '/learn', en: 'Learn', fr: 'Apprendre' },
    { to: '/stats', en: 'Results', fr: 'Résultats' },
    { to: '/about', en: 'About', fr: 'À propos' },
    { to: '/contact', en: 'Contact', fr: 'Contact' },
];

export const SiteNav: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';
    const location = useLocation();
    const [open, setOpen] = React.useState(false);

    return (
        <header className="sticky top-0 z-40 border-b border-white/10 bg-vantage-bg/90 backdrop-blur-md">
            <div className="max-w-3xl mx-auto px-4">
                <div className="flex items-center justify-between h-14">
                    <Link to="/" className="flex items-center gap-2 shrink-0">
                        <span className="text-lg font-black font-orbitron tracking-tight">
                            VANTAGE<span className="text-transparent bg-clip-text bg-vantage-gradient">AI</span>
                        </span>
                    </Link>

                    <nav className="hidden md:flex items-center gap-1">
                        {LINKS.map(l => {
                            const active = location.pathname === l.to;
                            return (
                                <Link
                                    key={l.to}
                                    to={l.to}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                                        active ? 'text-vantage-cyan bg-vantage-cyan/10' : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                                >
                                    {fr ? l.fr : l.en}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="flex items-center gap-2">
                        <a
                            href={PLAY_STORE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white transition-colors"
                        >
                            <Play size={10} fill="currentColor" />
                            {fr ? 'App' : 'Get app'}
                        </a>
                        <button
                            onClick={() => setOpen(v => !v)}
                            className="md:hidden p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300"
                            aria-label="Menu"
                        >
                            {open ? <X size={16} /> : <Menu size={16} />}
                        </button>
                    </div>
                </div>

                {open && (
                    <nav className="md:hidden grid grid-cols-2 gap-1 pb-3">
                        {LINKS.map(l => (
                            <Link
                                key={l.to}
                                to={l.to}
                                onClick={() => setOpen(false)}
                                className="px-3 py-2 rounded-lg text-[12px] font-bold bg-white/5 text-gray-300 hover:text-vantage-cyan"
                            >
                                {fr ? l.fr : l.en}
                            </Link>
                        ))}
                    </nav>
                )}
            </div>
        </header>
    );
};
