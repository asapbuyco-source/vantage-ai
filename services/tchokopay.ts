import { auth } from "../firebaseConfig";

export interface TchokoPayInitResponse {
    checkoutUrl: string;
    reference: string;
}

async function getFirebaseBearer(): Promise<string> {
    const current = auth.currentUser;
    if (!current) throw new Error("Login required");
    return `Bearer ${await current.getIdToken()}`;
}

const getBackendUrl = (): string => {
    const url = import.meta.env?.VITE_BACKEND_URL;
    if (!url) throw new Error('[TchokoPay] VITE_BACKEND_URL is not configured.');
    return url.replace(/\/$/, '');
};

export const initiateTchokoPayPayment = async (
    plan: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual',
): Promise<TchokoPayInitResponse> => {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/payments/tchokopay/initiate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: await getFirebaseBearer(),
        },
        body: JSON.stringify({ plan }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'TchokoPay initiation failed');
    }

    const data = await response.json();
    localStorage.setItem('pendingTchokopayRef', data.reference);
    localStorage.setItem('pendingVipPlan', plan);
    return { checkoutUrl: data.checkoutUrl, reference: data.reference };
};

export const verifyTchokopayOrder = async (
    reference: string,
): Promise<boolean> => {
    if (!reference) return false;
    try {
        const backendUrl = getBackendUrl();
        const response = await fetch(`${backendUrl}/api/payments/tchokopay/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: await getFirebaseBearer(),
            },
            body: JSON.stringify({ reference }),
        });

        // 202 = still pending — poll up to 6 times (15s)
        if (response.status === 202) {
            for (let attempt = 0; attempt < 6; attempt++) {
                await new Promise(r => setTimeout(r, 2500));
                const retry = await fetch(`${backendUrl}/api/payments/tchokopay/verify`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: await getFirebaseBearer(),
                    },
                    body: JSON.stringify({ reference }),
                });
                if (retry.status === 202) continue;
                if (retry.ok) {
                    localStorage.removeItem('pendingTchokopayRef');
                    localStorage.removeItem('pendingVipPlan');
                    return true;
                }
                break;
            }
            return false;
        }

        if (!response.ok) return false;

        localStorage.removeItem('pendingTchokopayRef');
        localStorage.removeItem('pendingVipPlan');
        return true;
    } catch (e) {
        console.error('[TchokoPay] Verification error:', e);
        return false;
    }
};
