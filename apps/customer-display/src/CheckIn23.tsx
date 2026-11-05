// CheckIn23.tsx — the check-in columns of the 23-inch display (spec §14–§28): LEFT the welcome, the phone number and a
// large keypad (Clear, Backspace); CENTRE the appointment that was found ("Today at 11:00 AM", every service of the visit
// with its technician, "I'm Here") or the quick walk-in (first name, the branch's services and add-ons, any / a
// preferred technician); the FOOTER the result — "You're checked in!", the queue engine's wait band and the customer's
// place in line — for a few seconds, then it clears (§28).
// The flow itself (what was typed, what the server answered) is useCheckInFlow — shared with the single-column screen.
import { useCallback, useEffect, useState } from 'react';
import type { AppointmentItem, AppointmentToday, CheckInConfirmation, CustomerDisplayBranding } from '@aipowersalon/api-contracts/customer';
import { usd } from './goCheckInApi';
import type { CheckInFlow } from './useCheckInFlow';
import { SalonMark } from './Branding';
import { Rich, translate, useT } from './i18n';

/** §28: the confirmation stays this long (the salon's own setting, held to the spec's 5–10 seconds). */
export function confirmHoldSeconds(setting: number | undefined): number {
  const n = Number.isFinite(setting) ? Number(setting) : 8;
  return Math.min(10, Math.max(5, Math.round(n)));
}

/** §17: every service of the visit; an older server sent only the first. */
export function visitItems(a: AppointmentToday): AppointmentItem[] {
  return a.items?.length ? a.items : [{ serviceName: a.serviceName, technicianName: a.technicianName, startTimeLabel: a.startTimeLabel }];
}
/** §26–§27: the band the queue engine gave — the display computes no wait of its own. */
export function waitBand(c: CheckInConfirmation, lang = 'en'): string | null {
  const w = c.estimatedWait;
  return w && Number.isFinite(w.fromMinutes) && Number.isFinite(w.toMinutes) ? translate(lang, 'ci.minutes', { from: w.fromMinutes, to: w.toMinutes }) : null;
}
/** The line under "You're checked in!": a visit of several appointments says so. */
export function thanksLine(c: CheckInConfirmation, lang = 'en'): string {
  const who = c.firstName ? `, ${c.firstName}` : '';
  const n = c.appointmentsCheckedIn ?? 0;
  if (n === 2) return translate(lang, 'ci.thanksBoth', { who });
  return n > 2 ? translate(lang, 'ci.thanksAll', { who, n }) : translate(lang, 'ci.thanks', { who });
}

/**
 * §17 "Use compact layout. If more services than immediately fit: + 2 more, with optional expandable detail. Do not make
 * the entire screen scroll." The first `fit` rows, then "+ N more"; opened, the list scrolls inside its own box.
 */
export function VisitServices({ appt, fit = 2, className = 'd23-visit' }: { appt: AppointmentToday; fit?: number; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items = visitItems(appt);
  const shown = open ? items : items.slice(0, fit);
  const more = items.length - fit;
  return (
    <div className={className}>
      <ul className={`${className}-list${open ? ' open' : ''}`} aria-label={t('ci.yourServices')}>
        {shown.map((it, i) => (
          <li key={i}>
            <span className="n serif">{it.serviceName}</span>
            {it.technicianName ? <span className="t">{t('ci.with', { name: it.technicianName })}</span> : null}
            {it.startTimeLabel && it.startTimeLabel !== appt.startTimeLabel ? <span className="w">{it.startTimeLabel}</span> : null}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" className={`${className}-more`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('ci.showLess') : t('ci.more', { n: more })}
        </button>
      ) : null}
    </div>
  );
}

export function CheckInLookup({ f }: { f: CheckInFlow }) {
  const t = useT();
  const ready = f.gci.phase === 'ready';
  return (
    <div className="d23-lookup">
      <div className="d23-welcome serif"><span>{f.gci.config?.welcomeMessage || t('ci.welcome')}</span><span>{t('ci.checkInHere')}</span></div>
      <div className="d23-label">{t('ci.enterPhone')}</div>
      <div className="d23-phone" aria-live="polite">
        <span className="ico" aria-hidden="true">✆</span>
        <span className={`val${f.phone ? '' : ' ph'}`}>{f.phone || '(555) 123-4567'}</span>
      </div>
      <div className="d23-keys" role="group" aria-label={t('ci.keypadAria')}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
          <button key={k} type="button" className={`d23-key${k === 'C' || k === '⌫' ? ' fn' : ''}`} disabled={f.busy || !ready}
            aria-label={k === 'C' ? t('ci.clearPhoneAria') : k === '⌫' ? t('ci.backspace') : k} onClick={() => f.press(k)}>{k === 'C' ? t('ci.clear') : k}</button>
        ))}
      </div>
      <button type="button" className="d23-primary" disabled={f.busy || !ready} onClick={f.doLookup}>{f.busy && !f.lookup ? t('ci.checking') : t('ci.find')}</button>
    </div>
  );
}

