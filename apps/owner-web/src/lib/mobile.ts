// mobile.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–66): this app's push client, push-tap / universal-link routing
// and route table, on the ONE shared implementation (@aipowersalon/mobile-sdk createMobileShell). Replaces lib/push.ts and
// api/pushApi.ts. Only the route table below is the Owner app's own.
import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { createMobileShell, useMobileRoutes } from '@aipowersalon/mobile-sdk';
import { webPush } from './webPush';
import { api } from '../api/client';
import { useOwnerNav } from '../shell/nav';

export const mobile = createMobileShell({ app: 'owner', pushApp: 'owner', http: api, pushPlugin: PushNotifications, appPlugin: CapApp });

/** Mounted inside the signed-in tree: which screen each push / link route opens. A route not listed never opens here;
 *  the screen loads through the API, which authorizes the data. */
export function OwnerMobileRoutes(): null {
  const nav = useOwnerNav();
  // §58 timing: the owner opening Approvals or Alerts is the first meaningful action — the one moment the app asks for push
  const wantsAlerts = nav.tab === 'approvals' || nav.pushed?.kind === 'alerts';
  useEffect(() => { if (wantsAlerts) { void mobile.push.noteMeaningfulAction(); void webPush.noteMeaningfulAction(); } }, [wantsAlerts]);   // the browser build asks at the same moment (developer merge, Oct 6 2026)
  useMobileRoutes(mobile, {
    alerts: () => nav.openAlerts(),
    approvals: () => nav.go('approvals'),
    payroll: (r) => nav.openPayroll(r.params.periodId),
    security: () => nav.openSettings(),
    appointments: () => nav.openBookings(),
  });
  return null;
}
