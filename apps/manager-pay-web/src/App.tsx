import { useEffect, useState } from 'react';
import { PayNavProvider, usePayNav } from './shell/nav';
import { PayLayout } from './shell/PayLayout';
import { LoginScreen } from './screens/LoginScreen';
import { authApi, type Principal } from './api/authApi';
import { mobileCheckoutApi } from './api/mobileCheckoutApi';
import { DEVICE_ID } from './util/session';
import { isTapToPayAvailable } from './native/tapToPay';
import { registerPushToken } from './lib/push';
import { CheckoutQueueScreen } from './screens/CheckoutQueueScreen';
import { TicketScreen } from './screens/TicketScreen';
import { TapToPayScreen } from './screens/TapToPayScreen';
import { SuccessScreen } from './screens/SuccessScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ReportsScreen } from './screens/ReportsScreen';

function CurrentScreen() {
  const nav = usePayNav();
  const top = nav.top;
  if (top?.kind === 'ticket') return <TicketScreen ticketId={top.ticketId} />;
  if (top?.kind === 'tapToPay') return <TapToPayScreen ticketId={top.ticketId} idempotencyKey={top.idempotencyKey} amountCents={top.amountCents} />;
  if (top?.kind === 'success') return <SuccessScreen ticketId={top.ticketId} amountCents={top.amountCents} />;
  switch (nav.tab) {
    case 'checkout': return <CheckoutQueueScreen />;
    case 'history': return <HistoryScreen />;
    case 'reports': return <ReportsScreen />;
    case 'account': return <AccountScreen />;
    default: return <CheckoutQueueScreen />;
  }
}

import { AnimatedSplash } from './components/AnimatedSplash';

function Gate({ principal, setPrincipal }: { principal: Principal | null | undefined; setPrincipal: (p: Principal | null) => void }) {
  if (principal === undefined) return <div className="pay-boot" aria-busy="true" />;
  if (!principal) return <LoginScreen onAuthed={setPrincipal} />;

  return (
    <PayNavProvider>
      <PayLayout>
        <CurrentScreen />
      </PayLayout>
    </PayNavProvider>
  );
}

export function App() {
  // Auth gate. No session → the Manager Tap to Pay login; a valid session → the payment app. The principal is
  // resolved server-side from the session cookie (web) / Keychain token (native); the app never assigns a role.
  const [principal, setPrincipal] = useState<Principal | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void authApi.me()
      .then((p) => { if (alive) setPrincipal(p); })
      .catch(() => { if (alive) setPrincipal(null); });
    return () => { alive = false; };
  }, []);

  // A session can die underneath us — it expires, or is REVOKED server-side ("sign out other devices" / an admin
  // killing a compromised session). The API client clears the Keychain token and announces the 401 via this event;
  // drop the principal so the login screen renders instead of leaving the manager stuck in a shell where every
  // request 401s. (This app holds its principal here rather than in an AuthContext, so the listener lives here.)
  useEffect(() => {
    const onUnauthorized = () => setPrincipal(null);
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);

  // On sign-in, register this device (lands 'pending' until an owner/Super Admin approves it). Fire-and-forget:
  // registration must never block the app, and payment stays blocked server-side until the device is 'active'.
  useEffect(() => {
    if (!principal) return;
    let capable = false; try { capable = isTapToPayAvailable(); } catch { capable = false; }
    void mobileCheckoutApi.registerDevice({
      deviceId: DEVICE_ID, platform: 'ios',
      appVersion: (import.meta as any)?.env?.VITE_APP_VERSION || undefined,
      tapToPayCapable: capable,
    }).catch(() => { /* non-blocking */ });
    // Also register this device's push token (payment/checkout alerts when backgrounded). No-op on web; best-effort.
    void registerPushToken();
  }, [principal]);

  return (
    <>
      <AnimatedSplash isReady={principal !== undefined} />
      <Gate principal={principal} setPrincipal={setPrincipal} />
    </>
  );
}

