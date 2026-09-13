// Firebase Admin SDK (server only): verifies sessions, owns Firestore `users`, sends FCM.
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

/** FIREBASE_SERVICE_ACCOUNT: service-account JSON, raw or base64. Else GOOGLE_APPLICATION_CREDENTIALS. */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'simulator-aaa80';
  if (raw) {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return initializeApp({ credential: cert(JSON.parse(json)), projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

export const adminAuth = () => getAuth(app());
export const firestore = () => getFirestore(app());
export const messaging = () => getMessaging(app());
