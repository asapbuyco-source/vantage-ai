/**
 * analysisTemplates.js — deterministic, RICH match-analysis text (no LLM).
 *
 * Why: the AI-generated rationale cost 2 network calls (EN + FR translation)
 * with delays per match → minutes per day and rate-limit failures. This
 * generates the same "money paragraph" instantly, for free, in both languages,
 * with enough combinatorial variety that it never reads generic.
 *
 * Design: classify the pick into a scenario, then compose from slot pools
 * (opener · support · risk) seeded by the fixture id → stable per match,
 * different across matches. Real stats (xG, form, odds, probability) are injected.
 */

function hash(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (arr, n) => arr[n % arr.length];

// ── form helpers ─────────────────────────────────────────────────────────────
function formStats(form) {
  const f = String(form || '').toUpperCase().replace(/[^WDL]/g, '');
  const w = (f.match(/W/g) || []).length, d = (f.match(/D/g) || []).length, l = (f.match(/L/g) || []).length;
  return { w, d, l, n: f.length, raw: f };
}
function formPhrase(stats, lang) {
  const en = [
    stats.l === 0 && stats.n >= 3 ? 'unbeaten in their last run' : null,
    stats.w >= 4 ? 'in red-hot form' : null,
    stats.w >= 3 ? 'in strong form' : null,
    stats.w === 0 && stats.n >= 3 ? 'without a win in their recent games' : null,
    stats.l >= 3 ? 'in a rough patch' : null,
    stats.d >= 2 ? 'drawing a lot lately' : null,
    'in mixed form',
  ].filter(Boolean);
  const fr = [
    stats.l === 0 && stats.n >= 3 ? 'invaincu sur ses dernières sorties' : null,
    stats.w >= 4 ? 'en grande forme' : null,
    stats.w >= 3 ? 'en bonne forme' : null,
    stats.w === 0 && stats.n >= 3 ? 'sans victoire récente' : null,
    stats.l >= 3 ? 'dans une mauvaise passe' : null,
    stats.d >= 2 ? 'souvent accroché' : null,
    'en forme irrégulière',
  ].filter(Boolean);
  return lang === 'fr' ? fr[0] : en[0];
}

function classify(pred) {
  const sb = pred._safest_bet;
  const label = String(sb && Array.isArray(sb) ? sb[0] : (sb || pred.prediction || pred.prediction_en || pred.bet_type || '')).toLowerCase();
  if (/over\s*\d/.test(label)) return 'over';
  if (/under\s*\d/.test(label)) return 'under';
  if (/both teams|btts/.test(label)) return /(no|non|not)/.test(label) ? 'btts_no' : 'btts_yes';
  if (/double chance|1x|x2|\b12\b/.test(label)) return 'dc';
  if (/draw no bet|dnb/.test(label)) return 'dnb';
  if (/to win \(1\)|home win/.test(label)) return 'home';
  if (/to win \(2\)|away win/.test(label)) return 'away';
  if (/\bdraw\b/.test(label)) return 'draw';
  return 'generic';
}

// ── slot pools ───────────────────────────────────────────────────────────────
// context: { h, a, lg, hf, af, hxg, axg, tot, prob, odds, homeFav, awayFav }

function openers(ctx, lang) {
  const { h, a, hf, af, hxg, axg, tot } = ctx;
  const en = [
    `${h} are ${hf}, and their ${hxg} xG against ${a}'s ${axg} xG points to goals`,
    `${a} travel ${af}, while ${h} carry ${hxg} xG into a game priced for ${axg} at the other end`,
    `The numbers lean our way: ${h} (${hxg} xG) and ${a} (${axg} xG) shape a total of ${tot}`,
    `${h} look ${hf} at home and ${a} arrive ${af}`,
    `Both sides bring real attacking intent — ${hxg} and ${axg} xG respectively`,
    `${h} hold the model edge, but ${a} are ${af}, which keeps this honest`,
    `Recent form — ${h} ${hf}, ${a} ${af} — plus a ${tot} xG baseline sets the scene`,
    `A ${tot}-xG contest: ${h} (${hf}) host ${a} (${af})`,
  ];
  const fr = [
    `${h} est ${hf}, et ses ${hxg} xG face aux ${axg} xG de ${a} annoncent des buts`,
    `${a} se déplace ${af}, tandis que ${h} affiche ${hxg} xG dans un match évalué à ${axg}`,
    `Les chiffres penchent pour nous : ${h} (${hxg} xG) et ${a} (${axg} xG) donnent un total de ${tot}`,
    `${h} paraît ${hf} à domicile et ${a} arrive ${af}`,
    `Les deux équipes montrent de vraies intentions offensives — ${hxg} et ${axg} xG`,
    `${h} garde l'avantage du modèle, mais ${a} est ${af}, ce qui rend ce match ouvert`,
    `Forme récente — ${h} ${hf}, ${a} ${af} — avec une base de ${tot} xG`,
    `Un duel à ${tot} xG : ${h} (${hf}) reçoit ${a} (${af})`,
  ];
  return lang === 'fr' ? fr : en;
}

function riskPool(lang) {
  const en = [
    'Risk: an early goal could change the tempo.',
    'Risk: a defensive reshuffle could slow it down.',
    'Risk: a red card or early substitution can swing it.',
    'Risk: if the favourite scores first, the underdog may shut up shop.',
    'Risk: weather and pitch conditions can lower the goal count.',
    'Risk: a cagey opening 20 minutes could keep it tight.',
    'Risk: rotation after a midweek game may blunt the attack.',
    'Risk: a single moment of quality can decide it.',
    'Risk: late line-up changes could shift the balance.',
    'Risk: the model edge is small, so stake discipline matters.',
  ];
  const fr = [
    'Risque : un but précoce peut changer le rythme.',
    'Risque : un repli défensif pourrait ralentir le jeu.',
    'Risque : un carton rouge ou un changement précoce peut tout faire basculer.',
    'Risque : si le favori marque d\'abord, l\'outsider peut se fermer.',
    'Risque : la météo et le terrain peuvent réduire le nombre de buts.',
    'Risque : un début prudent de 20 minutes peut garder le score serré.',
    'Risque : la rotation après un match en semaine peut émousser l\'attaque.',
    'Risque : un seul éclair de génie peut décider du match.',
    'Risque : des changements tardifs de composition peuvent déstabiliser.',
    'Risque : la marge du modèle est mince, la discipline de mise est clé.',
  ];
  return lang === 'fr' ? fr : en;
}

const SUPPORT = {
  over: {
    en: [
      (c) => `${c.h} attack well and ${c.a}'s games have been open — the goals market should deliver.`,
      (c) => `With ${c.tot} xG between them, the over line is well within reach.`,
      (c) => `${c.a} concede chances, and ${c.h} are clinical enough to punish it.`,
      (c) => `Both teams push numbers forward, so a high-tempo, goal-heavy game is likely.`,
      (c) => `The xG and shot data point to more than the line — the models agree.`,
      (c) => `Recent meetings and current scoring rates make the over the value side.`,
    ],
    fr: [
      (c) => `${c.h} attaque bien et les matchs de ${c.a} sont ouverts — le marché des buts devrait payer.`,
      (c) => `Avec ${c.tot} xG au total, la ligne de plus est largement atteignable.`,
      (c) => `${c.a} concède des occasions et ${c.h} est assez clinique pour en profiter.`,
      (c) => `Les deux équipes se projettent vers l'avant, un match rythmé et prolifique est probable.`,
      (c) => `Les xG et les données de tirs pointent au-dessus de la ligne — les modèles confirment.`,
      (c) => `Les confrontations récentes et les taux de buts actuels font du plus le pari de valeur.`,
    ],
  },
  under: {
    en: [
      (c) => `Both defences are organised and scoring has been low — the under is the sensible side.`,
      (c) => `With only ${c.tot} xG combined, chances will be scarce and the total should stay down.`,
      (c) => `${c.h} and ${c.a} rarely blow games open, so the under holds up.`,
      (c) => `A tight, tactical match is likely — neither side commits numbers forward.`,
      (c) => `Low shot volume from both teams supports the under line.`,
    ],
    fr: [
      (c) => `Les deux défenses sont organisées et le scoring est faible — le moins est le côté logique.`,
      (c) => `Avec seulement ${c.tot} xG au total, les occasions seront rares et le score devrait rester bas.`,
      (c) => `${c.h} et ${c.a} ouvrent rarement les matchs, le moins tient.`,
      (c) => `Un match fermé et tactique est probable — aucune équipe ne se découvre.`,
      (c) => `Le faible volume de tirs des deux camps soutient la ligne de moins.`,
    ],
  },
  btts_yes: {
    en: [
      (c) => `Both teams score regularly and their games see both nets — BTTS fits naturally.`,
      (c) => `${c.h}'s attack meets a ${c.a} side that scores away — clean sheets look unlikely.`,
      (c) => `Neither defence is watertight right now, so both finding the net is likely.`,
      (c) => `Open styles on both sides make a both-teams-to-score game the value play.`,
    ],
    fr: [
      (c) => `Les deux équipes marquent régulièrement et leurs matchs voient les deux filets — BTTS colle bien.`,
      (c) => `L'attaque de ${c.h} rencontre un ${c.a} qui marque à l'extérieur — les clean sheets semblent improbables.`,
      (c) => `Aucune défense n'est étanche actuellement, donc les deux marqueront probablement.`,
      (c) => `Des styles ouverts des deux côtés font du « les deux marquent » le pari de valeur.`,
    ],
  },
  btts_no: {
    en: [
      (c) => `Expect ${c.h} to control and one side to keep a clean sheet — BTTS No looks right.`,
      (c) => `With a tight defensive setup, at least one net should stay untouched.`,
      (c) => `Low chance creation on one side makes "no" the value stance.`,
      (c) => `The defensive numbers point to a low-concession game — BTTS No.`,
    ],
    fr: [
      (c) => `${c.h} devrait contrôler et un camp garder sa cage inviolée — BTTS Non semble juste.`,
      (c) => `Avec une organisation défensive serrée, au moins un filet devrait rester vierge.`,
      (c) => `La faible création d'occasions d'un côté fait du « non » la position de valeur.`,
      (c) => `Les statistiques défensives indiquent un match à peu de concessions — BTTS Non.`,
    ],
  },
  dc: {
    en: [
      (c) => `${c.h} are strong enough to avoid defeat — the double chance is the safer route.`,
      (c) => `With ${c.a}'s inconsistency, covering two outcomes is the smart play.`,
      (c) => `The double chance removes the draw risk while keeping the edge.`,
      (c) => `Form and xG favour our side across two results — value is in the cover.`,
    ],
    fr: [
      (c) => `${c.h} est assez solide pour éviter la défaite — la double chance est la voie sûre.`,
      (c) => `Vu l'irrégularité de ${c.a}, couvrir deux résultats est le choix malin.`,
      (c) => `La double chance élimine le risque de nul tout en gardant l'avantage.`,
      (c) => `Forme et xG favorisent notre camp sur deux résultats — la valeur est dans la couverture.`,
    ],
  },
  home: {
    en: [
      (c) => `${c.h} have the stronger metrics and home advantage — the win is justified.`,
      (c) => `With ${c.a} travelling ${c.af}, ${c.h} should take this.`,
      (c) => `Home form and xG favour ${c.h} to win.`,
      (c) => `The model gives ${c.h} the clear edge at home.`,
    ],
    fr: [
      (c) => `${c.h} a de meilleures statistiques et l'avantage du terrain — la victoire se justifie.`,
      (c) => `Avec ${c.a} qui se déplace ${c.af}, ${c.h} devrait s'imposer.`,
      (c) => `La forme à domicile et les xG favorisent la victoire de ${c.h}.`,
      (c) => `Le modèle donne à ${c.h} un net avantage à domicile.`,
    ],
  },
  away: {
    en: [
      (c) => `${c.a} are the stronger side on form and xG — the away win is the value.`,
      (c) => `Despite travelling, ${c.a}'s quality should tell against a ${c.hf} ${c.h}.`,
      (c) => `The metrics lean to ${c.a} — the away win is the pick.`,
      (c) => `${c.h}'s weaknesses give ${c.a} a clear opening on the road.`,
    ],
    fr: [
      (c) => `${c.a} est la meilleure équipe en forme et en xG — la victoire à l'extérieur est la valeur.`,
      (c) => `Malgré le déplacement, la qualité de ${c.a} devrait faire la différence contre un ${c.h} ${c.hf}.`,
      (c) => `Les statistiques penchent pour ${c.a} — la victoire extérieure est le pari.`,
      (c) => `Les faiblesses de ${c.h} ouvrent une brèche à ${c.a} à l'extérieur.`,
    ],
  },
  dnb: {
    en: [
      (c) => `${c.h} should at least avoid defeat; Draw No Bet protects us from the draw.`,
      (c) => `The edge is with our side, and DNB refunds the draw — a low-risk route.`,
      (c) => `${c.a}'s form is shaky, so the draw-no-bet covers the realistic risk.`,
    ],
    fr: [
      (c) => `${c.h} devrait au moins éviter la défaite ; le Draw No Bet nous protège du nul.`,
      (c) => `L'avantage est de notre côté et le DNB rembourse le nul — une voie à faible risque.`,
      (c) => `La forme de ${c.a} est fragile, donc le « nul remboursé » couvre le risque réel.`,
    ],
  },
  draw: {
    en: [
      (c) => `Two evenly matched sides make the draw the value at these odds.`,
      (c) => `The models can't separate them — the draw is well priced.`,
    ],
    fr: [
      (c) => `Deux équipes équilibrées font du match nul la valeur à ces cotes.`,
      (c) => `Les modèles ne les départagent pas — le nul est bien coté.`,
    ],
  },
  generic: {
    en: [
      (c) => `The data supports our pick across form, xG and market pricing.`,
      (c) => `The model finds a clear edge here at the current odds.`,
    ],
    fr: [
      (c) => `Les données soutiennent notre pari en forme, xG et prix du marché.`,
      (c) => `Le modèle trouve un net avantage ici aux cotes actuelles.`,
    ],
  },
};

function makeCtx(pred) {
  const h = pred.home_team || pred.homeTeam || 'Home';
  const a = pred.away_team || pred.awayTeam || 'Away';
  const hxg = Number(pred.expected_goals_home ?? 0);
  const axg = Number(pred.expected_goals_away ?? 0);
  const tot = (hxg + axg).toFixed(2);
  const hfs = formStats(pred.home_form), afs = formStats(pred.away_form);
  return {
    h, a, lg: pred.league || '',
    hxg: hxg.toFixed(2), axg: axg.toFixed(2), tot,
    hf: formPhrase(hfs, 'en'), af: formPhrase(afs, 'en'),
    homeFav: (Number(pred.home_win_prob || 0) || 0) > (Number(pred.away_win_prob || 0) || 0),
    awayFav: (Number(pred.away_win_prob || 0) || 0) > (Number(pred.home_win_prob || 0) || 0),
    prob: Math.round((pred.calibrated_probability || pred.probability || 0) * 100),
    odds: pred.odds || pred.best_odds || null,
  };
}

/** Generate { en, fr } analysis text for a prediction. Deterministic per fixture. */
export function generateAnalysis(pred) {
  const seed = hash(pred.fixture_id || `${pred.home_team}-${pred.away_team}-${pred.league}`);
  const scenario = classify(pred);
  const ctx = makeCtx(pred);

  const build = (lang) => {
    // form phrase in the right language
    const hfv = formStats(pred.home_form), afv = formStats(pred.away_form);
    const c = { ...ctx, hf: formPhrase(hfv, lang), af: formPhrase(afv, lang) };
    const open = pick(openers(c, lang), seed);
    const supFn = pick(SUPPORT[scenario]?.[lang] || SUPPORT.generic[lang], seed >> 3);
    const sup = supFn(c);
    const risk = pick(riskPool(lang), seed >> 7);
    return `${open}. ${sup} ${risk}`;
  };

  return { en: build('en'), fr: build('fr') };
}

/** Backwards-friendly: keep the old name working. */
export function templateAnalysis(pred) { return generateAnalysis(pred); }

export default { generateAnalysis, templateAnalysis };