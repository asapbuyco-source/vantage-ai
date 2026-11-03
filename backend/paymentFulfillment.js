import admin from "firebase-admin";
import { PLAN_CONFIG, getVipExpiry } from "./paymentPlans.js";

export async function fulfillVipPayment({
  uid,
  provider,
  transactionId,
  plan,
  amount,
  raw = {},
}) {
  if (!admin.apps.length) {
    const err = new Error("Firebase Admin not initialized");
    err.status = 503;
    throw err;
  }

  const db = admin.firestore();
  const txRef = db.collection("payment_transactions").doc(`${provider}_${transactionId}`);
  const userRef = db.collection("profiles").doc(uid);

  return db.runTransaction(async (tx) => {
    const existingTx = await tx.get(txRef);
    if (existingTx.exists) {
      return { alreadyProcessed: true, plan: existingTx.data().plan };
    }

    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      const err = new Error("User profile not found");
      err.status = 404;
      throw err;
    }

    const user = userSnap.data();
    const planCfg = PLAN_CONFIG[plan];
    if (!planCfg) {
      const err = new Error("Invalid plan");
      err.status = 400;
      throw err;
    }

    const paidAmount = Number(amount || planCfg.amount) || 0;
    const firstPayment = !(Number(user.totalPaid) > 0);

    // ── Reads first (Firestore requires all reads before writes) ───────────────
    // Promo code / influencer code stored on the buyer's profile (from signup or
    // from the code entered at payment in the app).
    const promoCode = String(user.appliedPromoCode || "").trim().toUpperCase();
    let promoRef = null;
    let promoDoc = null;
    if (promoCode) {
      promoRef = db.collection("referral_codes").doc(promoCode);
      const promoSnap = await tx.get(promoRef);
      if (promoSnap.exists) promoDoc = promoSnap.data() || {};
    }

    // Referrer: signup attribution wins; otherwise the code entered at payment.
    let referrerUid = user.referredBy || (promoDoc && promoDoc.ownerUid) || null;
    if (referrerUid === uid) referrerUid = null; // no self-referral

    let referrerRef = null;
    let referrerSnap = null;
    if (referrerUid) {
      referrerRef = db.collection("profiles").doc(referrerUid);
      referrerSnap = await tx.get(referrerRef);
    }

    // Renewal must EXTEND from the current expiry, not reset from today —
    // otherwise a user renewing with 20 days left loses them.
    const now = new Date();
    const stillVip = user.isVip && user.vipExpiry && new Date(user.vipExpiry) > now;
    let expiryDate = new Date(getVipExpiry(plan, stillVip ? new Date(user.vipExpiry) : now));

    // Promo bonus: +N days on the FIRST paid subscription, once per account.
    // (Bonus access days are Play-policy compliant — the Play price is untouched.)
    const canRedeemPromo = firstPayment && !user.promoRedeemed && Boolean(referrerUid);
    const bonusDays = canRedeemPromo ? (Number(promoDoc && promoDoc.bonusDays) || 7) : 0;
    if (bonusDays > 0) {
      expiryDate = new Date(expiryDate.getTime() + bonusDays * 24 * 60 * 60 * 1000);
    }
    const expiry = expiryDate.toISOString();

    // ── Writes ────────────────────────────────────────────────────────────────
    const userUpdate = {
      isVip: true,
      vipExpiry: expiry,
      vipPlan: plan,
      totalPaid: admin.firestore.FieldValue.increment(paidAmount),
      updatedAt: new Date().toISOString(),
    };
    if (referrerUid && !user.referredBy) {
      // Attribute the influencer when the code was entered at payment time.
      userUpdate.referredBy = referrerUid;
    }
    if (canRedeemPromo) {
      userUpdate.promoRedeemed = true;
    }
    tx.update(userRef, userUpdate);

    if (canRedeemPromo && bonusDays > 0 && promoRef && promoDoc) {
      tx.update(promoRef, { redemptions: admin.firestore.FieldValue.increment(1) });
    }

    if (referrerRef && referrerSnap && referrerSnap.exists) {
      const referrer = referrerSnap.data() || {};
      // Influencer/affiliate commission: rate is admin-set on the referrer's
      // profile (0-80), default 40%. Recurring — credited on every confirmed
      // payment (initial + renewals).
      const rawRate = Number(referrer.commissionRate);
      const rate = Number.isFinite(rawRate) ? Math.max(0, Math.min(80, rawRate)) : 40;
      const commission = Math.floor(paidAmount * (rate / 100));
      if (commission > 0) {
        const referrerUpdate = {
          referralEarnings: admin.firestore.FieldValue.increment(commission),
          lifetimeEarnings: admin.firestore.FieldValue.increment(commission),
        };
        if (firstPayment) {
          // Unique paying customers (renewals don't inflate this count)
          referrerUpdate.referralPurchases = admin.firestore.FieldValue.increment(1);
        }
        tx.update(referrerRef, referrerUpdate);
        // Audit ledger — one doc per commission (disputes / accounting)
        tx.set(db.collection("referral_commissions").doc(`${provider}_${transactionId}`), {
          referrerUid,
          buyerUid: uid,
          provider,
          transactionId,
          plan,
          amount: paidAmount,
          rate,
          commission,
          bonusDays,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    tx.set(txRef, {
      uid,
      provider,
      transactionId,
      plan,
      amount: amount || planCfg.amount,
      status: "fulfilled",
      raw,
      fulfilledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { alreadyProcessed: false, plan, vipExpiry: expiry, bonusDays };
  });
}