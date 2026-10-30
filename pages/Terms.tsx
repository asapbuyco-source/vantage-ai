import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/PublicLayout';
import { useAppContext } from '../context/AppContext';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-sm font-black text-white mb-1.5">{title}</h2>
        <div className="text-[12px] text-gray-400 leading-relaxed space-y-2">{children}</div>
    </section>
);

export const Terms: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';
    const updated = '30 October 2026';

    useEffect(() => {
        document.title = fr ? 'Conditions d’utilisation | Vantage AI' : 'Terms of Service | Vantage AI';
    }, [fr]);

    return (
        <PublicLayout>
            <h1 className="text-2xl font-black font-orbitron">{fr ? 'Conditions d’utilisation' : 'Terms of Service'}</h1>
            <p className="text-[11px] text-gray-500 mt-1 mb-6">{fr ? 'Dernière mise à jour :' : 'Last updated:'} {updated}</p>

            <div className="space-y-3">
                <Section title={fr ? '1. Acceptation' : '1. Acceptance'}>
                    <p>
                        {fr
                            ? 'En utilisant Vantage AI, vous acceptez ces conditions. Si vous n’êtes pas d’accord, n’utilisez pas le service.'
                            : 'By using Vantage AI you agree to these terms. If you do not agree, do not use the service.'}
                    </p>
                </Section>
                <Section title={fr ? '2. Le service' : '2. The service'}>
                    <p>
                        {fr
                            ? 'Vantage AI fournit des analyses et pronostics sportifs à titre informatif. Le service peut évoluer, être suspendu ou interrompu.'
                            : 'Vantage AI provides sports analysis and predictions for information purposes. The service may change, be suspended or discontinued.'}
                    </p>
                </Section>
                <Section title={fr ? '3. Aucune garantie de gain' : '3. No guarantee of winnings'}>
                    <p>
                        {fr
                            ? 'Les pronostics ne garantissent aucun résultat. Les paris comportent un risque de perte. Vous êtes seul responsable de vos décisions.'
                            : 'Predictions do not guarantee any outcome. Betting carries a risk of loss. You are solely responsible for your decisions.'}
                    </p>
                </Section>
                <Section title={fr ? '4. 18+ et jeu responsable' : '4. 18+ and responsible gambling'}>
                    <p>
                        {fr
                            ? 'Le service est réservé aux personnes de 18 ans et plus. Ne misez que ce que vous pouvez vous permettre de perdre.'
                            : 'The service is for people aged 18 and over. Only stake what you can afford to lose.'}
                    </p>
                    <Link to="/responsible-gambling" className="inline-block text-vantage-cyan font-bold">
                        {fr ? 'Lire les conseils de jeu responsable →' : 'Read responsible gambling guidance →'}
                    </Link>
                </Section>
                <Section title={fr ? '5. Propriété intellectuelle' : '5. Intellectual property'}>
                    <p>
                        {fr
                            ? 'Le contenu, les modèles et les marques de Vantage AI sont protégés. Toute reproduction non autorisée est interdite.'
                            : 'Vantage AI content, models and branding are protected. Unauthorised reproduction is prohibited.'}
                    </p>
                </Section>
                <Section title={fr ? '6. Limitation de responsabilité' : '6. Limitation of liability'}>
                    <p>
                        {fr
                            ? 'Dans la mesure permise par la loi, Vantage AI n’est pas responsable des pertes financières liées à l’utilisation du service.'
                            : 'To the extent permitted by law, Vantage AI is not liable for financial losses arising from use of the service.'}
                    </p>
                </Section>
                <Section title={fr ? '7. Contact' : '7. Contact'}>
                    <p>
                        {fr ? 'Questions : ' : 'Questions: '}
                        <a href="mailto:support@vantageai.online" className="text-vantage-cyan">support@vantageai.online</a>
                    </p>
                </Section>
            </div>
        </PublicLayout>
    );
};
