// GoCheckIn.tsx — the customer check-in on the SINGLE-COLUMN display (portrait / iPad; the 23-inch landscape screen
// arranges the same flow in three columns — Display23.tsx). The display checks guests in with ITS OWN credential
// (useGoCheckIn(deviceToken) — 23-inch spec §8, §12, §18) through the shared flow (useCheckInFlow). App.tsx renders this
// only when the display's state says check-in is on (`checkIn`). All customer matching, appointment lookup, prices, who
// may be asked for, queue join, wait estimate and tenant/branch isolation live server-side — this only renders.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomerDisplayBranding } from '@aipowersalon/api-contracts/customer';
import { useGoCheckIn } from './useGoCheckIn';
import { usd, type TechClockIdentity } from './goCheckInApi';
import type { CheckInConfirmation } from '@aipowersalon/api-contracts/customer';
import { useCheckInFlow } from './useCheckInFlow';
import { SalonBrand, SalonMark } from './Branding';
import { VisitServices, thanksLine, visitItems, waitBand } from './CheckIn23';
import { LanguageSwitch, Rich, useT } from './i18n';

function Brand({ salon, branding }: { salon?: string; branding?: CustomerDisplayBranding }) {
  return (
    <header className="kiosk-brand">
      <SalonBrand branding={branding} salonName={salon || ''} />
      <LanguageSwitch className="lang-switch kiosk-lang" />
    </header>
  );
}


function Confirmed({ salon, branding, conf, showWait, placeInLine, confirmSeconds, onDone }: { salon: string; branding?: CustomerDisplayBranding; conf: CheckInConfirmation; showWait: boolean; placeInLine: (checkInId: string) => Promise<{ position: number; waitingAhead: number } | null>; confirmSeconds: number; onDone: () => void }) {
  const t = useT();
  const [place, setPlace] = useState<{ position: number; waitingAhead: number } | null>(null);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const loadPlace = useCallback(() => {
    if (!conf.checkInId) return;
    setLoadingPlace(true);
    placeInLine(conf.checkInId).then(setPlace).catch(() => { /* stays hidden */ }).finally(() => setLoadingPlace(false));
  }, [conf.checkInId, placeInLine]);
  useEffect(() => { loadPlace(); }, [loadPlace]);
  useEffect(() => { if (!confirmSeconds || confirmSeconds <= 0) return; const t = setTimeout(onDone, confirmSeconds * 1000); return () => clearTimeout(t); }, [confirmSeconds, onDone]);
  const already = conf.status === 'already_checked_in';
  const band = showWait ? waitBand(conf, t.lang) : null;   // §26–§27: the queue engine's band, as it came
  return (
    <div className="kiosk-app gci-app">
      <Brand salon={salon} branding={branding} />
      <main className="kiosk-main kiosk-center">
        <div className="gci-confirmed">
          <div className="kiosk-glyph ok">✓</div>
          <div className="kiosk-h serif">{already ? t('ci.already') : t('ci.checkedInPortrait')}</div>
          <div className="kiosk-sub">{thanksLine(conf, t.lang)}</div>
          {band && (
            <div className="gci-wait">
              <div className="gci-wait-label">{t('ci.estimatedWaitTime')}</div>
              <div className="gci-wait-value serif">{band}</div>
              <div className="gci-wait-note">{t('ci.patience')}</div>
            </div>
          )}
          {conf.checkInId && (place
            ? <div className="gci-place"><Rich text={t('ci.placeInLine', { n: place.position })} /></div>
            : <button className="kiosk-btn ghost gci-place-btn" disabled={loadingPlace} onClick={loadPlace}>{loadingPlace ? t('ci.checking') : t('ci.viewPlace')}</button>)}
          <button className="kiosk-btn ghost gci-done" onClick={onDone}>{t('ci.done')}</button>
        </div>
      </main>
    </div>
  );
}

