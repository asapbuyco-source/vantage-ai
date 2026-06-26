import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "firebase/firestore";

// Configuration using Vite Environment Variables with provided fallbacks
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
// Check if app is already initialized to avoid hot-reload errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const enableFirestorePersistence = (() => {
  let enabled = false;
  return async () => {
    if (enabled) return;
    try {
      await enableMultiTabIndexedDbPersistence(db);
      enabled = true;
    } catch (err: any) {
      if (err.code === 'failed-precondition') {
        console.warn('[Firestore] Multi-tab conflict — using memory cache. Predictions still load from network.');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firestore] IndexedDB not available — using memory cache.');
      }
    }
  };
})();

// Log successful initialization (Safe for production, only shows first few chars or length)
const apiKeyStatus = firebaseConfig.apiKey ? `Loaded (${firebaseConfig.apiKey.length} chars)` : "MISSING";
console.log(`Firebase initialized. Project: ${firebaseConfig.projectId}, API Key: ${apiKeyStatus}`);