function Offline() {
  // §84: the check-in lost its backend — the front desk can still check the customer in from the POS
  const t = useT();
  return (
    <div className="d23-note" role="status">
      <div className="d23-note-h serif">{t('ci.offline.h')}</div>
      <div className="d23-note-s">{t('ci.offline.s')}</div>
    </div>
  );
}

export function CheckInDetails({ f, branding, salonName }: { f: CheckInFlow; branding?: CustomerDisplayBranding; salonName: string }) {
  const t = useT();
  const [allServices, setAllServices] = useState(false);
  const s = f.settings;
  if (f.gci.phase === 'error') return <Offline />;
  if (f.gci.phase !== 'ready') return <div className="d23-note"><div className="d23-note-s">{t('ci.preparing')}</div></div>;
  const appt = f.appointment;
  if (appt) {
    const several = visitItems(appt).length > 1;
    return (
      <div className={`d23-appt${several ? ' several' : ''}`}>
        <div className="d23-appt-badge"><span aria-hidden="true">✓</span> {t('ci.apptFound')}</div>
        {several ? null : <SalonMark branding={branding} salonName={salonName} className="d23-appt-mark" />}
        <div className="d23-appt-name serif">{f.lookup?.match?.firstName || f.name || t('ci.guest')}</div>
        <div className="d23-appt-when">{t('ci.todayAt', { time: appt.startTimeLabel })}</div>
        {several ? <VisitServices appt={appt} /> : (
          <>
            <div className="d23-appt-svc serif">{appt.serviceName}</div>
            {appt.technicianName ? <div className="d23-appt-tech">{t('ci.with', { name: appt.technicianName })}</div> : null}
          </>
        )}
        <button type="button" className="d23-primary d23-imhere" disabled={f.busy} onClick={() => f.imHere(appt.appointmentId)}>{f.busy ? t('ci.checkingIn') : t('ci.imHere')}</button>
        {f.err ? <div className="kiosk-err" onClick={() => f.setErr(null)}>{f.err}</div> : null}
      </div>
    );
  }
  if (f.lookup?.askFrontDesk) {
    return (
      <div className="d23-note" role="status">
        <div className="d23-note-h serif">{t('ci.seeFrontDesk.h')}</div>
        <div className="d23-note-s">{t('ci.seeFrontDesk.s')}</div>
      </div>
    );
  }
  const choose = !!s?.serviceSelectionEnabled && f.mains.length > 0;
  const services = allServices ? f.mains : f.mains.slice(0, 6);
  return (
    <div className="d23-walkin">
      <div className="d23-walkin-title serif">{f.lookup ? t('ci.noApptFound') : t('ci.noAppt')}</div>
      <div className="d23-walkin-sub">{f.digits.length === 10 ? t('ci.letsCheckIn') : t('ci.enterPhoneThenName')}</div>
      <label className="d23-field">
        <span>{t('ci.firstName')}</span>
        <input className="d23-input" value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder={t('ci.firstName')} autoComplete="off" />
      </label>
      {choose ? (
        <div className="d23-svc-block">
          <div className="d23-field-row">
            <span className="d23-field-label">{t('ci.chooseServices')}</span>
            {f.mains.length > 6 ? <button type="button" className="d23-link" onClick={() => setAllServices((v) => !v)}>{allServices ? t('ci.showFewer') : t('ci.viewAll')}</button> : null}
          </div>
          <div className={`d23-svc-grid${allServices ? ' all' : ''}`}>
            {services.map((sv) => (
              <button key={sv.id} type="button" className={`d23-svc${f.picked.includes(sv.id) ? ' on' : ''}`} aria-pressed={f.picked.includes(sv.id)} disabled={f.busy} onClick={() => f.toggleSvc(sv.id)}>
                <span className="n">{sv.name}</span><span className="p">{usd(sv.priceCents)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {choose && f.addOnOptions.length > 0 ? (
        <div className="d23-addons" role="group" aria-label={t('ci.addOns')}>
          <span className="d23-field-label">{t('ci.addOns')} <span className="opt">{f.picked.length ? t('ci.optional') : t('ci.withService')}</span></span>
          <div className="d23-addon-row">
            {f.addOnOptions.map((ao) => (
              <button key={ao.id} type="button" className={`d23-addon${f.addOns.includes(ao.id) ? ' on' : ''}`} aria-pressed={f.addOns.includes(ao.id)}
                disabled={f.busy || !f.picked.length} onClick={() => f.toggleAddOn(ao.id)}>
                <span className="n">{ao.name}</span><span className="p">+{usd(ao.priceCents)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {s?.technicianPreferenceEnabled && f.techs.length > 0 ? (
        <label className="d23-field">
          <span>{t('ci.technician')}</span>
          <select className="d23-input" value={f.tech} onChange={(e) => f.setTech(e.target.value)}>
            <option value="">{t('ci.anyAvailable')}</option>
            {f.techs.map((t) => <option key={t.technicianId} value={t.technicianId}>{t.fromLabel ? `${t.name} · ${t.fromLabel}` : t.name}</option>)}
          </select>
        </label>
      ) : null}
      {f.canWalkIn ? (
        <button type="button" className="d23-primary d23-walkin-go" disabled={f.busy} onClick={f.doWalkIn}>{f.busy ? t('ci.checkingIn') : t('ci.checkIn')}</button>
      ) : null}
      {f.err ? <div className="kiosk-err" onClick={() => f.setErr(null)}>{f.err}</div> : null}
    </div>
  );
}

/** The footer: the check-in result for a few seconds (§26–§28), otherwise the salon's quiet line. */
export function CheckInResult({ f, idleMessage }: { f: CheckInFlow; idleMessage: string | null }) {
  const t = useT();
  const c = f.confirmation;
  const [place, setPlace] = useState<{ position: number; waitingAhead: number } | null>(null);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const loadPlace = useCallback(() => {
    if (!c?.checkInId) return;
    setLoadingPlace(true);
    f.gci.placeInLine(c.checkInId).then(setPlace).catch(() => { /* the button stays */ }).finally(() => setLoadingPlace(false));
  }, [c?.checkInId, f.gci]);
  useEffect(() => { setPlace(null); if (c?.checkInId) loadPlace(); }, [c?.checkInId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hold = confirmHoldSeconds(f.settings?.confirmationTimeoutSeconds);
  const { reset } = f;
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(reset, hold * 1000);   // §28: then the customer's details leave the screen
    return () => clearTimeout(t);
  }, [c, hold, reset]);

  if (!c) return <div className="d23-foot-idle">{idleMessage || t('ci.idleFoot')}</div>;
  const already = c.status === 'already_checked_in';
  const band = f.settings?.showWaitEstimate !== false ? waitBand(c, t.lang) : null;
  return (
    <div className="d23-result" role="status" aria-live="polite">
      <div className="d23-result-ok" aria-hidden="true">✓</div>
      <div className="d23-result-text">
        <div className="t">{already ? t('ci.already') : t('ci.checkedIn')}</div>
        <div className="s">{thanksLine(c, t.lang)}</div>
      </div>
      {band ? (
        <div className="d23-result-wait">
          <div className="l">{t('ci.estimatedWait')}</div>
          <div className="v serif">{band}</div>
        </div>
      ) : null}
      {c.checkInId ? (place
        ? <div className="d23-result-place"><Rich text={t('ci.placeInLine', { n: place.position })} /></div>
        : <button type="button" className="d23-ghost" disabled={loadingPlace} onClick={loadPlace}>{loadingPlace ? t('ci.checking') : t('ci.viewPlace')}</button>) : null}
    </div>
  );
}
