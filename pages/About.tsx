import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit, ShieldCheck, BarChart3, Target, Smartphone, Globe2 } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 mb-2">
            <Icon size={16} className="text-vantage-cyan" />
            <h2 className="text-sm font-black text-white">{title}</h2>
        </div>
        <div className="text-[12px] text-gray-400 leading-relaxed space-y-2">{children}</div>
    </section>
);

export const About: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';

    useEffect(() => {
        document.title = fr ? 'À propos | Vantage AI' : 'About Us | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <div className="mb-6">
                <h1 className="text-2xl font-black font-orbitron">
                    {fr ? 'À propos de Vantage AI' : 'About Vantage AI'}
                </h1>
                <p className="text-sm text-gray-500 mt-2">
                    {fr
                        ? 'Nous construisons des pronostics football transparents et data-driven pour le Cameroun.'
                        : 'We build transparent, data-driven football predictions for Cameroon.'}
                </p>
            </div>

            <div className="space-y-3">
                <Section icon={Target} title={fr ? 'Notre mission' : 'Our mission'}>
                    <p>
                        {fr
                            ? 'Rendre l’analyse sportive de niveau professionnel accessible à tous les parieurs camerounais — pas seulement à ceux qui ont un accès aux données.'
                            : 'Make professional-grade sports analysis accessible to every Cameroonian bettor — not just those with access to data.'}
                    </p>
                    <p>
                        {fr
                            ? 'Nous croyons que la transparence et la discipline battent les promesses de gains garantis.'
                            : 'We believe transparency and discipline beat promises of guaranteed wins.'}
                    </p>
                </Section>

                <Section icon={BrainCircuit} title={fr ? 'Comment nous prédisons' : 'How we predict'}>
                    <p>
                        {fr
                            ? 'Notre moteur combine les cotes du marché, la forme récente, les buts attendus (xG), les blessures et le contexte du match dans un modèle quantitatif.'
                            : 'Our engine combines market odds, recent form, expected goals (xG), injuries and match context in a quantitative model.'}
                    </p>
                    <p>
                        {fr
                            ? 'Chaque sélection est comparée à la probabilité implicite du bookmaker pour identifier la valeur attendue (EV) réelle.'
                            : 'Every selection is compared with the bookmaker’s implied probability to identify real expected value (EV).'}
                    </p>
                </Section>

                <Section icon={BarChart3} title={fr ? 'Transparence totale' : 'Full transparency'}>
                    <p>
                        {fr
                            ? 'Nous publions notre taux de réussite et notre ROI, y compris les mauvaises séries.'
                            : 'We publish our win rate and ROI — including the bad runs.'}
                    </p>
                    <Link to="/stats" className="inline-flex items-center gap-1 text-vantage-cyan font-bold">
                        {fr ? 'Voir le bilan public →' : 'See the public track record →'}
                    </Link>
                </Section>

                <Section icon={ShieldCheck} title={fr ? 'Ce que nous ne faisons pas' : 'What we do not do'}>
                    <ul className="list-disc pl-4 space-y-1">
                        <li>{fr ? 'Nous ne garantissons aucun gain.' : 'We never guarantee winnings.'}</li>
                        <li>{fr ? 'Nous ne vendons pas de « matchs sûrs ».' : 'We do not sell “fixed” or “sure” matches.'}</li>
                        <li>{fr ? 'Nous ne cachons pas nos pertes.' : 'We do not hide our losses.'}</li>
                    </ul>
                </Section>

                <Section icon={Globe2} title={fr ? 'Pensé pour le Cameroun' : 'Built for Cameroon'}>
                    <p>
                        {fr
                            ? 'Optimisé pour 1xBet, Premier Bet et BetPawa, avec un contenu en français et en anglais et un accès via Mobile Money.'
                            : 'Optimised for 1xBet, Premier Bet and BetPawa, with French and English content and Mobile Money access.'}
                    </p>
                </Section>

                <Section icon={Smartphone} title={fr ? 'L’app Android' : 'The Android app'}>
                    <p>
                        {fr
                            ? 'Retrouvez les pronostics, alertes et outils directement sur votre téléphone.'
                            : 'Get predictions, alerts and tools directly on your phone.'}
                    </p>
                </Section>

                <PlayStoreCTA variant="card" className="mt-2" />

                <div className="flex flex-wrap gap-2 pt-2">
                    <Link to="/" className="rounded-lg bg-vantage-cyan text-black px-3 py-2 text-[11px] font-black">
                        {fr ? 'Pronostics du jour' : "Today's predictions"}
                    </Link>
                    <Link to="/contact" className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                        {fr ? 'Nous contacter' : 'Contact us'}
                    </Link>
                </div>
            </div>
        </PublicLayout>
    );
};
