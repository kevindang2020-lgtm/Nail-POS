// mobile-shell.ts — the Manager Tap to Pay app's deep links and push-tap routing (@aipowersalon/mobile-sdk createMobileShell).
//
// A universal link / App Link (native, via @capacitor/app `appUrlOpen`), the `?link=` the API's not-installed fallback
// adds on the web, and a tapped push notification all become ONE typed route (a name from a closed list + id params).
// The route only names a destination: it opens through the route table the signed-in UI binds (useMobileRoutes), so a
// tap on a signed-out phone waits for sign-in, and the screen it opens loads through the API, which authorizes again.
import { App as CapacitorApp } from '@capacitor/app';
import { createMobileShell, useMobileRoutes, type RouteTable } from '@aipowersalon/mobile-sdk';
import { routeFromPushData } from '@aipowersalon/api-contracts';
import { transport } from '../api/client';

export const mobileShell = createMobileShell({ app: 'manager-pay', pushApp: 'manager', http: transport, appPlugin: CapacitorApp });

/** A tapped push (native or local notification): its data → a typed route → the gate. Unknown / malformed data is ignored. */
export function openPushRoute(data: unknown): void {
  void mobileShell.gate.request(routeFromPushData((data ?? null) as Record<string, unknown> | null));
}

/** Bind this app's route table while the signed-in UI is mounted. */
export function useAppRoutes(table: RouteTable): void {
  useMobileRoutes(mobileShell, table);
}
