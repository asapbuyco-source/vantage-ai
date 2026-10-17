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

    // Renewal must EXTEND from the current expiry, not reset from today —
    // otherwise a user renewing with 20 days left loses them.
    const now = new Date();
    const stillVip = user.isVip && user.vipExpiry && new Date(user.vipExpiry) > now;
    const expiry = getVipExpiry(plan, stillVip ? new Date(user.vipExpiry) : now);
    tx.update(userRef, {
      isVip: true,
      vipExpiry: expiry,
      vipPlan: plan,
      totalPaid: admin.firestore.FieldValue.increment(amount || planCfg.amount),
      updatedAt: new Date().toISOString(),
    });

    if (user.referredBy) {
      const commission = Math.floor((amount || planCfg.amount) * 0.40);
      if (commission > 0) {
        const referrerRef = db.collection("profiles").doc(user.referredBy);
        tx.update(referrerRef, {
          referralEarnings: admin.firestore.FieldValue.increment(commission),
          lifetimeEarnings: admin.firestore.FieldValue.increment(commission),
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