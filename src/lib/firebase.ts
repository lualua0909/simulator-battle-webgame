'use client';
// Firebase web SDK (browser only). The web config is public by design; access is enforced server-side.
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyART86PQdaT-OZcREDWzmYU1EUO1yVfL6Q',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'simulator-aaa80.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'simulator-aaa80',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'simulator-aaa80.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '350091384350',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:350091384350:web:1c39f5ecbec62e054ec00f',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-PEFJBVBYH8',
};

export const firebaseApp = () => (getApps().length ? getApp() : initializeApp(firebaseConfig));

export function firebaseAuth() {
  const auth = getAuth(firebaseApp());
  auth.languageCode = 'vi';
  return auth;
}

export const googleProvider = () => new GoogleAuthProvider();

/** Asks notification permission and returns this device's FCM token (null if unsupported/denied/unconfigured). */
export async function getFcmToken(ask: boolean): Promise<string | null> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey || !('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) return null;
  if (Notification.permission === 'default' && ask) await Notification.requestPermission();
  if (Notification.permission !== 'granted') return null;
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  return getToken(getMessaging(firebaseApp()), { vapidKey, serviceWorkerRegistration: registration });
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'Email không hợp lệ',
  'auth/invalid-credential': 'Sai email hoặc mật khẩu',
  'auth/wrong-password': 'Sai email hoặc mật khẩu',
  'auth/user-not-found': 'Không tìm thấy tài khoản',
  'auth/user-disabled': 'Tài khoản đã bị khoá',
  'auth/email-already-in-use': 'Email đã được dùng',
  'auth/weak-password': 'Mật khẩu tối thiểu 6 ký tự',
  'auth/too-many-requests': 'Thử quá nhiều lần, đợi một lát',
  'auth/network-request-failed': 'Lỗi mạng',
  'auth/popup-blocked': 'Trình duyệt chặn cửa sổ Google',
  'auth/account-exists-with-different-credential': 'Email này đã đăng ký bằng cách khác',
};

export function authErrorMessage(e: unknown): string | null {
  const code = (e as { code?: string })?.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  return (code && AUTH_ERRORS[code]) || (e instanceof Error ? e.message : String(e));
}
