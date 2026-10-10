import admin from 'firebase-admin';
import { getLagosTodayKey, getLagosYesterdayKey } from './dateUtils.js';
import pino from 'pino';

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});

const KEYWORDS_EN = [
    'football betting tips', 'value bets today', 'data-driven predictions',
    'soccer picks', 'betting tips', 'football predictions today',
    'best bets', 'premier league picks', 'liga predictions',
    'accumulator tips', 'sure wins', 'football analysis'
];

const KEYWORDS_FR = [
    'pronostics football', 'paris sportifs', 'conseils paris',
    'pronosticsoccer', 'analyses foot', 'meilleurs paris',
    'coupe du jour', 'pronostics du jour', 'valeur paris'
];

const TEMPLATES_EN = {
    titles: [
        "Today's Best Football Betting Tips: {league} Picks for {date}",
        "Exclusive {league} Predictions: Value Bets for Today",
        "Football Betting Analysis: Top Picks for {date}",
        "Data-Driven {league} Predictions: Today's Best Bets",
        "Soccer Betting Tips: Winning Picks for {date}"
    ],
    intros: [
        "Welcome to Vantage AI's daily betting analysis. Our quantitative model has identified the best opportunities across today's football schedule, focusing on {league} matches with the highest expected value.",
        "Today's football action promises exciting betting opportunities. After analyzing the data from {league} and other top competitions, we've found {count} high-confidence picks for you.",
        "Get ready for today's matches with our expert football predictions. Our model has scanned {league} fixtures and identified the most profitable betting opportunities for {date}.",
        "The quantitative team at Vantage AI has been hard at work analyzing today's football fixtures. Here's what our data-driven approach uncovered for {league}."
    ],
    matchHeaders: [
        "### {home} vs {away}",
        "### {home} - {away}",
        "### {home} Take on {away}"
    ],
    matchAnalysis: [
        "This {league} clash features {home} hosting {away}. Based on recent form and head-to-head data, we expect {prediction}. The model gives a {confidence}% confidence rating with odds at {odds}.",
        "{home} will be looking to secure a positive result against {away} in this {league} fixture. Our analysis points to {prediction} as the best value bet at {odds}.",
        "A interesting matchup in {league}: {home} welcoming {away}. The data suggests {prediction} offers the best value with {confidence}% confidence."
    ],
    accumIntro: [
        "Looking for a multi-match accumulator? Here are our top picks for today's coupon:",
        "For those feeling adventurous, here's a potential accumulator combining our safest picks:",
        "Our recommended accumulator for today combines these high-confidence picks:"
    ],
    accumItems: [
        "{home} vs {away}: {prediction} at {odds}",
        "{home} {prediction} ({odds})"
    ],
    accumOutro: [
        "Combined odds: {totalOdds}. Good luck!",
        "Total accumulator odds: {totalOdds}. Play responsibly.",
        "This {count}-fold accumulator offers combined odds of {totalOdds}. Remember to bet responsibly."
    ],
    outros: [
        "Remember to bet responsibly. Our quantitative model provides data-driven insights, but all betting carries risk. Good luck with today's picks!",
        "These predictions are based on quantitative analysis. Please bet responsibly and only wager what you can afford to lose.",
        "Our model has done the heavy lifting — now it's your choice. Bet wisely and enjoy the beautiful game!"
    ]
};

