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

    // Renewal must EXTEND from the current expiry, not reset from today —
    // otherwise a user renewing with 20 days left loses them.
    const now = new Date();
    const stillVip = user.isVip && user.vipExpiry && new Date(user.vipExpiry) > now;
    const expiry = getVipExpiry(plan, stillVip ? new Date(user.vipExpiry) : now);

    // Read the referrer BEFORE any writes (Firestore transactions require reads first).
    let referrerRef = null;
    let referrerSnap = null;
    if (user.referredBy) {
      referrerRef = db.collection("profiles").doc(user.referredBy);
      referrerSnap = await tx.get(referrerRef);
    }

    tx.update(userRef, {
      isVip: true,
      vipExpiry: expiry,
      vipPlan: plan,
      totalPaid: admin.firestore.FieldValue.increment(paidAmount),
      updatedAt: new Date().toISOString(),
    });

    if (referrerRef && referrerSnap && referrerSnap.exists) {
      const referrer = referrerSnap.data() || {};
      // Influencer/affiliate commission: rate is admin-set on the referrer's
      // profile (0-80), default 40%. Recurring — credited on every confirmed
      // payment (initial + renewals).
      const rawRate = Number(referrer.commissionRate);
      const rate = Number.isFinite(rawRate) ? Math.max(0, Math.min(80, rawRate)) : 40;
      const commission = Math.floor(paidAmount * (rate / 100));
      if (commission > 0) {
        tx.update(referrerRef, {
          referralEarnings: admin.firestore.FieldValue.increment(commission),
          lifetimeEarnings: admin.firestore.FieldValue.increment(commission),
          referralPurchases: admin.firestore.FieldValue.increment(1),
        });
        // Audit ledger — one doc per commission (disputes / accounting)
        tx.set(db.collection("referral_commissions").doc(`${provider}_${transactionId}`), {
          referrerUid: user.referredBy,
          buyerUid: uid,
          provider,
          transactionId,
          plan,
          amount: paidAmount,
          rate,
          commission,
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

    return { alreadyProcessed: false, plan, vipExpiry: expiry };
  });
}