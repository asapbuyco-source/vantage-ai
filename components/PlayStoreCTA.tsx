import React from 'react';
import { Play, Smartphone, Star, ChevronRight } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export const PLAY_STORE_URL =
    'https://play.google.com/store/apps/details?id=com.vantageai.app&hl=en&utm_source=vantageai.online&utm_medium=web&utm_campaign=app_download';

type Variant = 'banner' | 'button' | 'inline' | 'card';

interface PlayStoreCTAProps {
    variant?: Variant;
    className?: string;
}

/**
 * Reusable Play Store acquisition link. `banner` and `card` are prominent
 * sections; `button` is a compact pill for headers; `inline` is a text link.
 */
export const PlayStoreCTA: React.FC<PlayStoreCTAProps> = ({ variant = 'banner', className = '' }) => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    if (variant === 'button') {
        return (
            <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white transition-colors ${className}`}
                aria-label={fr ? 'Télécharger l\u2019application Android' : 'Download the Android app'}
            >
                <Play size={11} fill="currentColor" />
                {fr ? 'App' : 'Get app'}
            </a>
        );
    }

    if (variant === 'inline') {
        return (
            <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 font-bold text-emerald-500 hover:text-emerald-400 underline decoration-emerald-500/40 underline-offset-2 ${className}`}
            >
                <Smartphone size={13} />
                {fr ? 'Télécharger l\u2019app Android' : 'Download the Android app'}
            </a>
        );
    }

    const isCard = variant === 'card';

    return (
        <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`group relative overflow-hidden block rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent p-4 transition-all hover:border-emerald-500/60 ${className}`}
        >
            <div className="flex items-center gap-3">
                <div className="shrink-0 w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                    <Smartphone size={22} className="text-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                        {fr ? 'Vantage AI sur Android' : 'Vantage AI on Android'}
                    </p>
                    <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-snug mt-0.5">
                        {fr
                            ? 'Pronostics plus rapides, alertes en direct et accès hors ligne.'
                            : 'Faster picks, live alerts and offline access.'}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-[9px] font-bold text-amber-400">
                        <Star size={9} fill="currentColor" />
                        <Star size={9} fill="currentColor" />
                        <Star size={9} fill="currentColor" />
                        <Star size={9} fill="currentColor" />
                        <Star size={9} fill="currentColor" />
                        <span className="ml-1 text-gray-500 dark:text-gray-400">{fr ? 'sur Google Play' : 'on Google Play'}</span>
                    </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[10px] font-black text-white group-hover:bg-emerald-600 transition-colors">
                    <Play size={10} fill="currentColor" />
                    {fr ? 'Installer' : 'Install'}
                </span>
            </div>
            {isCard && (
                <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <span>{fr ? 'Gratuit sur Google Play' : 'Free on Google Play'}</span>
                    <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
            )}
        </a>
    );
};
