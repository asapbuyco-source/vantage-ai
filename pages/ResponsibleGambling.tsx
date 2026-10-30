import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Clock, Ban, HeartHandshake, Phone } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { useAppContext } from '../context/AppContext';

export const ResponsibleGambling: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr ? 'Jeu responsable | Vantage AI' : 'Responsible Gambling | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 mb-6 flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                    <h1 className="text-lg font-black text-white">{fr ? 'Jeu responsable — 18+' : 'Responsible Gambling — 18+'}</h1>
                    <p className="text-[12px] text-gray-300 mt-1">
                        {fr
                            ? 'Les paris sportifs sont une forme de divertissement, pas une source de revenus garantie.'
                            : 'Sports betting is a form of entertainment, not a guaranteed source of income.'}
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-2"><ShieldCheck size={16} className="text-vantage-cyan" /><h2 className="text-sm font-black text-white">{fr ? 'Nos principes' : 'Our principles'}</h2></div>
                    <ul className="list-disc pl-4 text-[12px] text-gray-400 space-y-1">
                        <li>{fr ? 'Ne misez que ce que vous pouvez perdre.' : 'Only stake what you can afford to lose.'}</li>
                        <li>{fr ? 'Fixez des limites de temps et d’argent avant de parier.' : 'Set time and money limits before betting.'}</li>
                        <li>{fr ? 'Ne cherchez jamais à récupérer une perte.' : 'Never chase losses.'}</li>
                        <li>{fr ? 'Faites des pauses régulières.' : 'Take regular breaks.'}</li>
                    </ul>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-2"><Clock size={16} className="text-amber-400" /><h2 className="text-sm font-black text-white">{fr ? 'Signes d’alerte' : 'Warning signs'}</h2></div>
                    <ul className="list-disc pl-4 text-[12px] text-gray-400 space-y-1">
                        <li>{fr ? 'Parier plus que prévu ou emprunter pour parier.' : 'Betting more than planned or borrowing to bet.'}</li>
                        <li>{fr ? 'Mentir sur vos paris.' : 'Lying about your betting.'}</li>
                        <li>{fr ? 'Parier pour échapper au stress ou à l’ennui.' : 'Betting to escape stress or boredom.'}</li>
                        <li>{fr ? 'Perturbation du sommeil, du travail ou des relations.' : 'Disruption to sleep, work or relationships.'}</li>
                    </ul>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-2"><Ban size={16} className="text-rose-400" /><h2 className="text-sm font-black text-white">{fr ? 'Outils de contrôle' : 'Control tools'}</h2></div>
                    <ul className="list-disc pl-4 text-[12px] text-gray-400 space-y-1">
                        <li>{fr ? 'Utilisez les limites de dépôt de votre bookmaker.' : 'Use your bookmaker’s deposit limits.'}</li>
                        <li>{fr ? 'Activez l’auto-exclusion si nécessaire.' : 'Enable self-exclusion if needed.'}</li>
                        <li>{fr ? 'Supprimez les applications de paris pendant une pause.' : 'Remove betting apps during a break.'}</li>
                    </ul>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-2"><Phone size={16} className="text-emerald-400" /><h2 className="text-sm font-black text-white">{fr ? 'Besoin d’aide ?' : 'Need help?'}</h2></div>
                    <p className="text-[12px] text-gray-400">
                        {fr
                            ? 'Parlez à un proche de confiance ou à un professionnel de santé. Si le jeu affecte votre vie, cherchez un soutien local.'
                            : 'Talk to a trusted person or a health professional. If gambling is affecting your life, seek local support.'}
                    </p>
                    <p className="text-[12px] text-gray-400 mt-2">
                        {fr ? 'Contactez-nous à ' : 'Contact us at '}
                        <a href="mailto:support@vantageai.online" className="text-vantage-cyan">support@vantageai.online</a>
                        {fr ? ' pour être orienté.' : ' for guidance.'}
                    </p>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-2"><HeartHandshake size={16} className="text-vantage-cyan" /><h2 className="text-sm font-black text-white">{fr ? 'Notre engagement' : 'Our commitment'}</h2></div>
                    <p className="text-[12px] text-gray-400">
                        {fr
                            ? 'Nous ne promettons pas de gains garantis et nous publions nos pertes. La transparence fait partie du jeu responsable.'
                            : 'We do not promise guaranteed wins and we publish our losses. Transparency is part of responsible gambling.'}
                    </p>
                </section>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Link to="/stats" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">{fr ? 'Bilan transparent' : 'Transparent record'}</Link>
                <Link to="/contact" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">{fr ? 'Contact' : 'Contact'}</Link>
            </div>
        </PublicLayout>
    );
};
