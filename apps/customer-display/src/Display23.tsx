// Display23.tsx — the 23-inch dual-screen customer display (spec §2–§7, §13–§28, §47, §79–§80, §87–§95), Kevin's
// layout: check-in stays on the LEFT and CENTRE; the RIGHT panel (~35%) is dynamic —
//
//   no checkout ─────────────→ the salon's advertising (its playlist, or its branded panel)
//   checkout begins ─────────→ that customer's live ticket and tip (the ad is gone — not covered, gone)
//   payment in flight ───────→ the ticket and the payment status (an ad never covers a payment)
//   payment confirmed ───────→ the completed summary for 3 seconds, then the customer is destroyed (useDisplay)
//   back to ───────────────────→ advertising
//
// The salon's own brand is the header (§13); "Powered by AI PowerSalon" is a quiet footer line. One screen, no page
// scroll at any 16:9 size from 1366×768 to 1920×1080 (§3, §121) — everything is sized from the viewport (styles.css
// `--u`), and a long ticket scrolls inside its own bounded list with the totals pinned (§93–§95).
import { useEffect, useState } from 'react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import { AdFallbackPanel, AdRotator } from '@aipowersalon/ui';
import { CheckoutPanel, rightPanelMode, type CheckoutActions } from './CheckoutPanel';
import { CheckInDetails, CheckInLookup, CheckInResult } from './CheckIn23';
import { PoweredBy, SalonBrand, SalonMark } from './Branding';
import { TechnicianClockBody } from './GoCheckIn';
import { useGoCheckIn } from './useGoCheckIn';
import { checkInStepOf, useCheckInFlow } from './useCheckInFlow';
import type { DisplayCheckInStep } from '@aipowersalon/api-contracts';
import { useIdle } from './useIdle';
import type { AdPlayback } from './useAdPlaylist';
import { mediaUrl } from './api';
import { usd } from './types';
import { LanguageSwitch, useT } from './i18n';

/** How long the full-screen ads take to fade away after a touch (the touch never reaches what is underneath). */
const FULLSCREEN_EXIT_MS = 400;

