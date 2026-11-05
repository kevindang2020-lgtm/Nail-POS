// App.tsx — the customer-facing display. A PAIRED display on a landscape screen is the 23-inch dual-screen layout
// (Display23: check-in left/centre, the dynamic right panel — the salon's ads ↔ the live checkout). A one-off session
// display, or a portrait tablet, shows one thing at a time with the SAME pieces (CheckoutPanel.tsx, GoCheckIn.tsx).
// Every screen renders the server's CustomerDisplayState (useDisplay); the customer only picks a tip / a method / a
// rating; the front desk takes payment on the POS.
import { useEffect, useState, type ReactNode } from 'react';
import type { CustomerDisplayBranding, CustomerDisplayState, DisplayReportedMode, TipOption } from '@aipowersalon/api-contracts/customer';
import { customerDisplayMode, reportedModeFor, type CustomerDisplayMode, type DisplayCheckInStep } from '@aipowersalon/api-contracts';
import { idleShell, useDisplay } from './useDisplay';
import { recallSalon } from './salonMemory';
import { useViewport } from './useViewport';
import { useAdPlaylist, type AdPlayback } from './useAdPlaylist';
import { GoCheckIn } from './GoCheckIn';
import { Display23 } from './Display23';
import { SalonBrand } from './Branding';
import { ReceiptCard, StatusCard, SuccessCard, TicketView, TipAndPay, type CheckoutActions } from './CheckoutPanel';
import { FullscreenButton, Maintenance, Pairing } from './DeviceScreens';
import { useCredentials } from './useCredentials';
import { PhoneCodePad } from './PhoneCodePad';
import { useHeartbeat } from './useHeartbeat';
import type { Creds } from './api';
import { availableLanguages, LanguageProvider, LanguageSwitch, useT, type DisplayLanguage } from './i18n';

function Brand({ salon, branding }: { salon?: string; branding?: CustomerDisplayBranding }) {
  return (
    <header className="kiosk-brand">
      <SalonBrand branding={branding} salonName={salon || ''} />
      <LanguageSwitch className="lang-switch kiosk-lang" />
    </header>
  );
}

function Center({ children, salon, branding }: { children: React.ReactNode; salon?: string; branding?: CustomerDisplayBranding }) {
  return (
    <div className="kiosk-app">
      <Brand salon={salon} branding={branding} />
      <main className="kiosk-main kiosk-center">{children}</main>
    </div>
  );
}

// ---- status screens ----
function Connecting() {
  const t = useT();
  return (
    <Center>
      <div className="kiosk-status"><div className="kiosk-spinner" /><div className="kiosk-sub">{t('app.connecting')}</div></div>
    </Center>
  );
}
function Waiting({ s, offline = false }: { s: CustomerDisplayState; offline?: boolean }) {
  const t = useT();
  return (
    <Center salon={s.salonName} branding={s.branding}>
      <div className="kiosk-status">
        <div className="kiosk-welcome serif">{t('app.welcome')}</div>
        <div className="kiosk-sub">{offline ? t('app.offline') : s.branding?.idleMessage || t('app.waiting')}</div>
      </div>
    </Center>
  );
}
function Expired({ salon }: { salon: string }) {
  const t = useT();
  return (
    <Center salon={salon}>
      <div className="kiosk-status">
        <div className="kiosk-glyph muted">◷</div>
        <div className="kiosk-h serif">{t('app.expired.h')}</div>
        <div className="kiosk-sub">{t('app.expired.s')}</div>
      </div>
    </Center>
  );
}

// ---- the single-column checkout (portrait / one-off display): the ticket above the tip ----
function Review({ s, a }: { s: CustomerDisplayState; a: CheckoutActions }) {
  return (
    <div className="kiosk-app">
      <Brand salon={s.salonName} branding={s.branding} />
      <main className="kiosk-main">
        <div className="kiosk-review">
          <TicketView s={s} />
          <TipAndPay s={s} a={a} />
        </div>
      </main>
    </div>
  );
}

/** Dual-Screen mandate §11–§12: the display's ONE state model (packages/api-contracts display-mode.ts) over what this
 *  display knows — the server's state, the guest's check-in step, whether the server answers, and a phone-change code the
 *  front desk asked for (until the guest entered it or tapped Not now). Null until the server first answers. */
export function appMode(d: CustomerDisplayState | null, x: { checkInStep: DisplayCheckInStep; online: boolean; padDone: string | null }): CustomerDisplayMode | null {
  if (!d) return null;
  const phoneCode = !!d.phoneVerification && x.padDone !== d.phoneVerification.maskedPhone;
  return customerDisplayMode({ checkoutState: d.state, checkInStep: x.checkInStep, phoneCode, maintenance: !!d.maintenance, online: x.online });
}

/** §85–§86: what the heartbeat reports — the model's mode in the device table's vocabulary. */
export function reportedMode(mode: CustomerDisplayMode | null, ads: Pick<AdPlayback, 'panelAds'> | null): DisplayReportedMode | null {
  return mode ? reportedModeFor(mode, !!ads && ads.panelAds.length > 0) : null;
}

/**
 * The display's credential decides what runs (23-inch spec §8–§12): none → it pairs itself; a one-off session link →
 * that checkout; a paired display → the 23-inch dual-screen layout. A revoked display forgets its credential and pairs again.
 */
export function App() {
  const cred = useCredentials();
  if (cred.status === 'loading') return <Connecting />;
  if (cred.status === 'unpaired' || !cred.creds) return <><Pairing onPaired={(t) => { void cred.paired(t); }} /><FullscreenButton /></>;
  // a revoked display unmounts through its pairing screen, so a new pairing always starts the display from nothing
  return <DisplayApp key={cred.creds.mode === 'device' ? 'device' : `session:${cred.creds.sessionId}`} creds={cred.creds} onRevoked={() => { void cred.forget(); }} />;
}

