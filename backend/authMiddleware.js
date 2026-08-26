import admin from "firebase-admin";

// 10s guard: Firebase's JWKS fetch can hang on some networks (IPv6/DNS).
// A hanging middleware shows up in the browser as "Failed to fetch" —
// better to fail fast with a clear 401/503.
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("verifyIdToken timed out")), ms)),
  ]);

export async function requireFirebaseUser(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Firebase ID token" });
    if (!admin.apps.length) return res.status(503).json({ error: "Firebase Admin not initialized" });

    const decoded = await withTimeout(admin.auth().verifyIdToken(token), 10000);
    req.firebaseUser = decoded;
    next();
  } catch (e) {
    if (e.message === "verifyIdToken timed out") {
      return res.status(503).json({ error: "Auth verification timed out — retry" });
    }
    return res.status(401).json({ error: "Invalid or expired Firebase ID token" });
  }
}