export function Display23({ d, a, ads, deviceToken, offline = false, onCheckInStep }: {
  d: CustomerDisplayState; a: CheckoutActions; ads: AdPlayback;
  /** The display's own credential (a paired display): its guests check in with it (§8, §12, §18 — no kiosk needed). */
  deviceToken?: string;
  /** The server cannot be reached (§72 started without it, §81 lost it): the salon and its saved advertising only —
   *  "We're temporarily offline. Please see the receptionist." No check-in until the server answers again. */
  offline?: boolean;
  /** Mandate §11: the guest's check-in step, for the display's one state model (and the heartbeat, §85) */
  onCheckInStep?: (step: DisplayCheckInStep) => void;
}) {
  // check-in is on when the server says so for THIS display's branch (`checkIn`) — never from a kiosk's slug
  const t = useT();
  const checkInToken = !offline && d.checkIn && deviceToken ? deviceToken : null;
  const gci = useGoCheckIn(checkInToken);
  const f = useCheckInFlow(gci);
  const mode = rightPanelMode(d);
  const salonName = d.branding?.salonName || d.salonName;
  const hasCheckIn = !!checkInToken;
  // the companion keeps the guest company while they review and tip / pay; the completed thank-you is the right panel's own
  const companion = mode === 'checkout' || mode === 'payment';
  const step: DisplayCheckInStep = hasCheckIn ? checkInStepOf(f) : 'none';
  useEffect(() => { onCheckInStep?.(step); }, [step, onCheckInStep]);
  // §81: the server went away mid-check-in — there is no offline check-in, so the guest's half-typed details are
  // dropped (they start again with the receptionist, or here once the server is back), never left for the next guest
  const { reset } = f;
  useEffect(() => { if (offline) reset(); }, [offline, reset]);

  // §7: optional full-screen idle advertising — only with no checkout, nobody mid-check-in, and pictures to show
  const eligible = mode === 'ads' && ads.fullScreenIdle.enabled && ads.fullAds.length > 0 && (!hasCheckIn || f.idle);
  const idle = useIdle(eligible ? Math.max(30, ads.fullScreenIdle.afterSeconds) * 1000 : null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), FULLSCREEN_EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  const fullscreen = eligible && (idle || leaving);

  const fallback = <AdFallbackPanel salonName={salonName} logoUrl={d.branding?.logoUrl ? mediaUrl(d.branding.logoUrl) : null} lines={[t('fallback.welcome'), t('fallback.giftCards'), t('fallback.book')]} />;
  return (
    <div className="d23" data-testid="display-23" data-panel={mode} data-offline={offline ? 'true' : undefined}>
      <section className="d23-main" aria-label={t('d23.checkInAria')}>
        <header className="d23-head">
          <SalonBrand branding={d.branding} salonName={d.salonName} />
          <LanguageSwitch className="lang-switch d23-lang" />
          {hasCheckIn && f.mode === 'customer' && gci.phase === 'ready'
            ? <button type="button" className="d23-clockbtn" onClick={f.enterTechnician}>{t('d23.techClock')}</button> : null}
        </header>

        {hasCheckIn ? (
          f.mode === 'technician' ? (
            <div className="d23-cols d23-cols-one"><section className="d23-card d23-clock"><TechnicianClockBody gci={gci} salon={salonName} onExit={f.exitTechnician} /></section></div>
          ) : (
            <div className="d23-cols">
              <section className="d23-card d23-col-left"><CheckInLookup f={f} /></section>
              <section className="d23-card d23-col-center"><CheckInDetails f={f} branding={d.branding} salonName={salonName} /></section>
            </div>
          )
        ) : companion ? (
          // No check-in on this display and a checkout is on the right: the left side keeps the guest company — a thank-you,
          // the first service as a summary, and where to look (every amount is the server's; nothing is computed here)
          <div className="d23-cols d23-cols-one">
            <section className="d23-card d23-welcome-card d23-checkout-companion" data-testid="checkout-companion">
              <SalonMark branding={d.branding} salonName={salonName} className="d23-welcome-mark" />
              <div className="d23-welcome serif d23-companion-title">
                <span>{d.customer?.firstName ? t('d23.thanksName', { name: d.customer.firstName }) : t('d23.thanksSalon', { salon: salonName })}</span>
              </div>
              <p className="d23-companion-sub">{t('d23.reviewAndTip')}</p>
              {d.checkout?.lines?.length ? (
                <div className="d23-companion-summary">
                  <div className="d23-companion-summary-head">
                    <span className="lbl">{t('d23.serviceSummary')}</span>
                    <span className="num">{t('d23.orderNumber', { n: d.checkout.ticketNumber })}</span>
                  </div>
                  <div className="d23-companion-line">
                    <div>
                      <div className="nm">{d.checkout.lines[0].name}</div>
                      {d.checkout.lines[0].technicianName ? <div className="tech">{t('d23.withTech', { name: d.checkout.lines[0].technicianName })}</div> : null}
                    </div>
                    <span className="amt">{usd(d.checkout.lines[0].amountCents)}</span>
                  </div>
                </div>
              ) : null}
              <div className="d23-companion-pill">✨ {t('d23.appreciate')}</div>
            </section>
          </div>
        ) : (
          <div className="d23-cols d23-cols-one">
            <section className="d23-card d23-welcome-card">
              <SalonMark branding={d.branding} salonName={salonName} className="d23-welcome-mark" />
              <div className="d23-welcome serif"><span>{t('app.welcome')}</span></div>
              <div className="d23-note-s">{offline ? t('app.offline') : d.branding?.idleMessage || t('d23.frontDeskWelcome')}</div>
            </section>
          </div>
        )}

        <footer className="d23-foot">
          {hasCheckIn ? <CheckInResult f={f} idleMessage={d.branding?.idleMessage ?? null} /> : <div className="d23-foot-idle">{companion ? t('tip.frontDeskCompletes') : t('d23.frontDeskSoon')}</div>}
          <PoweredBy />
        </footer>
      </section>

      <aside className="d23-right" data-testid="right-panel" data-mode={mode} aria-label={mode === 'ads' ? t('d23.fromSalon') : t('d23.yourCheckout')}>
        {mode === 'ads'
          ? (fullscreen ? null : <AdRotator ads={ads.panelAds} onShown={ads.onShown} fallback={fallback} />)
          : <CheckoutPanel s={d} a={a} />}
      </aside>

      {fullscreen ? (
        <div className={`d23-fullscreen${leaving ? ' leaving' : ''}`} data-testid="fullscreen-ads" role="button" tabIndex={-1}
          aria-label={t('d23.touchToCheckIn')} onPointerDown={() => setLeaving(true)}>
          {!leaving ? <AdRotator ads={ads.fullAds} onShown={ads.onShown} /> : null}
          <div className="d23-fullscreen-hint">{t('d23.touchToCheckIn')}</div>
        </div>
      ) : null}
    </div>
  );
}
