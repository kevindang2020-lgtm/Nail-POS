// mobile.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–66): this app's push client, push-tap / universal-link routing
// and route table, on the ONE shared implementation (@aipowersalon/mobile-sdk createMobileShell). Replaces lib/push.ts and
// api/pushApi.ts. Only the route table below is the Customer app's own.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { createMobileShell, useMobileRoutes } from '@aipowersalon/mobile-sdk';
import { api } from '../api/client';

export const mobile = createMobileShell({ app: 'customer', pushApp: 'customer', http: api, pushPlugin: PushNotifications, appPlugin: CapApp });

/** Mounted only for a SIGNED-IN customer (never for a guest): which screen each push / link route opens. A route not
 *  listed never opens here; the screen loads through the API, which authorizes the data (an appointment id that is not
 *  this customer's is a 404 there). */
export function CustomerMobileRoutes(): null {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useMobileRoutes(mobile, {
    appointments: () => navigate('/appointments'),
    appointment: (r) => navigate(r.params.appointmentId ? `/appointments/${encodeURIComponent(r.params.appointmentId)}` : '/appointments'),
    queue: () => navigate('/queue'),
    deals: () => navigate('/deals'),
    loyalty: () => navigate('/rewards'),
    receipts: () => navigate('/receipts'),
    showcase: (r) => navigate(r.params.postId ? `/nail-showcase/${encodeURIComponent(r.params.postId)}` : '/nail-showcase'),
    'community-post': (r) => navigate(r.params.postId ? `/nail-showcase/${encodeURIComponent(r.params.postId)}` : '/nail-showcase'),
    security: () => navigate('/profile/security'),
  });
  // §58 timing: opening their appointments or the live queue is the customer's first meaningful action — the one moment
  // the app asks for push permission (never at launch)
  const wantsUpdates = pathname.startsWith('/appointments') || pathname === '/queue';
  useEffect(() => { if (wantsUpdates) void mobile.push.noteMeaningfulAction(); }, [wantsUpdates]);
  return null;
}
