export const PLAN_CONFIG = {
  daily: { days: 1, amount: 500 },
  weekly: { days: 7, amount: 2000 },
  monthly: { days: 30, amount: 5000 },
  quarterly: { days: 90, amount: 12000 },
  annual: { days: 365, amount: 35000 },
};

// USD-equivalent amounts for Selar / RevenueCat / global card payments
export const PLAN_AMOUNT_USD = {
  daily: 4.99,
  weekly: 14.99,
  monthly: 24.99,
  quarterly: 59.99,
  annual: 99.99,
};

export function assertValidPlan(plan) {
  if (!PLAN_CONFIG[plan]) {
    const err = new Error("Invalid plan");
    err.status = 400;
    throw err;
  }
  return PLAN_CONFIG[plan];
}

export function getVipExpiry(plan, now = new Date()) {
  const cfg = assertValidPlan(plan);
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + cfg.days);
  return expiry.toISOString();
}

export function inferPlanFromAmount(amount) {
  if (amount >= PLAN_CONFIG.annual.amount) return "annual";
  if (amount >= PLAN_CONFIG.quarterly.amount) return "quarterly";
  if (amount >= PLAN_CONFIG.monthly.amount) return "monthly";
  if (amount >= PLAN_CONFIG.weekly.amount) return "weekly";
  if (amount >= PLAN_CONFIG.daily.amount) return "daily";
  return null;
}