// mobile-shell.ts — BUILD_PLAN Phase 13 D: one object per app that ties the push client, the route gate and app links
// together, so each app only declares its ROUTE TABLE (which in-app screen a route name opens).
//
//   const mobile = createMobileShell({ app: 'tech', pushApp: 'tech', http: api, pushPlugin: PushNotifications, appPlugin: App });
//   mobile.start()                         — once at boot: universal links (native) / ?link= (web)
//   useMobileRoutes(mobile, { queue: … })  — inside the SIGNED-IN tree: binds the route table; a pending tap / link opens
//   mobile.push.resume() / unregister() / noteMeaningfulAction()
//
// Re-authorization (§62, §64): a route opens only while a signed-in tree has bound a table AND the table has that route —
// so a tap on a signed-out phone waits for sign-in, a route this app does not have never opens, and the screen it opens
// loads through the API, which authorizes the data. Sign-out unbinds the table and drops a pending route.
import { useEffect, useRef } from 'react';
import type { LinkAppId, PushAppId, PushRoute, PushRouteName } from '@aipowersalon/api-contracts';
import { createRouteGate, type RouteGate } from './route-gate';
import { installAppLinks, consumeWebLink, type AppPluginLike } from './app-links';
import { createPushClient, type PushClient, type PushHttp, type PushPluginLike } from '../push/push';
import { isNativePlatform } from '../capacitor-adapters';

export type RouteTable = Partial<Record<PushRouteName, (route: PushRoute) => void>>;
export interface MobileShell { gate: RouteGate; push: PushClient; bind(t: RouteTable): () => void; start(): Promise<void> }

export function createMobileShell(o: {
  app: LinkAppId; pushApp: PushAppId; http: PushHttp;
  pushPlugin?: PushPluginLike | null; appPlugin?: AppPluginLike | null;
  isNative?: () => boolean; platform?: () => 'ios' | 'android' | 'web';
}): MobileShell {
  let table: RouteTable | null = null;
  const native = o.isNative ?? isNativePlatform;
  const gate = createRouteGate({ canOpen: (r) => !!table && typeof table[r.name] === 'function', open: (r) => table![r.name]!(r) });
  const platform = o.platform ?? (() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'web';
  });
  const push = createPushClient({ app: o.pushApp, plugin: native() ? o.pushPlugin ?? null : null, http: o.http, gate, isNative: native, platform });
  return {
    gate, push,
    bind(t) { table = t; void gate.retry(); return () => { if (table === t) { table = null; gate.clear(); } }; },
    async start() {
      if (native()) await installAppLinks({ app: o.app, plugin: o.appPlugin ?? null, gate });
      else consumeWebLink(o.app, gate);
    },
  };
}

/** Bind this app's route table while the signed-in UI is mounted. The handlers may change every render; the latest wins. */
export function useMobileRoutes(shell: MobileShell, table: RouteTable): void {
  const ref = useRef(table);
  ref.current = table;
  useEffect(() => {
    const proxy: RouteTable = {};
    for (const k of Object.keys(table) as PushRouteName[]) proxy[k] = (r) => ref.current[k]?.(r);
    return shell.bind(proxy);
    // the set of route NAMES is fixed per app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell]);
}