// Technician Time Clock — a PIN-driven mode on the same kiosk. tenant/branch stay server-derived; the PIN decides who.
export function TechnicianClockBody({ gci, salon, onExit }: { gci: ReturnType<typeof useGoCheckIn>; salon: string; onExit: () => void }) {
  const [pin, setPin] = useState('');
  const idemKey = useRef('');   // one key per identify → clock action, so a retry/double-tap is idempotent
  const [phase, setPhase] = useState<'pin' | 'card' | 'done'>('pin');
  const [identity, setIdentity] = useState<TechClockIdentity | null>(null);
  const [doneMsg, setDoneMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const press = (k: string) => {
    setErr(null);
    if (k === '⌫') { setPin((p) => p.slice(0, -1)); return; }
    if (k === 'C') { setPin(''); return; }
    setPin((p) => (p.length >= 4 ? p : p + k));
  };
  const submitPin = async () => {
    if (pin.length !== 4) { setErr('Enter your 4-digit Clock PIN.'); return; }
    setBusy(true); setErr(null);
    try {
      const id = await gci.technicianIdentify(pin);
      idemKey.current = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
      setIdentity(id); setPhase('card');
    }
    catch (e: any) { setErr(e?.message || 'That PIN was not recognised.'); setPin(''); }
    finally { setBusy(false); }
  };
  const doClock = async () => {
    if (!identity) return;
    setBusy(true); setErr(null);
    try {
      if (identity.action === 'clock_in') await gci.technicianClockIn(pin, idemKey.current); else await gci.technicianClockOut(pin, idemKey.current);
      const nm = identity.technicianName || 'there';
      setDoneMsg(identity.action === 'clock_in' ? `You're clocked in, ${nm}.` : `You're clocked out, ${nm}.`);
      setPhase('done');
      setTimeout(onExit, 6000);
    } catch (e: any) { setErr(e?.message || 'That could not be completed. Please try again or see a manager.'); }
    finally { setBusy(false); }
  };

  const timeLabel = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const evt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');

  return (
        <section className="gci-col gci-clock" style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center' }}>
          <div className="gci-welcome serif" style={{ justifyItems: 'center' }}><span>Technician Time Clock</span></div>
          <div className="gci-appt-when" style={{ marginBottom: 4 }}>{dateLabel} · {timeLabel}</div>

          {phase === 'pin' && (<>
            <div className="gci-label">Enter your 4-digit Clock PIN</div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', margin: '14px 0 18px' }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--gci-gold, #C9933B)', background: i < pin.length ? 'var(--gci-gold, #C9933B)' : 'transparent' }} />
              ))}
            </div>
            <div className="gci-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k, i) => (
                <button key={i} className="kiosk-key gci-key" disabled={busy} onClick={() => press(k)}>{k}</button>
              ))}
            </div>
            <button className="kiosk-pay gci-find" disabled={busy || pin.length !== 4} onClick={submitPin}>{busy ? 'Checking…' : 'Continue'}</button>
            <button className="gci-phone-x" style={{ marginTop: 10, background: 'transparent', border: 'none', color: 'var(--gci-muted, #9a8c79)', cursor: 'pointer' }} onClick={onExit}>Cancel</button>
          </>)}

          {phase === 'card' && identity && (<>
            {identity.avatarUrl
              ? <img src={identity.avatarUrl} alt="" draggable={false} style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', margin: '6px auto 0', display: 'block', border: '2px solid var(--gci-gold, #C9933B)' }} />
              : <div aria-hidden="true" style={{ width: 84, height: 84, borderRadius: '50%', margin: '6px auto 0', display: 'grid', placeItems: 'center', background: '#F5EEE2', color: 'var(--gci-gold, #C9933B)', fontWeight: 800, fontSize: 30 }}>{(identity.technicianName || 'T').slice(0, 1).toUpperCase()}</div>}
            <div className="gci-appt-name serif" style={{ marginTop: 6 }}>{identity.technicianName || 'Technician'}</div>
            <div className="gci-appt-tech">{salon}</div>
            <div style={{ display: 'grid', gap: 4, margin: '14px 0', fontSize: 15 }}>
              <div>Status · <b>{identity.clockedIn ? 'Clocked in' : 'Clocked out'}</b></div>
              <div style={{ color: 'var(--gci-muted, #9a8c79)' }}>
                {identity.clockedIn ? `Since ${evt(identity.clockedInAt)} · ${identity.hoursToday.toFixed(2)} h today` : `Last out ${evt(identity.lastClockOutAt)}`}
              </div>
            </div>
            <button className="kiosk-pay gci-find" disabled={busy} onClick={doClock}>
              {busy ? 'Saving…' : identity.action === 'clock_in' ? 'Clock In' : 'Clock Out'}
            </button>
            <button className="gci-phone-x" style={{ marginTop: 10, background: 'transparent', border: 'none', color: 'var(--gci-muted, #9a8c79)', cursor: 'pointer' }} onClick={onExit}>Cancel</button>
          </>)}

          {phase === 'done' && (<>
            <div style={{ fontSize: 44, margin: '10px 0' }}>✓</div>
            <div className="gci-appt-name serif">{doneMsg}</div>
            <div className="gci-appt-when" style={{ marginTop: 6 }}>{timeLabel}</div>
            <button className="kiosk-pay gci-find" style={{ marginTop: 18 }} onClick={onExit}>Done</button>
          </>)}

          {err && <div className="kiosk-err" onClick={() => setErr(null)} style={{ marginTop: 12 }}>{err}</div>}
        </section>
  );
}

