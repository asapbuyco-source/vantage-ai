export interface CityLocation {
    slug: string;
    name: string;
    region: string;
    clubs: string[];
    leagues: string[];
    introEn: string;
    introFr: string;
    tipsEn: string[];
    tipsFr: string[];
}

export const LOCATIONS: CityLocation[] = [
    {
        slug: 'douala',
        name: 'Douala',
        region: 'Littoral',
        clubs: ['Astres de Douala', 'Union de Douala', 'New Star de Douala'],
        leagues: ['Elite One', 'Elite Two', 'Littoral regional league'],
        introEn: 'Douala is Cameroon\'s economic capital and its busiest betting market. With a huge football fan base, strong 1xBet, Premier Bet and BetPawa coverage, and local Elite One clubs, the city offers some of the deepest football betting liquidity in the country.',
        introFr: 'Douala est la capitale économique du Cameroun et son marché de paris le plus actif. Avec une immense communauté de fans de football, une forte couverture 1xBet, Premier Bet et BetPawa, et des clubs locaux d\'Elite One, la ville offre l\'une des liquidités de paris les plus profondes du pays.',
        tipsEn: ['Compare 1xBet, Premier Bet and BetPawa prices before betting on Elite One derbies.', 'Local derbies are often tight and low-scoring — Under 2.5 and Double Chance can be safer.', 'Use mobile money limits and keep stakes flat across the weekend coupon.'],
        tipsFr: ['Comparez les cotes 1xBet, Premier Bet et BetPawa avant les derbies d\'Elite One.', 'Les derbies locaux sont souvent serrés — Under 2.5 et Double Chance sont plus sûrs.', 'Utilisez les limites Mobile Money et gardez des mises régulières.'],
    },
    {
        slug: 'yaounde',
        name: 'Yaoundé',
        region: 'Centre',
        clubs: ['Canon de Yaoundé', 'Tonnerre de Yaoundé', 'Fortuna de Mfou'],
        leagues: ['Elite One', 'Elite Two', 'Centre regional league'],
        introEn: 'Yaoundé is the political capital and a hotbed of Cameroonian football. Canon and Tonnerre carry decades of history, and the city\'s fans follow both Elite One and the big European leagues closely. Home advantage is strong in local fixtures.',
        introFr: 'Yaoundé est la capitale politique et un foyer du football camerounais. Canon et Tonnerre portent des décennies d\'histoire, et les fans suivent l\'Elite One comme les grands championnats européens. L\'avantage du terrain est fort lors des matchs locaux.',
        tipsEn: ['Back home sides on Asian handicap +0.5 when travel and crowd support favour them.', 'Check team news — squad depth is thinner than in Europe, so one absence matters.', 'Track the public record before following any local-league tip.'],
        tipsFr: ['Jouez les équipes à domicile sur Asian handicap +0.5 quand le public les favorise.', 'Vérifiez les compositions — la profondeur d\'effectif est plus faible qu\'en Europe.', 'Consultez le bilan public avant de suivre un pronostic local.'],
    },
    {
        slug: 'bafoussam',
        name: 'Bafoussam',
        region: 'West',
        clubs: ['Aigle Royal de la Menoua', 'Racing de Bafoussam', 'Panathinaikos de Bafoussam'],
        leagues: ['Elite One', 'Elite Two', 'West regional league'],
        introEn: 'Bafoussam is the heart of Cameroon\'s Western football region. Passionate crowds, competitive local clubs and a strong betting culture make it a key market for Elite One and Elite Two predictions.',
        introFr: 'Bafoussam est le cœur de la région footballistique de l\'Ouest. Des publics passionnés, des clubs locaux compétitifs et une forte culture du pari en font un marché clé pour l\'Elite One et l\'Elite Two.',
        tipsEn: ['West-region derbies are physical and often low-scoring.', 'Double Chance is useful when the home side is strong but the win price is short.', 'Avoid chasing big accumulators on local matches with thin data.'],
        tipsFr: ['Les derbies de l\'Ouest sont physiques et souvent pauvres en buts.', 'La Double Chance est utile quand l\'équipe locale est forte mais la cote courte.', 'Évitez les gros combinés sur des matchs locaux avec peu de données.'],
    },
    {
        slug: 'bamenda',
        name: 'Bamenda',
        region: 'North West',
        clubs: ['PWD Bamenda', 'Young Sport Academy', 'Bamenda United'],
        leagues: ['Elite One', 'Elite Two', 'North West regional league'],
        introEn: 'Bamenda is the football capital of the North West and home to PWD, one of Cameroon\'s best-supported clubs. English-speaking fans follow both Elite One and the Premier League, making it a bilingual betting market.',
        introFr: 'Bamenda est la capitale footballistique du Nord-Ouest et abrite PWD, l\'un des clubs les plus soutenus du Cameroun. Les fans anglophones suivent l\'Elite One et la Premier League, ce qui en fait un marché bilingue.',
        tipsEn: ['PWD home games draw big crowds — home advantage is real.', 'Use English-language analysis and compare odds across 1xBet and BetPawa.', 'For Premier League picks, check kickoff times and rotation risk.'],
        tipsFr: ['Les matchs de PWD à domicile attirent du monde — l\'avantage du terrain est réel.', 'Utilisez les analyses en anglais et comparez les cotes 1xBet et BetPawa.', 'Pour la Premier League, vérifiez les heures et la rotation.'],
    },
    {
        slug: 'garoua',
        name: 'Garoua',
        region: 'North',
        clubs: ['Coton Sport de Garoua', 'Roumdé Adjia'],
        leagues: ['Elite One', 'CAF Champions League', 'North regional league'],
        introEn: 'Garoua is home to Coton Sport, Cameroon\'s most successful club and a regular in the CAF Champions League. The city\'s football identity is built on continental nights and a fierce home record.',
        introFr: 'Garoua abrite Coton Sport, le club le plus titré du Cameroun et habitué de la Ligue des Champions CAF. L\'identité footballistique de la ville repose sur les soirées continentales et un fort record à domicile.',
        tipsEn: ['Coton Sport at home in CAF ties is historically strong — consider Asian handicap.', 'Continental matches can be cautious; goals markets need careful pricing.', 'Check travel and fixture congestion before backing the away side.'],
        tipsFr: ['Coton Sport à domicile en CAF est historiquement fort — pensez à l\'Asian handicap.', 'Les matchs continentaux sont prudents ; les marchés de buts exigent de la prudence.', 'Vérifiez les déplacements et la congestion avant de jouer l\'extérieur.'],
    },
    {
        slug: 'maroua',
        name: 'Maroua',
        region: 'Far North',
        clubs: ['Sahel de Maroua', 'Cotonsport reserves'],
        leagues: ['Elite One', 'Elite Two', 'Far North regional league'],
        introEn: 'Maroua represents the Far North in Cameroon\'s top flight. Long travel distances give home teams a real edge, and the local betting scene is growing fast around Elite One fixtures.',
        introFr: 'Maroua représente l\'Extrême-Nord en première division. Les longs déplacements donnent un vrai avantage aux équipes locales, et la scène des paris grandit autour de l\'Elite One.',
        tipsEn: ['Travel fatigue is a real factor — home sides often outperform expectations.', 'Low-scoring games are common; Under 2.5 is a useful starting point.', 'Stake smaller on thin-data leagues and keep records.'],
        tipsFr: ['La fatigue des déplacements compte — les équipes locales surprennent souvent.', 'Les matchs pauvres en buts sont fréquents ; Under 2.5 est un bon point de départ.', 'Misez plus petit sur les ligues peu documentées et tenez des registres.'],
    },
    {
        slug: 'buea',
        name: 'Buea',
        region: 'South West',
        clubs: ['Mount Cameroon FC', 'Buea United', 'Cinyodev FC'],
        leagues: ['Elite Two', 'South West regional league', 'Premier League'],
        introEn: 'Buea sits at the foot of Mount Cameroon and has a young, English-speaking football audience. Fans follow local South West football alongside the Premier League and Champions League.',
        introFr: 'Buea se trouve au pied du Mont Cameroun et possède un jeune public anglophone. Les fans suivent le football local du Sud-Ouest ainsi que la Premier League et la Ligue des Champions.',
        tipsEn: ['English-language content and odds comparison are especially useful here.', 'For UCL nights, check rotation and group-stage motivation.', 'Use the free betting tools to price accumulators correctly.'],
        tipsFr: ['Le contenu anglophone et la comparaison de cotes sont particulièrement utiles.', 'Pour la Ligue des Champions, vérifiez la rotation et la motivation.', 'Utilisez les outils gratuits pour bien calculer les combinés.'],
    },
    {
        slug: 'limbe',
        name: 'Limbe',
        region: 'South West',
        clubs: ['Limbe United', 'Cinyodev FC'],
        leagues: ['Elite Two', 'South West regional league'],
        introEn: 'Limbe is a coastal football town with a growing betting community. Local derbies and South West league fixtures offer niche markets that big-picture bettors often overlook.',
        introFr: 'Limbe est une ville côtière avec une communauté de parieurs croissante. Les derbies locaux et les matchs du Sud-Ouest offrent des marchés de niche souvent ignorés.',
        tipsEn: ['Niche leagues can be inefficiently priced — small stakes, big discipline.', 'Derbies are unpredictable; prefer Double Chance over outright winners.', 'Track your results to find which local markets actually pay.'],
        tipsFr: ['Les ligues de niche peuvent être mal évaluées — petites mises, grande discipline.', 'Les derbies sont imprévisibles ; préférez la Double Chance.', 'Suivez vos résultats pour trouver les marchés locaux rentables.'],
    },
    {
        slug: 'kribi',
        name: 'Kribi',
        region: 'South',
        clubs: ['Kribi FC', 'Ocean FC'],
        leagues: ['Elite Two', 'South regional league'],
        introEn: 'Kribi is a fast-growing coastal city with a young football scene. As the local league develops, early bettors who track team news and form can find value before prices sharpen.',
        introFr: 'Kribi est une ville côtière en pleine croissance avec une jeune scène footballistique. À mesure que la ligue se développe, les parieurs informés trouvent de la valeur avant que les cotes ne se resserrent.',
        tipsEn: ['Early-season data is noisy — wait for a few matches before judging form.', 'Use flat stakes while the market is still inefficient.', 'Follow the public track record for calibrated expectations.'],
        tipsFr: ['Les données de début de saison sont bruitées — attendez quelques matchs.', 'Utilisez des mises régulières tant que le marché est inefficace.', 'Suivez le bilan public pour des attentes calibrées.'],
    },
    {
        slug: 'ngaoundere',
        name: 'Ngaoundéré',
        region: 'Adamawa',
        clubs: ['Aigle Royal', 'Ngaoundéré FC'],
        leagues: ['Elite Two', 'Adamawa regional league'],
        introEn: 'Ngaoundéré is the gateway to Cameroon\'s Adamawa region, with a compact but loyal football following. Home advantage and travel distance are the two factors to watch when betting local fixtures.',
        introFr: 'Ngaoundéré est la porte d\'entrée de l\'Adamaoua, avec un public fidèle mais compact. L\'avantage du terrain et la distance de déplacement sont les deux facteurs à surveiller.',
        tipsEn: ['Home teams benefit from long away trips — consider +0.5 handicaps.', 'Keep a small, separate bankroll for niche regional leagues.', 'Compare local odds against the big European fixtures for value.'],
        tipsFr: ['Les équipes locales profitent des longs déplacements — pensez aux handicaps +0.5.', 'Gardez une petite bankroll séparée pour les ligues régionales.', 'Comparez les cotes locales aux grands matchs européens pour la valeur.'],
    },
];

export const getLocation = (slug: string): CityLocation | undefined =>
    LOCATIONS.find(l => l.slug === slug);
