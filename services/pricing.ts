// Shared pricing utilities — single source for VIP.tsx and PaymentModal.tsx

export const CURRENCY_MAP: Record<string, { symbol: string; rate: number; label: string }> = {
  'ng': { symbol: '₦', rate: 1500, label: 'NGN' },
  'ke': { symbol: 'KSh', rate: 130, label: 'KES' },
  'gh': { symbol: 'GH₵', rate: 15, label: 'GHS' },
  'za': { symbol: 'R', rate: 19, label: 'ZAR' },
  'cm': { symbol: 'FCFA', rate: 600, label: 'XAF' },
  'ci': { symbol: 'FCFA', rate: 600, label: 'XOF' },
  'sn': { symbol: 'FCFA', rate: 600, label: 'XOF' },
  'gb': { symbol: '£', rate: 0.79, label: 'GBP' },
  'eu': { symbol: '€', rate: 0.92, label: 'EUR' },
  'us': { symbol: '$', rate: 1, label: 'USD' },
};

// Cameroon/Senegalese market: fixed FCFA prices (NOT USD conversion)
export const LOCAL_CFA_PRICING: Record<string, number> = {
  'weekly': 2000,
  'monthly': 5000,
  'quarterly': 12000,
  'annual': 35000,
};

export function getPricingForCountry(baseUsd: number, countryCode: string = 'other', planId?: string) {
  // Cameroon & Francophone Africa: use fixed FCFA prices
  if (planId && ['cm', 'ci', 'sn'].includes(countryCode) && LOCAL_CFA_PRICING[planId]) {
    const amount = LOCAL_CFA_PRICING[planId];
    const cur = CURRENCY_MAP[countryCode];
    return { amount, symbol: cur.symbol, code: cur.label, isConverted: true, originalValue: baseUsd, isLocal: true };
  }
  
  if (CURRENCY_MAP[countryCode]) {
    const cur = CURRENCY_MAP[countryCode];
    const converted = Math.round(baseUsd * cur.rate);
    return { amount: converted, symbol: cur.symbol, code: cur.label, isConverted: true, originalValue: baseUsd };
  }
  return { amount: baseUsd, symbol: '$', code: 'USD', isConverted: false, originalValue: baseUsd };
}