const TEMPLATES_FR = {
    titles: [
        "Meilleurs Pronostics Football du Jour: Conseils Paris pour {date}",
        "Pronostics {league} Exclusifs: Valeur Paris Aujourd'hui",
        "Analyse Paris Sportifs: Meilleurs Pronostics pour {date}",
        "Pronostics Data-Driven {league}: Conseils pour Aujourd'hui",
        "Conseils Paris Soccer: Pronostics Gagnants pour {date}"
    ],
    intros: [
        "Bienvenue dans l'analyse quotidienne de Vantage AI. Notre modèle quantitatif a identifié les meilleures opportunités pour aujourd'hui, en se concentrant sur les matchs de {league} avec la plus forte valeur attendue.",
        "L'action football aujourd'hui promet des opportunités de paris intéressantes. Après avoir analysé les données de {league} et d'autres compétitions, nous avons trouvé {count} paris à haute confiance pour vous.",
        "Préparez-vous pour les matchs d'aujourd'hui avec nos pronostics experts. Notre modèle a analysé les fixtures de {league} et identifié les opportunités les plus rentables pour le {date}.",
        "L'équipe quantitative de Vantage AI a travaillé dur pour analyser les fixtures d'aujourd'hui. Voici ce que notre approche data-driven a révélé pour {league}."
    ],
    matchHeaders: [
        "### {home} vs {away}",
        "### {home} - {away}",
        "### {home} affronte {away}"
    ],
    matchAnalysis: [
        "Ce match de {league} oppose {home} à {away}. Basé sur la forme récente et les données tête-à-tête, nous prévoyons {prediction}. Le modèle donne une confiance de {confidence}% avec des cotes à {odds}.",
        "{home} cherchera à sécuriser un résultat positif contre {away} dans ce match de {league}. Notre analyse indique {prediction} comme le meilleur pari à valeur à {odds}.",
        "Un match intéressant en {league} : {home} accueillant {away}. Les données suggèrent {prediction} offre la meilleure valeur avec {confidence}% de confiance."
    ],
    accumIntro: [
        "Vous cherchez un accumulateur multi-matchs ? Voici nos meilleurs paris pour le coupon du jour:",
        "Pour les plus audacieux, voici un accumulateur potentiel combinant nos paris les plus sûrs:",
        "Notre accumulateur recommandé pour aujourd'hui combine ces paris à haute confiance:"
    ],
    accumItems: [
        "{home} vs {away}: {prediction} à {odds}",
        "{home} {prediction} ({odds})"
    ],
    accumOutro: [
        "Cotes combinées: {totalOdds}. Bonne chance!",
        "Cotes totales de l'accumulateur: {totalOdds}. Jouez de manière responsable.",
        "Cet accumulateur de {count} matchs offre des cotes combinées de {totalOdds}. Souvenez-vous de parier responsibly."
    ],
    outros: [
        "N'oubliez pas de parier de manière responsable. Notre modèle quantitatif fournit des insights data-driven, mais tout pari comporte un risque. Bonne chance avec les paris du jour!",
        "Ces prédictions sont basées sur l'analyse quantitative. Veuillez parier de manière responsable et ne miser uniquement ce que vous pouvez vous permettre de perdre.",
        "Notre modèle a fait le travail lourd — maintenant c'est votre choix. Pariez intelligemment et profitez du beau jeu!"
    ]
};

const LEAGUES = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League'];

const selectRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const selectMultiple = (arr, count) => {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
};

