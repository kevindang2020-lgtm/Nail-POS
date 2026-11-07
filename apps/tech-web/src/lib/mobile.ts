// mobile.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–66): this app's push client, push-tap / universal-link routing
// and route table, on the ONE shared implementation (@aipowersalon/mobile-sdk createMobileShell). Replaces lib/push.ts
// and techApi.registerPush / unregisterPush. Only the route table below is the Technician app's own.
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { createMobileShell, useMobileRoutes } from '@aipowersalon/mobile-sdk';
import { api } from '../api/client';
import { useTechNav } from '../shell/nav';

export const mobile = createMobileShell({ app: 'tech', pushApp: 'tech', http: api, pushPlugin: PushNotifications, appPlugin: CapApp });

/** Mounted inside the signed-in tree (TechNavProvider): which screen each push / link route opens. A route not listed
 *  here never opens in this app; the screen loads through the API, which authorizes the data. */
export function TechMobileRoutes(): null {
  const nav = useTechNav();
  useMobileRoutes(mobile, {
    queue: () => nav.openQueue(),
    'queue-ticket': (r) => (r.params.techQueueTicketId ? nav.openTicket(r.params.techQueueTicketId) : nav.openQueue()),
    schedule: () => { nav.back(); nav.go('schedule'); },
    // merged Nov 7 2026 (the developer tree's route table): appointment links open the schedule; alerts and deals their screens
    appointments: () => { nav.back(); nav.go('schedule'); },
    appointment: () => { nav.back(); nav.go('schedule'); },
    payroll: () => nav.openPayroll(),
    alerts: () => nav.openNotifications(),
    deals: () => nav.openMyDeals(),
    security: () => nav.openSettings(),
  });
  return null;
}
