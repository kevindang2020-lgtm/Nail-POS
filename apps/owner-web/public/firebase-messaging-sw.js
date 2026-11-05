importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyBfBQJ7Tlrv2aNc5MEtbvwE6uLFO3dbt9c",
  authDomain: "ai-power-salon-71823.firebaseapp.com",
  projectId: "ai-power-salon-71823",
  storageBucket: "ai-power-salon-71823.firebasestorage.app",
  messagingSenderId: "302674373949",
  appId: "1:302674373949:web:bb41b69715a36f18e1a954",
  measurementId: "G-49G251SNGJ"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || '',
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
