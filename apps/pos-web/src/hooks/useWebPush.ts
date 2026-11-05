import { useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { api } from '../api/client';
const firebaseConfig = {
  apiKey: "AIzaSyBfBQJ7Tlrv2aNc5MEtbvwE6uLFO3dbt9c",
  authDomain: "ai-power-salon-71823.firebaseapp.com",
  projectId: "ai-power-salon-71823",
  storageBucket: "ai-power-salon-71823.firebasestorage.app",
  messagingSenderId: "302674373949",
  appId: "1:302674373949:web:bb41b69715a36f18e1a954",
  measurementId: "G-49G251SNGJ"
};

const VAPID_KEY = "BJq7xD1DPmqV8uVQhJnVUyJAIsP0de6WBtN4rIctGMKWN3ArC-OPNd1wdK4frGyY_p40elUXtG0nSeSBRqrDwz8";

export function useWebPush(tenantId?: string, userType?: string, userId?: string) {
  useEffect(() => {
    if (!tenantId || !userType || !userId) return;

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      console.warn('This browser does not support desktop notifications.');
      return;
    }

    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    const requestPermissionAndGetToken = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
          if (currentToken) {
            console.log('Web Push Token:', currentToken);
            // Register token with backend via authenticated client
            await api.post('/push/register', {
              platform: 'web',
              token: currentToken,
              app: 'pos'
            });
          }
        }
      } catch (err) {
        console.error('An error occurred while retrieving token.', err);
      }
    };

    requestPermissionAndGetToken();

    const unsubscribe = onMessage(messaging, (payload) => {
      console.log('Message received in foreground: ', payload);
      window.dispatchEvent(new CustomEvent('aps:notification', { detail: payload }));
      
      if (Notification.permission === 'granted') {
        const title = payload.notification?.title || payload.data?.title || 'New Notification';
        const options = {
          body: payload.notification?.body || payload.data?.body || '',
          icon: '/favicon.ico'
        };
        new Notification(title, options);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [tenantId, userType, userId]);
}