const generateDataDrivenPreview = (db, allMatches, league) => {
    if (!allMatches || allMatches.length === 0) {
        return null;
    }

        const todayStr = getLagosTodayKey();
    const templates = TEMPLATES_EN;
    const leagueName = league || 'Top Leagues';

    const topPicks = allMatches
        .filter(m => m.confidence >= 70)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5);

    if (topPicks.length === 0) {
        return null;
    }

    const titleTemplate = selectRandom(templates.titles)
        .replace('{league}', leagueName)
        .replace('{date}', todayStr);
    const title = titleTemplate;

    const introTemplate = selectRandom(templates.intros)
        .replace('{league}', leagueName)
        .replace('{count}', String(topPicks.length))
        .replace('{date}', todayStr);
    const intro = `[Data-Driven Preview] ${introTemplate}`;

    let matchesHtml = '';
    for (const match of topPicks) {
        const home = match.homeTeam || match.home_team || 'Home';
        const away = match.awayTeam || match.away_team || 'Away';
        const prediction = match.prediction_en || match.prediction || 'N/A';
        const confidence = match.confidence || 0;
        const odds = match.odds || 1.5;
        const form = match.form || 'N/A';
        const xg = match.xg ? `xG: ${match.xg}` : '';
        const ev = match.ev_pct ? `EV: +${match.ev_pct}%` : '';

        const headerTemplate = selectRandom(templates.matchHeaders)
            .replace('{home}', home).replace('{away}', away);

        const analysisTemplate = selectRandom(templates.matchAnalysis)
            .replace('{home}', home)
            .replace('{away}', away)
            .replace('{league}', match.league || leagueName)
            .replace('{prediction}', prediction)
            .replace('{confidence}', String(confidence))
            .replace('{odds}', String(odds));

        let extraInfo = [form, xg, ev].filter(Boolean).join(' | ');
        matchesHtml += `<h2>${headerTemplate}</h2>\n<p>${analysisTemplate}</p>\n`;
        if (extraInfo) {
            matchesHtml += `<p><i>${extraInfo}</i></p>\n`;
        }
    }

    let content = `<h1>${title}</h1>\n`;
    content += `<p>${intro}</p>\n`;
    content += matchesHtml;
    content += `<p><strong>${selectRandom(templates.outros)}</strong></p>`;

    const excerpt = content.replace(/<[^>]+>/g, '').substring(0, 160).trim() + '...';
    const docId = `${todayStr}_en_data_driven`;

    db.collection('daily_blogs').doc(docId).set({
        title,
        content,
        excerpt,
        tags: ['football', 'predictions', 'data-driven', leagueName],
        generatedAt: new Date().toISOString(),
        generatedBy: 'programmatic-data-driven',
        updatedAt: new Date().toISOString(),
        language: 'en',
        footballCount: topPicks.length,
        basketballCount: 0,
        date: todayStr,
        isDataDrivenFallback: true,
    });

    return {
        status: 'success',
        title,
        generatedLength: content.length,
        footballPicks: topPicks.length,
        basketballPicks: 0,
        isDataDrivenFallback: true,
    };
};

const injectKeywords = (text, keywords) => {
    const selected = selectMultiple(keywords, 3);
    let result = text;
    selected.forEach(kw => {
        if (Math.random() > 0.5) {
            result = result.replace('{keyword}', kw);
        }
    });
    return result.replace('{keyword}', selected[0] || 'football betting tips');
};

