import { useEffect, useRef, useState } from 'react';
import { PayQueryLayer } from './lib/queryLayer';
import { PayNavProvider, usePayNav } from './shell/nav';
import { PayLayout } from './shell/PayLayout';
import { LoginScreen } from './screens/LoginScreen';
import { authApi, type Principal } from './api/authApi';
import { api } from './api/client';
import { mobileCheckoutApi } from './api/mobileCheckoutApi';
import { DEVICE_ID } from './util/session';
import { mobile, PayMobileRoutes } from './lib/mobile';
import { signOutNow } from './lib/signOut';   // Phase 13 D: the ONE push client + push-tap / link routing
import { App as CapApp } from '@capacitor/app';
import { AppLock, clearFaceId, resetBiometricFailures, reconcileFaceIdUser, syncUserLocale, setBusinessTimeZone } from '@aipowersalon/mobile-sdk';
import { CheckoutQueueScreen } from './screens/CheckoutQueueScreen';
import { TicketScreen } from './screens/TicketScreen';
import { TapToPayScreen } from './screens/TapToPayScreen';
import { SuccessScreen } from './screens/SuccessScreen';
import { HandoffScreen } from './screens/HandoffScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { type UserLocaleContext } from '@aipowersalon/api-contracts';   // C6 §97–99 (Phase 13 E): the locale wire shape
import { readActiveAttempt, clearActiveAttempt } from './util/activeAttempt';
import { PrincipalProvider, useBranchSwitchedPrincipal } from './lib/principal';
import { enrollDevice } from './device/enroll';
import { wipeDeviceIdentity } from './device/deviceKeys';
import { useDeviceStanding } from './device/deviceState';
import { listenForPairingLinks, usePendingPairingCode, takePendingPairingCode, peekPendingPairingCode, setPairingError } from './device/pairing';
import { DeviceRemovedScreen, DeviceStandingBanner } from './screens/DeviceScreens';

function CurrentScreen() {
  const nav = usePayNav();
  const top = nav.top;
  if (top?.kind === 'ticket') return <TicketScreen ticketId={top.ticketId} />;
  if (top?.kind === 'handoff') return <HandoffScreen ticketId={top.ticketId} version={top.version} subtotalCents={top.subtotalCents} balanceCents={top.balanceCents} tipCents={top.tipCents} salonName={top.salonName} />;
  if (top?.kind === 'tapToPay') return <TapToPayScreen ticketId={top.ticketId} idempotencyKey={top.idempotencyKey} amountCents={top.amountCents} handoff={top.handoff} recovered={top.recovered} />;
  if (top?.kind === 'verifying') return <TapToPayScreen ticketId={top.ticketId} idempotencyKey={top.idempotencyKey} amountCents={top.amountCents} handoff={top.handoff} recovered />;
  if (top?.kind === 'success') return <SuccessScreen ticketId={top.ticketId} amountCents={top.amountCents} handoff={top.handoff} cardBrand={top.cardBrand} cardLast4={top.cardLast4} paymentId={top.paymentId} />;
  switch (nav.tab) {
    case 'checkout': return <CheckoutQueueScreen />;
    case 'history': return <HistoryScreen />;
    case 'reports': return <ReportsScreen />;
    case 'account': return <AccountScreen />;
    default: return <CheckoutQueueScreen />;
  }
}

/** Mandate §130–§131 / §160: on launch, an intent that was in flight when the app died is RESTORED and verified on the
 *  Tap to Pay screen in recovery mode — the backend is asked what happened; no new charge starts. */
function RelaunchRecovery() {
  const nav = usePayNav();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const a = readActiveAttempt();
    if (!a) return;
    void mobileCheckoutApi.getAttempt?.(a.idempotencyKey)?.then((att) => {
      if (att.recoverable) nav.openTapToPay(a.ticketId, a.idempotencyKey, att.amountCents || a.amountCents, { handoff: a.handoff, recovered: true });
      else clearActiveAttempt();
    }).catch((e: any) => { if (e?.status === 404) clearActiveAttempt(); /* otherwise keep it: verify next launch */ });
  }, [nav]);
  return null;
}

