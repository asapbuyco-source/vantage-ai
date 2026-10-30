import React, { useEffect } from 'react';
import { Play, Smartphone, Zap, ShieldCheck, BarChart3, Calculator, Bell, WifiOff, Star, CheckCircle2 } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PLAY_STORE_URL } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const FEATURES = [
    { icon: Zap, en: 'Daily AI football predictions', fr: 'Pronostics football IA quotidiens', descEn: 'Data-driven picks with odds, confidence and expected value.', descFr: 'Sélections data-driven avec cotes, confiance et valeur attendue.' },
    { icon: BarChart3, en: 'Live scores + prediction badges', fr: 'Scores en direct + badges pronostics', descEn: 'Follow matches live and see which have a Vantage pick.', descFr: 'Suivez les matchs en direct et voyez ceux avec un pronostic.' },
    { icon: Calculator, en: 'Free betting tools', fr: 'Outils de paris gratuits', descEn: 'Odds converter, EV, Kelly, dutching and bankroll tools.', descFr: 'Convertisseur de cotes, EV, Kelly, répartition et bankroll.' },
    { icon: ShieldCheck, en: 'Transparent track record', fr: 'Bilan transparent', descEn: 'Win rate and ROI published, including the bad runs.', descFr: 'Taux de réussite et ROI publiés, y compris les mauvaises séries.' },
    { icon: Bell, en: 'Push alerts', fr: 'Alertes push', descEn: 'Get notified when the daily picks are ready.', descFr: 'Soyez notifié quand les pronostics du jour sont prêts.' },
    { icon: WifiOff, en: 'Fast and lightweight', fr: 'Rapide et léger', descEn: 'Built to work on Cameroonian mobile networks.', descFr: 'Conçu pour les réseaux mobiles camerounais.' },
];

export const Download: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr ? 'Télécharger l’app Android | Vantage AI' : 'Download the Vantage AI Android App';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-5 mb-6">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-center shrink-0">
                        <img src="/icons/icon-192.png" alt="Vantage AI" className="w-12 h-12 rounded-xl" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xl font-black font-orbitron leading-tight">Vantage AI</h1>
                        <p className="text-[11px] text-gray-400">{fr ? 'Pronostics football & outils de paris' : 'Football predictions & betting tools'}</p>
                        <div className="flex items-center gap-1 mt-1 text-amber-400">
                            {[0, 1, 2, 3, 4].map(i => <Star key={i} size={10} fill="currentColor" />)}
                            <span className="ml-1 text-[9px] text-gray-500">{fr ? 'sur Google Play' : 'on Google Play'}</span>
                        </div>
                    </div>
                </div>
                <a
                    href={PLAY_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 py-3 text-sm font-black text-white transition-colors"
                >
                    <Play size={16} fill="currentColor" />
                    {fr ? 'Installer gratuitement' : 'Install for free'}
                </a>
                <p className="text-center text-[10px] text-gray-500 mt-2">
                    {fr ? 'Gratuit · Android · Google Play' : 'Free · Android · Google Play'}
                </p>
            </div>

            <h2 className="text-sm font-black text-white mb-3">{fr ? 'Ce que vous obtenez' : 'What you get'}</h2>
            <div className="grid sm:grid-cols-2 gap-3 mb-6">
                {FEATURES.map(f => {
                    const Icon = f.icon;
                    return (
                        <div key={f.en} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                            <Icon size={16} className="text-vantage-cyan mb-1.5" />
                            <p className="text-xs font-black text-white">{fr ? f.fr : f.en}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{fr ? f.descFr : f.descEn}</p>
                        </div>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
                <h2 className="text-sm font-black text-white mb-2">{fr ? 'Comment installer' : 'How to install'}</h2>
                <ol className="space-y-2">
                    {[
                        fr ? 'Ouvrez Google Play sur votre téléphone Android.' : 'Open Google Play on your Android phone.',
                        fr ? 'Recherchez « Vantage AI » ou utilisez le bouton ci-dessus.' : 'Search for “Vantage AI” or use the button above.',
                        fr ? 'Appuyez sur Installer et attendez la fin du téléchargement.' : 'Tap Install and wait for the download to finish.',
                        fr ? 'Ouvrez l’app et activez les notifications.' : 'Open the app and enable notifications.',
                    ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
                            <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                            {step}
                        </li>
                    ))}
                </ol>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 mb-1">
                    <Smartphone size={15} className="text-vantage-cyan" />
                    <p className="text-xs font-black text-white">{fr ? 'Besoin d’aide ?' : 'Need help?'}</p>
                </div>
                <p className="text-[11px] text-gray-500">
                    {fr
                        ? 'Si l’installation échoue, vérifiez votre connexion et l’espace disponible. Contactez-nous si le problème persiste.'
                        : 'If installation fails, check your connection and free storage. Contact us if the issue persists.'}
                </p>
            </div>
        </PublicLayout>
    );
};