export const generateBlogPost = async (language = 'en', leagueOverride = null) => {
        const todayStr = getLagosTodayKey();
    const db = admin.firestore();

    const [footballSnap, basketballSnap] = await Promise.all([
        db.collection('daily_predictions').doc(todayStr).get(),
        db.collection('basketball_predictions').doc(todayStr).get(),
    ]);

    const footballMatches = (footballSnap.exists && footballSnap.data()?.matches) || [];
    const basketballMatches = (basketballSnap.exists && basketballSnap.data()?.matches) || [];
    const quantSnap = await db.collection('quant_predictions').doc(todayStr).get();
    const quantMatches = (quantSnap.exists && quantSnap.data()?.predictions) || [];

    const allMatches = [...footballMatches, ...basketballMatches, ...quantMatches];

    if (allMatches.length === 0) {
        return { status: 'skipped', reason: 'no_predictions_available' };
    }

    const hasFootball = footballMatches.length > 0 || quantMatches.length > 0;
    const hasBasketball = basketballMatches.length > 0;

    const templates = language === 'fr' ? TEMPLATES_FR : TEMPLATES_EN;

    // Pick normalizer: quant docs use snake_case (home_team / away_team), legacy
    // docs use camelCase (homeTeam / awayTeam). Mirrors the Telegram free-pick bar:
    // safe/value category, >=65% confidence, real odds, football only.
    const norm = (m) => {
        const home = m.home_team || m.homeTeam || (m.home && m.home.name) || '';
        const away = m.away_team || m.awayTeam || (m.away && m.away.name) || '';
        return {
            ...m,
            home,
            away,
            market: m.prediction_en || m.prediction || m.bet_type || '—',
            odds: Number(m.odds || m.pick_time_odds || 0),
            confidence: m.confidence ?? (m.probability != null ? Math.round(m.probability * 100) : 0),
            league: m.league || '',
            ev: m.ev_pct != null ? m.ev_pct : (m.expected_value != null ? Math.round(m.expected_value * 100) : null),
            fixtureId: String(m.fixture_id || m.id || ''),
            kickoff: m.kickoff_local || m.time || '',
            formHome: m.home_form || '',
            formAway: m.away_form || '',
            xgHome: m.expected_goals_home != null ? Number(m.expected_goals_home).toFixed(2) : null,
            xgAway: m.expected_goals_away != null ? Number(m.expected_goals_away).toFixed(2) : null,
        };
    };

    let picks = allMatches
        .map(norm)
        .filter(p => p.sport !== 'basketball' && p.odds > 1)
        .filter(p => p.confidence >= 65 && (p.category === 'safe' || p.category === 'value'))
        .sort((a, b) => b.confidence - a.confidence);

    if (leagueOverride) {
        const inLeague = picks.filter(p => String(p.league || '').toLowerCase().includes(leagueOverride.toLowerCase()));
        if (inLeague.length >= 2) picks = inLeague;
    }
    const topPicks = picks.slice(0, 5);

    if (topPicks.length === 0) {
        const fallbackContent = generateDataDrivenPreview(db, allMatches, leagueOverride);
        if (fallbackContent) {
            return fallbackContent;
        }
        return { status: 'skipped', reason: 'predictions_pending_analysis' };
    }

    const league = leagueOverride || topPicks[0].league || 'Top Leagues';
    const dateLabel = new Date().toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

    // SEO title with REAL team names — the daily doc date keeps the slug unique.
    const headMatch = topPicks[0];
    const title = `${headMatch.home} vs ${headMatch.away} — ${league} Predictions ${todayStr}`;

    const intro = (language === 'fr'
        ? `Découvrez nos pronostics ${league} du ${dateLabel}. Notre moteur quantitatif (Poisson, Elo, forme) a analysé les matchs du jour pour identifier les meilleures valeurs.`
        : `${league} betting predictions for ${dateLabel}, powered by Vantage AI's quantitative engine (Poisson, Elo, form). Today we highlight ${topPicks.length} high-confidence picks with odds, expected value and analysis.`).trim();

    const pageUrl = (path) => `https://vantageai.online${path}`;
    const oddsText = (p) => (p.odds > 0 ? `@ ${p.odds.toFixed(2)}` : '');
    const evText = (p) => (p.ev != null ? ` | EV +${p.ev}%` : '');
    const xgText = (p) => ((p.xgHome && p.xgAway) ? ` | xG ${p.xgHome}–${p.xgAway}` : '');
    const formText = (p) => ((p.formHome || p.formAway) ? ` | Form ${p.formHome || 'N/A'} / ${p.formAway || 'N/A'}` : '');
    const kickoffText = (p) => (p.kickoff ? ` | Kickoff ${p.kickoff}` : '');

    let matchesHtml = '';
    for (const p of topPicks) {
        const link = p.fixtureId ? pageUrl(`/match/${encodeURIComponent(p.fixtureId)}`) : null;
        matchesHtml += `<h2>${link ? `<a href="${link}">` : ''}${p.home} vs ${p.away}${link ? '</a>' : ''}</h2>\n`;
        matchesHtml += `<p>${p.league} · ${p.market} ${oddsText(p)} · confidence ${p.confidence}%${evText(p)}${xgText(p)}${formText(p)}${kickoffText(p)}</p>\n`;
        matchesHtml += `<p>${language === 'fr'
            ? `Notre modèle identifie <strong>${p.market}</strong> comme le pari le plus intéressant de ce match. Les cotes actuelles (${p.odds.toFixed(2)})${p.ev != null ? ` offrent une valeur attendue de +${p.ev}%` : ''}.`
            : `Our model sees <strong>${p.market}</strong> as the key angle here. With implied odds of ${p.odds.toFixed(2)}${p.ev != null ? ` and an expected value of +${p.ev}%` : ''}, this pick sits above our quality floor.`}</p>\n`;
        if (link) matchesHtml += `<p><a href="${link}">${language === 'fr' ? 'Analyse complète du match →' : 'Full match analysis →'}</a></p>\n`;
    }

    let accaHtml = '';
    const safeAcca = topPicks.filter(p => p.confidence >= 70).slice(0, 3);
    if (safeAcca.length >= 2) {
        const accaItems = safeAcca.map(p => `<li>${p.home} vs ${p.away} — ${p.market} ${oddsText(p)}</li>`).join('\n');
        const totalOdds = Math.round(safeAcca.reduce((a, p) => a * (p.odds || 1), 1) * 100) / 100;
        accaHtml = `<h2>${language === 'fr' ? 'Coupon du jour' : 'Today\'s accumulator'}</h2>\n<ul>\n${accaItems}\n</ul>\n<p>${language === 'fr' ? `Cotes combinées : ${totalOdds}. Jouez de manière responsable.` : `Combined odds: ${totalOdds}. Bet responsibly.`}</p>\n`;
    }

    const outro = (language === 'fr'
        ? `Retrouvez chaque matin les meilleurs pronostics pour vos paris 1xBet et Premier Bet au Cameroun. Les pronostics ne garantissent aucun gain — jouez de manière responsable.`
        : `Get fresh football predictions every morning for Cameroon's favourite books — free picks, VIP signals and a transparent track record. Predictions never guarantee winnings; bet responsibly.`).trim();

    let content = `<h1>${title}</h1>\n`;
    content += `<p>${intro}</p>\n`;
    content += matchesHtml;
    content += accaHtml;
    content += `<p><strong>${outro}</strong></p>\n`;

    const excerpt = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').substring(0, 160).trim() + '...';

    // Unique doc ID per league — BlogIndex links by doc id, so suffixed ids resolve.
    const leagueSlug = String(league)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const docId = `${todayStr}_${language}_roundup_${leagueSlug || 'top'}`;

    await db.collection('daily_blogs').doc(docId).set({
        title,
        content,
        excerpt,
        tags: ['football', 'predictions', 'betting', leagueSlug].concat(language === 'fr' ? ['pronostics'] : ['soccer tips']),
        generatedAt: new Date().toISOString(),
        generatedBy: 'programmatic-v2',
        updatedAt: new Date().toISOString(),
        language,
        footballCount: topPicks.length,
        basketballCount: 0,
        // Save the date portion so the frontend can group/display properly
        date: todayStr,
        topPick: { home: headMatch.home, away: headMatch.away, market: headMatch.market, odds: headMatch.odds },
    });

    return {
        status: 'success',
        title,
        generatedLength: content.length,
        footballPicks: topPicks.length,
        basketballPicks: 0,
    };
};

export const triggerBlogGeneration = async () => {
    logger.info('[BlogGenerator] Starting programmatic blog generation...');
    try {
        const topLeagues = ['Premier League', 'La Liga', 'Serie A', 'Champions League'];

        // Generate English blogs for multiple leagues — use allSettled so one league failure doesn't block others
        const results = await Promise.allSettled(
            topLeagues.map(league => generateBlogPost('en', league))
        );

        const succeeded = [];
        const failed = [];
        results.forEach((res, i) => {
            if (res.status === 'fulfilled') {
                succeeded.push(topLeagues[i]);
                logger.info(`[BlogGenerator] Generated English blog for ${topLeagues[i]} (${res.value.status})`);
            } else {
                failed.push(topLeagues[i]);
                logger.warn(`[BlogGenerator] Failed to generate blog for ${topLeagues[i]}: ${res.reason?.message}`);
            }
        });

        return {
            status: succeeded.length > 0 ? 'success' : 'error',
            generatedCount: succeeded.length,
            failedLeagues: failed,
        };
    } catch (e) {
        logger.error({ error: e.message }, '[BlogGenerator] Error');
        return { status: 'error', error: e.message };
    }
};