function DisplayApp({ creds: credsIn, onRevoked }: { creds: Creds; onRevoked: () => void }) {
  const { creds, data, phase, online, submitting, actionError, rated, adsNudge, chooseTip, chooseMethod, pay, rate, chooseReceipt, onHeartbeatAck, clearActionError } = useDisplay(credsIn, { onRevoked });
  const view = useViewport();
  const ads = useAdPlaylist(creds ?? null, adsNudge ?? 0, { panelHeight: view.h, dpr: view.dpr });
  const [checkInStep, setCheckInStep] = useState<DisplayCheckInStep>('none');
  const [padDone, setPadDone] = useState<string | null>(null);   // Phase 3: the phone-code pad the customer closed
  const mode = appMode(data, { checkInStep, online, padDone });
  useHeartbeat(creds, reportedMode(mode, ads), onHeartbeatAck);

  // §118–§119: the languages the salon turned on (the first is its default). A guest may switch for their own visit; the
  // screen goes back to the salon's default once nobody is using it (the next guest never inherits the last one's).
  const available = availableLanguages(data?.languages);
  const fallbackLang = available[0];
  const [chosen, setChosen] = useState<DisplayLanguage | null>(null);
  const resting = mode === null || mode === 'ADVERTISEMENT' || mode === 'OFFLINE' || mode === 'MAINTENANCE';
  useEffect(() => { if (resting) setChosen(null); }, [resting]);
  const lang = chosen && available.includes(chosen) ? chosen : fallbackLang;
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* no document */ } }, [lang]);   // §92: screen readers
  const wrap = (n: ReactNode) => <LanguageProvider value={{ lang, available, setLang: setChosen }}>{n}</LanguageProvider>;

  const onTip = (o: TipOption) =>
    chooseTip(o.tipType === 'percent' ? { tipType: 'percent', percent: o.percent } : o.tipType === 'custom' ? { tipType: 'custom', amountCents: o.amountCents } : { tipType: 'none' });
  const a: CheckoutActions = { submitting, actionError, rated, onTip, onTechTips: (b) => chooseTip(b), onMethod: chooseMethod, onPay: pay, onRate: rate, onReceipt: (c) => { void chooseReceipt(c); }, onClearError: clearActionError };

  if (phase === 'forbidden') return wrap(<Expired salon="" />);
  if (!data || !mode) {
    // §72: a 23-inch display that (re)starts while the server cannot be reached still shows its salon and the advertising
    // it saved — never a spinner for the whole outage. No customer, no check-in until the server answers again.
    const mem = phase === 'error' && creds?.mode === 'device' && view.wide ? recallSalon() : null;
    if (mem || (phase === 'error' && creds?.mode === 'device' && view.wide && ads.usable)) {
      return wrap(<Display23 d={idleShell(mem ? { salonName: mem.salonName, payButtonEnabled: false, branding: mem.branding } : null)} a={a} ads={ads} offline />);
    }
    return wrap(<Connecting />);
  }

  // BUILD_PLAN Phase 3: staff asked this customer to type their phone-change code here — below a checkout (§12), above
  // everything else; the POS side keeps its own code entry either way.
  if (mode === 'PHONE_VERIFICATION' && data.phoneVerification && creds?.mode === 'device') {
    const masked = data.phoneVerification.maskedPhone;
    return wrap(<><PhoneCodePad creds={creds} maskedPhone={masked} onDone={() => setPadDone(masked)} /><FullscreenButton /></>);
  }

  // §85 MAINTENANCE: the owner is servicing this display — no check-in, no advertising (a checkout still outranks it)
  if (mode === 'MAINTENANCE') return wrap(<><Maintenance s={data} /><FullscreenButton /></>);

  // the 23-inch dual-screen layout: a paired display on a landscape screen. OFFLINE (§81): the salon and its cached
  // advertising, check-in replaced by "please see the receptionist" — a checkout already on screen stays (§79).
  if (creds?.mode === 'device' && view.wide) return wrap(<><Display23 d={data} a={a} ads={ads} deviceToken={creds.deviceToken} offline={mode === 'OFFLINE'} onCheckInStep={setCheckInStep} /><FullscreenButton /></>);

  switch (data.state) {
    case 'idle':
    case 'disconnected':
      // A paired display checks its guests in between customers — with its OWN credential (§8, §12, §18), whenever the
      // server says check-in is on for its branch (and answers: §81); otherwise a welcome.
      return data.checkIn && creds?.mode === 'device' && mode !== 'OFFLINE'
        ? wrap(<GoCheckIn deviceToken={creds.deviceToken} salon={data.salonName} branding={data.branding} />)
        : wrap(<Waiting s={data} offline={mode === 'OFFLINE'} />);
    case 'ticket_review':
    case 'tip_selected':
      return wrap(<Review s={data} a={a} />);
    case 'payment_processing':
    case 'payment_verifying':
    case 'payment_failed':
    case 'expired':
      return wrap(<Center salon={data.salonName} branding={data.branding}><StatusCard s={data} /></Center>);
    case 'payment_success':
      // the receipt choice (§97), then the thank-you (§44). No signature here: the cardholder signs on the card terminal.
      return wrap(<Center salon={data.salonName} branding={data.branding}>{data.receipt?.status === 'choose' ? <ReceiptCard s={data} a={a} /> : <SuccessCard s={data} a={a} />}</Center>);
    default:
      return wrap(<Waiting s={data} />);
  }
}