/** The single-column screen's clock mode: the same body in its own full-screen frame. */
function TechnicianClock({ gci, salon, branding, onExit }: { gci: ReturnType<typeof useGoCheckIn>; salon: string; branding?: CustomerDisplayBranding; onExit: () => void }) {
  return (
    <div className="kiosk-app gci-app">
      <Brand salon={salon} branding={branding} />
      <main className="kiosk-main gci-main" style={{ justifyContent: 'center' }}>
        <TechnicianClockBody gci={gci} salon={salon} onExit={onExit} />
      </main>
    </div>
  );
}

export function GoCheckIn({ deviceToken, salon, branding }: { deviceToken: string; salon: string; branding?: CustomerDisplayBranding }) {
  const t = useT();
  const gci = useGoCheckIn(deviceToken);
  const f = useCheckInFlow(gci);
  const settings = f.settings;
  const salonName = gci.config?.salonName || salon;

  if (f.mode === 'technician') return <TechnicianClock gci={gci} salon={salonName} branding={branding} onExit={f.exitTechnician} />;
  if (f.confirmation) return <Confirmed salon={salonName} branding={branding} conf={f.confirmation} showWait={settings?.showWaitEstimate !== false} placeInLine={gci.placeInLine} confirmSeconds={settings?.confirmationTimeoutSeconds ?? 12} onDone={f.reset} />;

  const appt = f.appointment;
  return (
    <div className="kiosk-app gci-app">
      <Brand salon={salonName} branding={branding} />
      <button
        className="gci-mode-switch"
        onClick={f.enterTechnician}
        style={{ position: 'absolute', top: 16, right: 16, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, border: '1px solid var(--gci-gold, #C9933B)', background: 'rgba(255,255,255,.7)', color: 'var(--gci-ink, #5a4413)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
      >🕑 Technician Clock-In / Clock-Out</button>
      <main className="kiosk-main gci-main">
        {/* LEFT — welcome + phone lookup */}
        <section className="gci-col gci-lookup">
          <div className="gci-welcome serif"><span>{gci.config?.welcomeMessage || t('ci.welcome')}</span><span>{t('ci.checkInHere')}</span></div>
          <div className="gci-label">{t('ci.enterPhone')}</div>
          <div className="gci-phone">
            <span className="gci-phone-ico">✆</span>
            <span className="gci-phone-val">{f.phone || '(555) 123-4567'}</span>
            {f.phone && <button className="gci-phone-x" onClick={f.clearPhone} aria-label={t('ci.clear')}>✕</button>}
          </div>
          <div className="gci-keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k, i) => (
              <button key={i} className="kiosk-key gci-key" disabled={f.busy} aria-label={k === 'C' ? t('ci.clearPhoneAria') : k === '⌫' ? t('ci.backspace') : k} onClick={() => f.press(k)}>{k === 'C' ? t('ci.clear') : k}</button>
            ))}
          </div>
          <button className="kiosk-pay gci-find" disabled={f.busy || gci.phase !== 'ready'} onClick={f.doLookup}>
            {f.busy ? t('ci.checking') : t('ci.find')}
          </button>
          {gci.phase === 'error' && <div className="kiosk-err">{t('app.offline')}</div>}
        </section>

        {/* MIDDLE — appointment found OR walk-in */}
        <section className="gci-col gci-result">
          {appt ? (
            <div className="gci-appt">
              <div className="gci-appt-badge"><span className="dot">●</span> {t('ci.apptFound')}</div>
              <SalonMark branding={branding} salonName={salonName} className="gci-appt-logo" />
              <div className="gci-appt-name serif">{f.name || f.lookup?.match?.firstName || t('ci.guest')}</div>
              <div className="gci-appt-when">{t('ci.todayAt', { time: appt.startTimeLabel })}</div>
              {visitItems(appt).length > 1 ? <VisitServices appt={appt} fit={3} className="gci-visit" /> : (<>
                <div className="gci-appt-svc serif">{appt.serviceName}</div>
                {appt.technicianName && <div className="gci-appt-tech">{t('ci.with', { name: appt.technicianName })}</div>}
              </>)}
              <button className="kiosk-pay gci-imhere" disabled={f.busy} onClick={() => f.imHere(appt.appointmentId)}>{f.busy ? t('ci.checkingIn') : t('ci.imHere')}</button>
            </div>
          ) : (
            <div className="gci-walkin">
              <div className="gci-walkin-title serif">{f.lookup ? t('ci.noApptFound') : t('ci.noAppt')}</div>
              <div className="gci-walkin-sub">{f.digits.length === 10 ? t('ci.letsCheckIn') : t('ci.enterPhoneThenNamePortrait')}</div>
              <label className="gci-field">
                <span>{t('ci.firstNameField')}</span>
                <input className="gci-input" value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder={t('ci.firstNamePlaceholder')} />
              </label>
              {settings?.serviceSelectionEnabled && f.mains.length > 0 && (
                <div className="gci-svc-block">
                  <div className="gci-field-label">{t('ci.chooseServices')}</div>
                  <div className="gci-svc-grid gci-svc-scroll">
                    {f.mains.map((sv) => (
                      <button key={sv.id} className={`gci-svc${f.picked.includes(sv.id) ? ' on' : ''}`} aria-pressed={f.picked.includes(sv.id)} disabled={f.busy} onClick={() => f.toggleSvc(sv.id)}>
                        <span className="n">{sv.name}</span><span className="p">{usd(sv.priceCents)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {settings?.serviceSelectionEnabled && f.mains.length > 0 && f.addOnOptions.length > 0 && (
                <div className="gci-svc-block" role="group" aria-label={t('ci.addOns')}>
                  <div className="gci-field-label">{t('ci.addOns')} <span className="opt">{f.picked.length ? t('ci.optional') : t('ci.withService')}</span></div>
                  <div className="gci-svc-grid">
                    {f.addOnOptions.map((ao) => (
                      <button key={ao.id} className={`gci-svc${f.addOns.includes(ao.id) ? ' on' : ''}`} aria-pressed={f.addOns.includes(ao.id)} disabled={f.busy || !f.picked.length} onClick={() => f.toggleAddOn(ao.id)}>
                        <span className="n">{ao.name}</span><span className="p">+{usd(ao.priceCents)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {settings?.technicianPreferenceEnabled && f.techs.length > 0 && (
                <label className="gci-field">
                  <span>{t('ci.technician')}</span>
                  <select className="gci-input" value={f.tech} onChange={(e) => f.setTech(e.target.value)}>
                    <option value="">{t('ci.anyAvailablePortrait')}</option>
                    {f.techs.map((t) => <option key={t.technicianId} value={t.technicianId}>{t.fromLabel ? `${t.name} · ${t.fromLabel}` : t.name}</option>)}
                  </select>
                </label>
              )}
              {f.canWalkIn && (
                <button className="kiosk-pay gci-done-btn" disabled={f.busy} onClick={f.doWalkIn}>{f.busy ? t('ci.checkingIn') : t('ci.done')}</button>
              )}
            </div>
          )}
          {f.err && <div className="kiosk-err" onClick={() => f.setErr(null)}>{f.err}</div>}
        </section>
      </main>
    </div>
  );
}
