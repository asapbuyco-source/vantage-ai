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

// Cameroon/Senegalese market: fixed FCFA prices (website pricing, NOT USD conversion)
export const LOCAL_CFA_PRICING: Record<string, number> = {
  'daily': 500,
  'weekly': 2000,
  'monthly': 5000,
  'quarterly': 12000,
  'annual': 35000,
};

export function getPricingForCountry(amountFcfa: number, countryCode: string = 'cm', planId?: string) {
  // Cameroon & Francophone Africa: show FCFA directly
  if (['cm', 'ci', 'sn'].includes(countryCode)) {
    return { amount: amountFcfa, symbol: 'FCFA', code: 'XAF', isConverted: false, originalValue: amountFcfa, isLocal: true };
  }
  
  // Other countries: convert FCFA to local currency
  if (CURRENCY_MAP[countryCode]) {
    const cur = CURRENCY_MAP[countryCode];
    const usdEquivalent = amountFcfa / 600;  // Convert FCFA → USD first
    const converted = Math.round(usdEquivalent * cur.rate);
    return { amount: converted, symbol: cur.symbol, code: cur.label, isConverted: true, originalValue: amountFcfa };
  }
  
  // Fallback: show FCFA
  return { amount: amountFcfa, symbol: 'FCFA', code: 'XAF', isConverted: false, originalValue: amountFcfa };
}
