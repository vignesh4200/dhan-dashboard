import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Server-only. FIREBASE_PRIVATE_KEY comes from your Firebase service account JSON —
// paste it into .env with \n escaped (most hosts, including Vercel, handle this fine
// if you wrap the value in quotes and keep the literal \n sequences).
function initAdmin() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const app = initAdmin();
export const firebaseAdminAuth = getAuth(app);
