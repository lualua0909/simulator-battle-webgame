// FCM background notifications. Keep config in sync with src/lib/firebase.ts.
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyART86PQdaT-OZcREDWzmYU1EUO1yVfL6Q',
  authDomain: 'simulator-aaa80.firebaseapp.com',
  projectId: 'simulator-aaa80',
  storageBucket: 'simulator-aaa80.firebasestorage.app',
  messagingSenderId: '350091384350',
  appId: '1:350091384350:web:1c39f5ecbec62e054ec00f',
});

firebase.messaging().onBackgroundMessage((payload) => {
  // Messages with a `notification` block are shown by the browser already.
  if (payload.notification) return;
  const { title = 'Đại Chiến Lô Nhô', body = '' } = payload.data || {};
  self.registration.showNotification(title, { body, icon: '/icon.svg' });
});