export function App() {
  // Auth gate. No session → the Manager Tap to Pay login; a valid session → the payment app. The principal is
  // resolved server-side from the session cookie (web) / Keychain token (native); the app never assigns a role.
  const [principal, setPrincipal] = useState<Principal | null | undefined>(undefined);
  useEffect(() => { let alive = true; void authApi.me().then((p) => { if (alive) setPrincipal(p); }); return () => { alive = false; }; }, []);

  // A session can die underneath us — it expires, or is REVOKED server-side ("sign out other devices" / an admin
  // killing a compromised session). The API client clears the Keychain token and announces the 401 via this event;
  // drop the principal so the login screen renders instead of leaving the manager stuck in a shell where every
  // request 401s. (This app holds its principal here rather than in an AuthContext, so the listener lives here.)
  useEffect(() => {
    // Phase 13 D (C6 §35, bug 2): a dead session ends Face ID on this device too (the client already wiped the token)
    const onUnauthorized = () => { void clearFaceId(); setPrincipal(null); };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);

  // Mandate §120: More → Branch switched location — the principal (and so the data layer + device registration) follows.
  useBranchSwitchedPrincipal(setPrincipal);

  // Secure Tap to Pay M6-4: a POS pairing QR / link that opened (or launched) the app is held in memory until sign-in.
  useEffect(() => { let off: (() => void) | null = null; void listenForPairingLinks(CapApp as any).then((f) => { off = f; }); return () => { off?.(); }; }, []);
  const pairingCode = usePendingPairingCode();
  const standing = useDeviceStanding();
  const [enrollTick, setEnrollTick] = useState(0);
  const standingRef = useRef(standing); standingRef.current = standing;
  const pairNow = principal ? pairingCode : null;   // a code that arrives while signed in pairs at once

  // On sign-in, register this device WITH its P-256 public key (signed by that key — device/enroll.ts). Lands 'pending'
  // until the owner approves it, unless a POS pairing code pre-approves it for this location. Never blocks the app:
  // payment stays refused server-side until the phone is 'active', and the standing banner says so in plain English.
  useEffect(() => {
    if (!principal || standingRef.current === 'removed') return;
    // a pending POS pairing code is presented by the effect below instead (one registration, never two racing)
    if (!peekPendingPairingCode()) void enrollDevice().catch(() => { /* surfaced by the standing banner / the next payment's plain-English refusal */ });
    // Also register this device's push token (payment/checkout alerts when backgrounded). No-op on web; best-effort.
    void mobile.push.resume();   // Phase 13 D: never prompts here (§58 timing — the first payment does)
    void reconcileFaceIdUser((principal as any).userId);   // §36: another person's Face ID on this phone is cleared
  }, [principal, enrollTick]);
  // A pairing code (QR link) while signed in: a pairing code is for a NEW phone, so this phone takes a fresh id + key and
  // registers with the code (pre-approved for that location). A refused code is explained on More → Pair with the salon.
  useEffect(() => {
    if (!pairNow || standingRef.current === 'removed') return;
    const code = takePendingPairingCode();
    if (!code) return;
    setPairingError(null);
    void (async () => { await wipeDeviceIdentity(); await enrollDevice({ pairingCode: code }); })().catch((e: any) => setPairingError(String(e?.message || '')));
  }, [pairNow]);

  // Mandate §149: the registered phone reports it is alive every minute (the POS "Mobile Payments ● Online" card)
  useEffect(() => {
    if (!principal || standing === 'removed') return;
    const beat = () => { void mobileCheckoutApi.heartbeat?.(DEVICE_ID, (import.meta as any)?.env?.VITE_APP_VERSION || undefined)?.catch(() => { /* best-effort */ }); };
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) beat(); }, 60_000);
    return () => clearInterval(id);
  }, [principal, standing]);

  // C6 §97–99 (Phase 13 E): the manager's saved language + the branch time zone; signed out → device zone.
  // Kevin (Oct 28 2026): only the POS is bilingual — Manager Pay is English; the branch time zone still comes from the server
  useEffect(() => { if (principal) void syncUserLocale(async () => ({ ...(await api.get<UserLocaleContext>('/pos/me/locale')), language: 'en' as const })); else setBusinessTimeZone(null); }, [principal]);

  // a session RESTORED at launch vs one just signed in with a password (the launch lock applies to the first only)
  const restoredRef = useRef<boolean | null>(null);
  if (principal !== undefined && restoredRef.current === null) restoredRef.current = !!principal;
  // the lock screen's "Sign in again": the same order as Account → Sign out (push hand-back while the session exists)
  const signOut = () => signOutNow();   // lib/signOut.ts — the one sign-out (also the §12 forced full sign-in)

  // BUILD_PLAN Phase 13: the server-state layer wraps every state, so a sign-out (principal → null) wipes it.
  const body = principal === undefined ? <div className="pay-boot" aria-busy="true" />
    // M6-4: a phone the owner removed stays locked to this screen (relaunch included) until staff set it up again
    : standing === 'removed' ? <DeviceRemovedScreen onSetUpAgain={() => setEnrollTick((n) => n + 1)} onSignOut={principal ? () => { void signOut(); } : undefined} />
    : !principal ? <LoginScreen onAuthed={(p) => { resetBiometricFailures(); setPrincipal(p); }} />
    : (
      // Phase 13 D (C6 §179, §245–246): neutral cover in the app switcher; locks after 3 idle minutes (Face ID / device
      // passcode to unlock) and, on a phone with Face ID on, when a restored session opens the app
      <AppLock active privacyScreen idleMinutes={3} maxBiometricFailures={3} lockOnLaunch={restoredRef.current ? 'when-enrolled' : false} plugin={CapApp} onSignOut={() => { void signOut(); }} label="AIPowerSalon Pay">
        <PrincipalProvider value={principal}>
          <PayNavProvider>
            <PayMobileRoutes />
            <RelaunchRecovery />
            <PayLayout>
              <DeviceStandingBanner />
              <CurrentScreen />
            </PayLayout>
          </PayNavProvider>
        </PrincipalProvider>
      </AppLock>
    );
  return <PayQueryLayer principal={principal ?? null}>{body}</PayQueryLayer>;
}
