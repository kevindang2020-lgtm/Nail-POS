// mobile.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–66): this app's push client, push-tap / universal-link routing
// and route table, on the ONE shared implementation (@aipowersalon/mobile-sdk createMobileShell). Replaces lib/push.ts and
// api/pushApi.ts. The push app id stays 'manager' (APNS_TOPIC_MANAGER, existing device_push_tokens rows).
import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { createMobileShell, useMobileRoutes } from '@aipowersalon/mobile-sdk';
import { api } from '../api/client';
import { usePayNav } from '../shell/nav';

export const mobile = createMobileShell({ app: 'manager-pay', pushApp: 'manager', http: api, pushPlugin: PushNotifications, appPlugin: CapApp });

/** Mounted inside the signed-in tree: which tab each push / link route opens (this app has no approvals screen — an
 *  approval push opens nothing here; the Owner app / POS handle it). */
export function PayMobileRoutes(): null {
  const nav = usePayNav();
  useMobileRoutes(mobile, {
    checkout: () => nav.resetToCheckout(),
    alerts: () => nav.resetToCheckout(),
    security: () => nav.go('account'),
    // merged Nov 7 2026 (the developer tree's route table)
    queue: () => nav.resetToCheckout(),
    receipts: () => nav.go('history'),
  });
  // §58 timing: the first completed payment is the manager's first meaningful action — the moment the app asks for push
  const paid = nav.top?.kind === 'success';
  useEffect(() => { if (paid) void mobile.push.noteMeaningfulAction(); }, [paid]);
  return null;
}
