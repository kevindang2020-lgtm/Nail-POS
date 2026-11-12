// POSBookingVerificationScreen.tsx — Communications → Booking Phone Verification (Booking Phone Verification Complete Build
// Guide, Oct 30 2026). The photographed controls are kept (main switch, six booking sources, 24-hour trust window, the three
// "always re-verify" rules, the 10-minute hold); added around them: six KPI cards, "Check Verification System" (itemized,
// non-destructive), the live verification & slot-hold monitor (nearest expiry first), and the verification history (server
// search, filters, From/To calendar with a date basis, pages of 10/20/50, newest first) with a details overlay. No code is
// ever shown; enforcement lives on the server (BookingVerificationGuard / VerifiedBookingFlow / the hold constraint).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInlineAsk } from '@aipowersalon/ui';
import type { BookingVerificationUsageView, PendingVerificationView } from '@aipowersalon/api-contracts';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtDateTime } from '../i18n/format';
import { statusLabel } from '../i18n/status-label';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { fmtInZone, fmtNumber } from '../i18n/format';
import { errorTextOf } from '../i18n/error-text';
import { posBookingVerificationApi as bvApi, type BvDetail, type BvHealth, type BvPage, type BvRow, type BvSummary } from '../api/posBookingVerificationApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { PeriodBar, type PeriodState, type ServerPeriod } from '../components/FinanceKit';


interface Settings {
  enabled: boolean;
  channels: { online: boolean; customerApp: boolean; aiReceptionist: boolean; kiosk?: boolean; frontDesk?: boolean; walkIn?: boolean };
  verifyEveryBooking: boolean;
  reverifyAfterSeconds: number;
  reverifyOnGroupBooking: boolean;
  reverifyOnDeposit: boolean;
  reverifyOnHighValue: boolean;
  highValueThresholdCents?: number | null;
  holdSeconds: number;
  version: number;
  provider: { connected: boolean; validated: boolean; blockedReason: string | null };
  platform: { requiredByPlatform: boolean; blockedByPlatform: boolean; emergencyDisabled: boolean; moduleDisabled?: boolean };
}

/** a verification channel code → its label (read at render: a getter table, never translated at import) */
const CHANNEL_LABEL: Record<string, string> = {
  get online() { return t('ops.verify.channel.online'); }, get customer_app() { return t('pos.customer_app'); },
  get ai_receptionist() { return t('pos.ai_receptionist'); }, get kiosk() { return t('ops.verify.channel.kiosk'); },
  get front_desk() { return t('bv.ch.front_desk'); }, get walk_in() { return t('bv.ch.walk_in'); },
};
const CONTACT_METHODS = [
  { value: 'in_person', get label() { return t('pos.the_customer_is_here_in_person'); } },
  { value: 'staff_called_back', get label() { return t('pos.we_called_the_customer_back_on_7t0t'); } },
  { value: 'known_customer', get label() { return t('pos.a_known_regular_customer'); } },
] as const;
const when = (iso: string | null) => { if (!iso) return '—'; try { return fmtDateTime(iso); } catch { return iso; } };   // the branch zone, the user's language

const REVERIFY_OPTIONS = [
  { get label() { return t('pos.every_booking'); }, seconds: 0 },
  { get label() { return t('pos.once_every_24_hours'); }, seconds: 86_400 },
  { get label() { return t('pos.once_every_7_days'); }, seconds: 604_800 },
  { get label() { return t('pos.once_every_30_days'); }, seconds: 2_592_000 },
];

function CheckOption({ label, hint, on, disabled, onChange }: { label: string; hint?: string; on: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {   // no onChange: a fixed, disabled option
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint ? <div className="sub" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div> : null}
      </div>
    </label>
  );
}

export function POSBookingVerificationScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<Msg | null>(null);
  const [pending, setPending] = useState<PendingVerificationView[] | null>(null);
  const [pendingMsg, setPendingMsg] = useState<Msg | null>(null);   // keys, translated at render
  const [usage, setUsage] = useState<BookingVerificationUsageView | null>(null);
  const [method, setMethod] = useState<Record<string, string>>({});
  const { ask, askUi } = useInlineAsk();

  // Phase 4: the bookings waiting for a code (owners and managers — a 403 simply hides the list) and the activity panel.
  const loadPending = useCallback(() => {
    api.get<{ items: PendingVerificationView[] }>('/pos/booking/verification-override/pending')
      .then((r) => setPending(r.items ?? []))
      .catch(() => setPending(null));
  }, []);
  const loadUsage = useCallback(() => {
    api.get<BookingVerificationUsageView>('/pos/settings/booking-phone-verification/usage?days=30').then(setUsage).catch(() => setUsage(null));
  }, []);
  useEffect(() => { loadPending(); loadUsage(); }, [loadPending, loadUsage]);

  const override = (p: PendingVerificationView) => {
    const contactMethod = method[p.id] ?? 'in_person';
    ask(t('ops.verify.overrideAsk', { phone: p.maskedPhone }), async (reason) => {
      setPendingMsg(null);
      try {
        await api.post('/pos/booking/verification-override', { verificationId: p.id, reason, contactMethod });
        setPendingMsg(msg('ops.verify.overrideApproved'));
        loadPending(); loadUsage();
      } catch (e: any) { setPendingMsg(e?.message || msg('pos.that_could_not_be_approved')); }
    }, { inputLabel: t('pos.reason_2'), minLength: 12, confirmLabel: t('pos.approve_booking') });
  };

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    api.get<Settings>('/pos/settings/booking-phone-verification')
      .then(setS)
      .catch((e: any) => { setErr(e?.message || t('pos.we_could_not_load_these_settings')); setS(null); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true); setErr(null); setOk(null);
    try {
      const next = await api.patch<Settings>('/pos/settings/booking-phone-verification', patch);
      setS(next);
      setOk(msg('pos.settings_saved'));
    } catch (e: any) {
      setErr(e?.message || t('pos.we_could_not_save_that'));
    } finally { setSaving(false); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading')}</div></div>;
  if (err && !s) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{err}</div></div>;
  if (!s) return null;

  const platformLocked = s.platform.requiredByPlatform || s.platform.blockedByPlatform || s.platform.emergencyDisabled || !!s.platform.moduleDisabled;
  const providerReady = s.provider.connected && s.provider.validated;
  const cannotEnable = !providerReady && !s.enabled;
  const mainDisabled = saving || cannotEnable || platformLocked;

  return (
    <div className="work bv-page" data-testid="bv-page">
      <VerificationOps settingsPanel={<>

      {s.platform.emergencyDisabled ? (
        <div className="panel" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12 }}>
          {t('pos.temporarily_disabled_by_platform_operations_your_pge8')}
        </div>
      ) : null}
      {s.platform.requiredByPlatform ? (
        <div className="panel" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12 }}>
          <strong>{t('pos.required_by_ai_powersalon_platform_policy')}</strong> {t('pos.phone_verification_cannot_be_turned_off_1c0j')}
        </div>
      ) : null}
      {s.platform.moduleDisabled ? (
        <div className="panel" data-testid="module-disabled" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12 }}>
          {t('pos.phone_verification_is_not_available_on_mi47')}
        </div>
      ) : null}
      {s.platform.blockedByPlatform ? (
        <div className="err" style={{ marginBottom: 12 }}>
          {t('pos.phone_verification_is_unavailable_for_this_imds')}
        </div>
      ) : null}

      {!providerReady ? (
        <div className="panel" style={{ background: '#FBEDE9', borderColor: '#F0D2C9', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#8F3226', marginBottom: 4 }}>{t('pos.connect_your_twilio_account_first')}</div>
          <div style={{ fontSize: 13, color: '#8F3226', marginBottom: 10 }}>
            {s.provider.blockedReason ?? t('pos.connect_and_verify_your_twilio_account_1qi9')}
          </div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 14 }}>
            {t('pos.codes_are_sent_from')}{' '}<strong>{t('pos.your_own')}</strong> {t('pos.twilio_account_and_sender_so_customers_qczb')}
          </div>
          <button className="btn" onClick={() => nav('/tenant/communications/messaging-setup')}>{t('pos.connect_twilio')}</button>
        </div>
      ) : null}

      <section className="panel" data-testid="bv-settings">
        <div 
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: mainDisabled ? 'not-allowed' : 'pointer', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }} 
          onClick={() => { if (!mainDisabled) save({ enabled: !s.enabled }); }}
        >
          <input type="checkbox" checked={s.enabled || s.platform.requiredByPlatform} disabled={mainDisabled} readOnly style={{ width: 18, height: 18 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t('pos.require_phone_verification_for_remote_bookings')}</div>
            <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
              {cannotEnable ? t('pos.locked_until_your_twilio_connection_is_1j12') : s.platform.requiredByPlatform ? t('pos.required_by_platform_policy') : t('pos.a_booking_is_not_confirmed_until_38wa')}
            </div>
          </div>
        </div>

        <div style={{ opacity: s.enabled ? 1 : 0.55, pointerEvents: s.enabled ? 'auto' : 'none' }}>
          
          <div className="p-h">{t('pos.where_it_applies')}</div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 12 }}>{t('pos.bookings_made_in_the_salon_at_x4bb')}{' '}<strong>{t('pos.never')}</strong> {t('pos.asked_for_a_code_your_staff_e82v')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-6">
            {([
              ['online', t('ops.verify.channel.online')],
              ['customerApp', t('pos.customer_app')],
              ['aiReceptionist', t('pos.ai_receptionist')],
            ] as const).map(([key, label]) => (
              <CheckOption key={key} label={label} on={(s.channels as any)[key]} disabled={saving || !s.enabled} onChange={(v) => save({ channels: { [key]: v } })} />
            ))}
            {/* guide §2 "six sources": the in-salon three are shown, fixed off — staff confirm the customer in person (Phase 4
                decision; the server refuses turning them on, IN_SALON_NOT_VERIFIED) and staff exemptions never reach remote channels */}
            {(['kiosk', 'front_desk', 'walk_in'] as const).map((k) => (
              <CheckOption key={k} label={t('bv.ch.' + k)} hint={t('bv.ch.inSalon')} on={false} disabled />
            ))}
          </div>

          <div className="p-h" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>{t('pos.returning_customers')}</div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 14 }}>{t('pos.how_long_a_verified_phone_is_1exg')}{' '}<strong>{t('pos.always')}</strong> {t('pos.asks_again')}</div>
          
          <div className="lf">
            <label>{t('pos.re_verify_frequency')}</label>
            <select
              value={s.verifyEveryBooking ? 0 : s.reverifyAfterSeconds}
              disabled={saving || !s.enabled}
              onChange={(e) => {
                const secs = Number(e.target.value);
                save({ verifyEveryBooking: secs === 0, reverifyAfterSeconds: secs });
              }}
              style={{ width: '100%', maxWidth: 240 }}
            >
              {REVERIFY_OPTIONS.map((o) => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
            </select>
          </div>

          {/* guide §9 / §17.3: the three "always re-verify" rules are back — deposit and high-value are now fed server-side
              from the booked services (VerifiedBookingFlow.riskFor); group has no remote path yet and says so. */}
          <div className="p-h" style={{ marginTop: 14 }}>{t('bv.special')}</div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 6 }}>{t('bv.special.hint')}</div>
          <CheckOption label={t('bv.special.group')} hint={t('bv.special.groupNote')} on={s.reverifyOnGroupBooking} disabled={saving || !s.enabled} onChange={(v) => save({ reverifyOnGroupBooking: v })} />
          <CheckOption label={t('bv.special.deposit')} hint={t('bv.special.depositNote')} on={s.reverifyOnDeposit} disabled={saving || !s.enabled} onChange={(v) => save({ reverifyOnDeposit: v })} />
          <CheckOption label={t('bv.special.high')} on={s.reverifyOnHighValue} disabled={saving || !s.enabled} onChange={(v) => save({ reverifyOnHighValue: v })} />
          <HighValueField cents={s.highValueThresholdCents ?? null} disabled={saving || !s.enabled} onSave={(c) => save({ highValueThresholdCents: c })} />
          <div className="mb-6" />

          <div className="p-h" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>{t('pos.slot_hold')}</div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 14 }}>{t('pos.the_chosen_time_is_reserved_while_1os4')}</div>
          
          <div className="lf">
            <label>{t('pos.hold_duration')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={2} max={15}
                value={Math.round(s.holdSeconds / 60)}
                disabled={saving || !s.enabled}
                onChange={(e) => save({ holdSeconds: Math.max(2, Math.min(15, Number(e.target.value) || 10)) * 60 })}
                style={{ width: 90 }}
              />
              <span className="sub">{t('pos.minutes')}</span>
            </div>
          </div>
        </div>

        {err || ok ? (
          <div className="flex items-center gap-3 mt-6 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
            {err ? <span className="err" style={{ margin: 0 }}>{err}</span> : null}
            {ok ? <span style={{ color: '#2E9E54', fontSize: 13, fontWeight: 600 }}>{renderMsg(ok)}</span> : null}
          </div>
        ) : null}
      </section>

      </>}>
      {pending ? (
        <section className="panel" data-testid="pending-verifications" style={{ marginTop: 14 }}>
          <div className="p-h">{t('pos.waiting_for_a_code')}</div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
            {t('pos.remote_bookings_that_asked_for_a_pxah')}{' '}<strong>{t('pos.that_one_booking')}</strong>{t('pos.it_is_recorded_with_your_reason_cp3r')}
          </div>
          {pending.length === 0 ? <div className="sub" style={{ fontSize: 13 }}>{t('pos.nobody_is_waiting_right_now')}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pending.map((p) => (
                <div key={p.id} data-testid="pending-row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{p.maskedPhone} · {CHANNEL_LABEL[p.channel] ?? statusLabel('source', p.channel)}</div>
                    <div className="sub" style={{ fontSize: 12 }}>{p.status === 'locked' ? t('pos.locked_too_many_wrong_codes') : p.status === 'sent' ? t('pos.code_sent_attempts_tried', { attempts: String(p.attempts) }) : t('pos.code_not_sent_yet')}</div>
                  </div>
                  <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{t('pos.time')}{' '}{p.slotStartsAt ? when(p.slotStartsAt) : t('pos.not_held')} {t('pos.asked')}{' '}{when(p.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select aria-label={t('pos.how_you_confirmed_the_customer')} value={method[p.id] ?? 'in_person'} onChange={(e) => setMethod((m) => ({ ...m, [p.id]: e.target.value }))} style={{ flex: '1 1 220px' }}>
                      {CONTACT_METHODS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <button className="btn" onClick={() => override(p)}>{t('pos.approve_without_code')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {pendingMsg ? <div data-testid="pending-msg" style={{ marginTop: 10, fontSize: 13 }}>{renderMsg(pendingMsg)}</div> : null}
        </section>
      ) : null}

      {usage ? (
        <section className="panel" data-testid="verification-usage" style={{ marginTop: 14 }}>
          <div className="p-h">{t('pos.last')}{' '}{usage.days} {t('pos.days')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, margin: '6px 0 12px' }}>
            {([
              [t('ops.verify.usage.requested'), usage.totals.requested], [t('ops.verify.usage.codesSent'), usage.totals.codesSent], [t('ops.status.delivered'), usage.totals.delivered],
              [t('ops.verify.usage.verified'), usage.totals.verified], [t('ops.verify.usage.completed'), usage.totals.bookingsCompleted], [t('ops.verify.usage.overridden'), usage.totals.overridden],
              [t('ops.verify.usage.locked'), usage.totals.locked], [t('ops.verify.usage.expired'), usage.totals.expired], [t('ops.verify.usage.failed'), usage.totals.failed],
            ] as const).map(([label, n], i) => (
              <div key={i} style={{ background: '#FBF6EC', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{n}</div>
                <div className="sub" style={{ fontSize: 11.5 }}>{label}</div>
              </div>
            ))}
          </div>
          <div className="sub" style={{ fontSize: 12 }}>
            {usage.verifyRate == null ? t('pos.no_codes_requested_yet') : t('pos.v0_of_customers_asked_for_a_1ggn', { v0: String(Math.round(usage.verifyRate * 100)) })}
            {usage.byChannel.length ? ' ' + usage.byChannel.map((c) => `${CHANNEL_LABEL[c.channel] ?? statusLabel('source', c.channel)}: ${c.verified}/${c.requested}`).join(' · ') : ''}
          </div>
          {usage.recentFailures.length ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{t('pos.recent_problems')}</div>
              {usage.recentFailures.slice(0, 8).map((f, i) => (
                <div key={i} className="sub" style={{ fontSize: 12 }}>{when(f.at)} · {f.maskedPhone} · {CHANNEL_LABEL[f.channel] ?? statusLabel('source', f.channel)} · {f.status === 'locked' ? t('pos.too_many_wrong_codes') : f.status === 'expired' ? t('pos.not_finished_in_time') : f.reason ? t('pos.delivery_failed_reason', { reason: String(f.reason) }) : f.status}</div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      </VerificationOps>
      {askUi}
    </div>
  );
}

// ── guide §9: the salon's high-value line (dollars typed, cents saved; empty = not set → the rule never triggers) ──────────
function HighValueField({ cents, disabled, onSave }: { cents: number | null; disabled: boolean; onSave: (c: number | null) => void }) {
  const [text, setText] = useState(cents == null ? '' : String(cents / 100));
  useEffect(() => { setText(cents == null ? '' : String(cents / 100)); }, [cents]);
  const parsed = text.trim() === '' ? null : Math.round(Number(text) * 100);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 100 && parsed <= 10_000_000);
  return (
    <div className="lf bv-high" data-testid="bv-high-value">
      <label htmlFor="bv-high-input">{t('bv.special.highAmount')}</label>
      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
        <input id="bv-high-input" type="number" min={1} max={100000} step="1" inputMode="decimal" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} style={{ width: 130 }} aria-invalid={!valid} />
        <button type="button" className="btn ghost" disabled={disabled || !valid || parsed === cents} onClick={() => onSave(parsed)} data-testid="bv-high-save">{t('bv.special.highSave')}</button>
        {cents != null ? <button type="button" className="btn ghost" disabled={disabled} onClick={() => onSave(null)}>{t('bv.special.highClear')}</button> : null}
      </div>
      {cents == null ? <div className="sub" style={{ fontSize: 11.5, marginTop: 4 }}>{t('bv.special.highNone')}</div> : null}
    </div>
  );
}

const HS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'gold'> = { ready: 'ok', needs_setup: 'warn', pending_provider_action: 'warn', degraded: 'warn', failed: 'bad', unknown: 'gold' };
const BV_STATUSES = ['pending', 'verified', 'failed', 'expired', 'cancelled', 'provider_error'] as const;
const BV_CHANNELS = ['online', 'customer_app', 'ai_receptionist', 'kiosk', 'front_desk', 'walk_in'] as const;
const BV_BASES = ['requested', 'completed', 'hold_created', 'hold_expired', 'appointment'] as const;
const isForbidden = (e: unknown) => { const x = e as { status?: number; code?: string } | null; return !!x && (x.status === 403 || x.code === 'PERMISSION_DENIED'); };
const errText = (e: unknown) => errorTextOf(e, t('pos.we_could_not_load_these_settings'));
const chanLabel = (c: string) => CHANNEL_LABEL[c] ?? statusLabel('source', c);

/** "4:12 left" from SERVER timestamps (guide §11: the client clock only animates; the server decides validity) */
function useCountdown(serverNow: string | undefined) {
  const [base] = useState(() => ({ server: serverNow ? Date.parse(serverNow) : Date.now(), local: Date.now() }));
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const offset = serverNow ? Date.parse(serverNow) - Date.now() + (Date.now() - base.local) : 0;
  return (iso: string | null | undefined) => {
    if (!iso) return '—';
    const ms = Date.parse(iso) - (Date.now() + offset);
    if (ms <= 0) return t('bv.lapsed');
    const s = Math.floor(ms / 1000);
    return t('bv.left', { s: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` });
  };
}

function VerificationOps({ settingsPanel, children }: { settingsPanel: ReactNode; children?: ReactNode }) {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [summary, setSummary] = useState<BvSummary | null>(null);
  const [sumErr, setSumErr] = useState<unknown>(null);
  const [health, setHealth] = useState<BvHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [live, setLive] = useState<BvPage<BvRow> | null>(null);
  const [livePage, setLivePage] = useState(1);
  const [hist, setHist] = useState<BvPage<BvRow> | null>(null);
  const [histErr, setHistErr] = useState<unknown>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [qText, setQText] = useState(sp.get('q') ?? '');
  const q = useDebounced(qText.trim(), 300);
  const f = {
    status: sp.get('status') ?? '', channel: sp.get('channel') ?? '', basis: sp.get('basis') ?? 'requested',
    preset: sp.get('preset') ?? 'all', from: sp.get('from') ?? '', to: sp.get('to') ?? '',
    page: Number(sp.get('page') ?? 1) || 1, pageSize: [10, 20, 50].includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10,
  };
  // safe view state in the URL (guide §12) — never the search text (it may be a phone number) and never a customer field
  const setView = useCallback((patch: Record<string, string | number | null>, keepPage = false) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) n.delete(k); else n.set(k, String(v)); }
      if (!keepPage) n.delete('page');
      return n;
    }, { replace: true });
  }, [setSp]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new search resets the page; setView changes with the URL
  useEffect(() => { if (q) setView({}, false); }, [q]);   // a new search goes back to page 1

  const loadSummary = useCallback(() => { bvApi.summary().then((x) => { setSummary(x); setSumErr(null); }).catch(setSumErr); }, []);
  const loadLive = useCallback(() => { bvApi.live({ page: livePage, pageSize: 10 }).then(setLive).catch(() => setLive(null)); }, [livePage]);
  const period: PeriodState = f.preset === 'custom' ? { preset: 'custom', from: f.from, to: f.to } : { preset: f.preset as PeriodState['preset'] };
  const histKey = JSON.stringify([q, f.status, f.channel, f.basis, f.preset, f.from, f.to, f.page, f.pageSize]);
  const loadHistory = useCallback(() => {
    setHistLoading(true);
    bvApi.history({ q: q || undefined, status: f.status || undefined, channel: f.channel || undefined, basis: f.basis, preset: f.preset,
      from: f.preset === 'custom' ? f.from : undefined, to: f.preset === 'custom' ? f.to : undefined, page: f.page, pageSize: f.pageSize })
      .then((x) => { setHist(x); setHistErr(null); }).catch(setHistErr).finally(() => setHistLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- histKey is the serialised query (every field it reads)
  }, [histKey]);
  useEffect(loadSummary, [loadSummary]);
  useEffect(loadLive, [loadLive]);
  useEffect(loadHistory, [loadHistory]);
  // live view: refresh every 15 s while the page is open (a visible "updated" stamp says when; never silently stale)
  useEffect(() => { const id = setInterval(() => { loadLive(); loadSummary(); }, 15_000); return () => clearInterval(id); }, [loadLive, loadSummary]);
  const refresh = () => { loadSummary(); loadLive(); loadHistory(); };
  const check = async () => { setChecking(true); try { setHealth(await bvApi.health()); } catch (e) { setHealth({ checkedAt: new Date().toISOString(), overall: 'unknown', items: [{ key: 'policy', state: 'unknown', message: errText(e), evidence: '—', nextAction: null, checkedAt: new Date().toISOString() }] }); } finally { setChecking(false); } };
  const tz = summary?.timezone;
  const when = (iso: string | null | undefined) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '—');
  const left = useCountdown(live?.serverNow);
  const c = summary?.cards;
  const filtersOn = !!(qText || f.status || f.channel || f.preset !== 'all' || f.basis !== 'requested');

  return (
    <>
      <div className="vh bv-head" style={{ marginBottom: 12 }}>
        <div>
          <h1>{t('pos.booking_phone_verification')}</h1>
          <div className="sub">{t('bv.sub')}{summary ? ` · ${t('bv.updated', { time: when(summary.generatedAt) })}` : ''}</div>
        </div>
        <div className="bv-actions">
          <button type="button" className="btn ghost" onClick={refresh} data-testid="bv-refresh">{t('bv.refresh')}</button>
          <button type="button" className="btn" onClick={check} disabled={checking} data-testid="bv-check">{checking ? t('bv.checking') : t('bv.check')}</button>
        </div>
      </div>

      {sumErr && isForbidden(sumErr) ? <div className="err" style={{ marginBottom: 10 }}>{t('bv.noPermission')}</div> : null}
      <div className="bv-kpis" data-testid="bv-kpis">
        <KpiCard label={t('bv.kpi.pending')} value={c ? fmtNumber(c.pending.value) : '—'} sub={t('bv.kpi.pendingSub')} loading={!c && !sumErr} testId="bv-kpi-pending" />
        <KpiCard label={t('bv.kpi.verified')} value={c ? fmtNumber(c.verifiedToday.value) : '—'} sub={t('bv.kpi.verifiedSub')} tone="ok" loading={!c && !sumErr} testId="bv-kpi-verified" />
        <KpiCard label={t('bv.kpi.failed')} value={c ? fmtNumber(c.failedToday.value) : '—'} sub={t('bv.kpi.failedSub')} tone={c && c.failedToday.value > 0 ? 'warn' : undefined} loading={!c && !sumErr} testId="bv-kpi-failed" />
        <KpiCard label={t('bv.kpi.holds')} value={c ? fmtNumber(c.activeHolds.value) : '—'} sub={c ? t('bv.kpi.holdsSub', { n: String(c.activeHolds.expiringSoon) }) : ''} loading={!c && !sumErr} testId="bv-kpi-holds" />
        <KpiCard label={t('bv.kpi.sms')} value={c ? t('bv.hs.' + c.smsHealth.state) : '—'} sub={c ? t('bv.kpi.smsSub', { n: String(c.smsHealth.providerErrors24h) }) : ''} tone={c ? HS_TONE[c.smsHealth.state] : undefined} loading={!c && !sumErr} onClick={check} testId="bv-kpi-sms" />
        <KpiCard label={t('bv.kpi.rate')} value={c ? (c.successRate.value == null ? '—' : `${c.successRate.value}%`) : '—'} loading={!c && !sumErr} testId="bv-kpi-rate"
          sub={c ? (c.successRate.value == null ? t('bv.kpi.rateUnknown') : t('bv.kpi.rateSub', { ok: fmtNumber(c.successRate.numerator), all: fmtNumber(c.successRate.denominator) })) : ''} />
      </div>
      {summary?.providerFailures ? (
        <section className="panel bv-triage" data-testid="bv-triage" style={{ marginBottom: 12 }}>
          <div className="p-h">{t('bv.triage.title', { d: String(summary.providerFailures.windowDays) })}</div>
          {summary.providerFailures.groups.length === 0 ? <div className="sub" style={{ fontSize: 13 }} data-testid="bv-triage-none">{t('bv.triage.none', { d: String(summary.providerFailures.windowDays) })}</div> : (
            <ul className="bv-checks">
              {summary.providerFailures.groups.map((g) => (
                <li key={g.category} data-testid={'bv-triage-' + g.category}>
                  <div className="bv-check-top"><strong>{t('bv.triage.cat.' + g.category)}</strong><span className="pm-chip">{fmtNumber(g.count)}</span></div>
                  <div className="sub" style={{ fontSize: 12 }}>{t('bv.triage.fix.' + g.category)}{g.codes.length ? ' · ' + t('bv.triage.codes', { c: g.codes.join(', ') }) : ''}{g.lastAt ? ' · ' + when(g.lastAt) : ''}</div>
                </li>))}
            </ul>)}
        </section>) : null}
      {summary?.funnel ? (
        <section className="panel bv-funnel" data-testid="bv-funnel" style={{ marginBottom: 12 }}>
          <div className="p-h">{t('bv.funnel.title', { d: String(summary.funnel.windowDays) })}</div>
          <ol style={{ display: 'grid', gridTemplateColumns: `repeat(${summary.funnel.steps.length}, minmax(0, 1fr))`, gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {summary.funnel.steps.map((s, i) => (
              <li key={s.key} title={s.definition} data-testid={'bv-funnel-' + s.key}>
                <div className="sub" style={{ fontSize: 12 }}>{t('bv.funnel.' + s.key)}</div>
                <strong style={{ fontSize: 20 }}>{fmtNumber(s.count)}</strong>
                {i > 0 ? <div className="sub" style={{ fontSize: 11 }}>{s.conversionPercent == null ? t('bv.funnel.convUnknown') : t('bv.funnel.conv', { p: String(s.conversionPercent) })}</div> : null}
              </li>))}
          </ol>
          <div className="sub" style={{ fontSize: 12, marginTop: 6 }} title={summary.funnel.overridesDefinition} data-testid="bv-funnel-overrides">{t('bv.funnel.overrides', { n: fmtNumber(summary.funnel.overrides) })}</div>
        </section>) : null}

      <div className="bv-grid">
        <div className="bv-col">{settingsPanel}</div>
        <section className="panel bv-health" data-testid="bv-health">
          <div className="p-h">{t('bv.health')}</div>
          {/* SUNMI addendum §04–§05 (Nov 7 2026): before a check runs, the column still says WHAT it checks — the six readiness
              items, each "Not checked yet" — so Settings and Health carry equal weight instead of an empty right half */}
          {!health ? <>
            <div className="sub" style={{ fontSize: 13, marginBottom: 8 }}>{t('bv.health.never')}</div>
            <ul className="bv-checks" data-testid="bv-checks-pending">
              {(['twilio_identity', 'verify_service', 'sender', 'policy', 'recent_errors', 'integration'] as const).map((k) => (
                <li key={k} data-testid={'bv-pending-' + k}>
                  <div className="bv-check-top"><strong>{t('bv.hk.' + k)}</strong><span className="pm-chip">{t('bv.hs.unchecked')}</span></div>
                  <div className="sub" style={{ fontSize: 12 }}>{t('bv.hd.' + k)}</div>
                </li>))}
            </ul>
            <button type="button" className="btn" style={{ marginTop: 10, minHeight: 44 }} onClick={check} disabled={checking} data-testid="bv-check-inline">{checking ? t('bv.checking') : t('bv.check')}</button>
          </> : (
            <>
              <div className="sub" style={{ fontSize: 12, marginBottom: 8 }}>{t('bv.health.checkedAt', { time: when(health.checkedAt) })}</div>
              <ul className="bv-checks">
                {health.items.map((i) => (
                  <li key={i.key} data-testid={'bv-check-' + i.key}>
                    <div className="bv-check-top"><strong>{t('bv.hk.' + i.key)}</strong><span className={'pm-chip ' + (HS_TONE[i.state] === 'ok' ? 'ok' : HS_TONE[i.state] === 'bad' ? 'bad' : 'warn')}>{t('bv.hs.' + i.state)}</span></div>
                    <div style={{ fontSize: 12.5 }}>{i.message}</div>
                    <div className="sub" style={{ fontSize: 11.5 }}>{i.evidence}</div>
                    {i.nextAction ? <div style={{ fontSize: 12 }}><em>{t('bv.health.next')}</em> {i.nextAction}</div> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="panel bv-live" data-testid="bv-live">
        <div className="p-h">{t('bv.live')}</div>
        <div className="sub" style={{ fontSize: 12, marginBottom: 8 }}>{t('bv.live.order')}</div>
        {!live ? <div className="state" role="status">{t('pos.loading')}</div> : live.items.length === 0 ? <Empty title={t('bv.live.empty')} /> : (
          <div className="bv-table-wrap">
            <table className="tbl bv-table" data-testid="bv-live-table">
              <thead><tr><th>{t('bv.col.customer')}</th><th>{t('bv.col.booking')}</th><th>{t('bv.col.channel')}</th><th>{t('bv.col.status')}</th><th>{t('bv.col.hold')}</th><th>{t('bv.col.attempts')}</th></tr></thead>
              <tbody>{live.items.map((r) => (
                <tr key={r.id} className="bv-row" onClick={() => setOpenId(r.id)} data-testid="bv-live-row">
                  <td><div style={{ fontWeight: 700 }}>{r.customerName || t('bv.unknownCustomer')}</div><div className="sub bv-small">{r.maskedPhone}</div></td>
                  <td className="bv-small">{r.hold?.startsAt ? when(r.hold.startsAt) : '—'}{r.hold?.technicianName ? ` · ${r.hold.technicianName}` : ''}</td>
                  <td>{chanLabel(r.channel)}</td>
                  <td><span className={'pm-chip ' + (r.status === 'verified' ? 'ok' : r.status === 'pending' ? 'gold' : 'bad')}>{t('bv.st.' + r.status)}</span> <span className="sub bv-small" data-testid="bv-code-left">{r.status === 'pending' ? left(r.expiresAt) : ''}</span></td>
                  <td><span className={'pm-chip ' + (r.hold?.status === 'active' ? 'ok' : r.hold?.status === 'expiring_soon' ? 'warn' : '')}>{t('bv.hold.' + (r.hold?.status ?? 'none'))}</span> <span className="sub bv-small">{r.hold && ['active', 'expiring_soon'].includes(r.hold.status) ? left(r.hold.expiresAt) : ''}</span></td>
                  <td>{r.attempts}{r.resends ? ` · ↻${r.resends}` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pager info={live} onPage={setLivePage} compact />
      </section>

      <section className="panel bv-history" data-testid="bv-history">
        <div className="p-h">{t('bv.history')}</div>
        <div className="bv-filters">
          <input className="fk-input bv-search" type="search" value={qText} onChange={(e) => setQText(e.target.value)} placeholder={t('bv.search')} aria-label={t('bv.search')} maxLength={100} data-testid="bv-search" />
          <select className="fk-select" value={f.status} onChange={(e) => setView({ status: e.target.value })} aria-label={t('bv.f.status')} data-testid="bv-f-status">
            <option value="">{t('bv.f.status')}: {t('bv.f.all')}</option>
            {BV_STATUSES.map((x) => <option key={x} value={x}>{t('bv.st.' + x)}</option>)}
          </select>
          <select className="fk-select" value={f.channel} onChange={(e) => setView({ channel: e.target.value })} aria-label={t('bv.f.channel')} data-testid="bv-f-channel">
            <option value="">{t('bv.f.channel')}: {t('bv.f.all')}</option>
            {BV_CHANNELS.map((x) => <option key={x} value={x}>{chanLabel(x)}</option>)}
          </select>
          {filtersOn ? <button type="button" className="btn ghost" onClick={() => { setQText(''); setView({ status: null, channel: null, basis: null, preset: null, from: null, to: null, size: null }); }} data-testid="bv-clear">{t('bv.f.clear')}</button> : null}
        </div>
        <PeriodBar compact allowAll value={period} server={(hist?.period ?? null) as ServerPeriod | null} basis={f.basis}
          basisOptions={BV_BASES.map((b) => ({ value: b, label: t('bv.basis.' + b) }))} onBasis={(b) => setView({ basis: b })}
          onChange={(p) => setView({ preset: p.preset, from: p.from ?? null, to: p.to ?? null })} />
        <div className="sub bv-small" data-testid="bv-order">{t('bv.history.order')}</div>
        {histErr ? (isForbidden(histErr) ? <div className="err">{t('bv.noPermission')}</div> : <ErrorRetry message={errText(histErr)} onRetry={loadHistory} />)
          : !hist ? <div className="state" role="status">{t('pos.loading')}</div>
          : hist.items.length === 0 ? <Empty title={t('bv.history.empty')} />
          : (
            <div className="bv-table-wrap" aria-busy={histLoading}>
              <table className="tbl bv-table" data-testid="bv-history-table">
                <thead><tr><th>{t('bv.col.requested')}</th><th>{t('bv.col.customer')}</th><th>{t('bv.col.phone')}</th><th>{t('bv.col.booking')}</th><th>{t('bv.col.channel')}</th><th>{t('bv.col.tech')}</th><th>{t('bv.col.status')}</th><th>{t('bv.col.hold')}</th></tr></thead>
                <tbody>{hist.items.map((r) => (
                  <tr key={r.id} className="bv-row" onClick={() => setOpenId(r.id)} data-testid="bv-history-row">
                    <td className="bv-small">{when(r.requestedAt)}</td>
                    <td>{r.customerName || t('bv.unknownCustomer')}</td>
                    <td className="bv-small">{r.maskedPhone}</td>
                    <td className="bv-small">{r.appointmentId ? '#' + r.appointmentId.slice(0, 8) : r.hold?.startsAt ? when(r.hold.startsAt) : '—'}</td>
                    <td>{chanLabel(r.channel)}</td>
                    <td className="bv-small">{r.hold?.technicianName || '—'}</td>
                    <td><span className={'pm-chip ' + (r.status === 'verified' ? 'ok' : r.status === 'pending' ? 'gold' : 'bad')}>{t('bv.st.' + r.status)}</span></td>
                    <td className="bv-small">{t('bv.hold.' + (r.hold?.status ?? 'none'))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        <div className="bv-pagerow">
          <Pager info={hist} onPage={(p) => setView({ page: p > 1 ? p : null }, true)} />
          <select className="fk-select" value={f.pageSize} onChange={(e) => setView({ size: Number(e.target.value) === 10 ? null : e.target.value })} aria-label={t('pos.rows_per_page')} data-testid="bv-size">
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </section>

      {children}
      {openId ? <VerificationDetail id={openId} when={when} onClose={() => setOpenId(null)} onOpenCustomer={(cid) => nav(`/customers?customerId=${encodeURIComponent(cid)}`)} onOpenBooking={() => nav('/booking')} onChanged={refresh} /> : null}
    </>
  );
}

function VerificationDetail({ id, when, onClose, onOpenCustomer, onOpenBooking, onChanged }: { id: string; when: (iso: string | null | undefined) => string; onClose: () => void; onOpenCustomer: (id: string) => void; onOpenBooking: () => void; onChanged: () => void }) {
  const [d, setD] = useState<BvDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { bvApi.detail(id).then(setD).catch(setErr); }, [id]);
  const resend = async () => {
    setBusy(true); setNote(null);
    try { const r = await bvApi.resend(id); setNote(r.status === 'sent' || r.status === 'code_sent' ? t('bv.d.resendSent') : t('bv.d.resendOther', { msg: r.message || r.status })); onChanged(); }
    catch (e) { setNote(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog title={t('bv.detail')} subtitle={d ? `${d.customerName || t('bv.unknownCustomer')} · ${d.maskedPhone}` : undefined} onClose={onClose} busy={busy} wide testId="bv-detail"
      footer={<div className="bv-dfoot">
        {d?.customerId ? <button type="button" className="btn ghost" onClick={() => onOpenCustomer(d.customerId!)} data-testid="bv-open-customer">{t('bv.d.openCustomer')}</button> : null}
        {d?.appointmentId ? <button type="button" className="btn ghost" onClick={onOpenBooking} data-testid="bv-open-booking">{t('bv.d.openBooking')}</button> : null}
        {d?.canResend ? <button type="button" className="btn" disabled={busy} onClick={resend} data-testid="bv-resend">{t('bv.d.resend')}</button> : null}
        <button type="button" className="btn ghost" onClick={onClose} data-testid="bv-close">{t('bv.close')}</button>
      </div>}>
      {err ? <ErrorRetry message={errText(err)} onRetry={() => { setErr(null); bvApi.detail(id).then(setD).catch(setErr); }} /> : !d ? <div className="state" role="status">{t('pos.loading')}</div> : (
        <div className="bv-detail">
          <div className="bv-dgrid">
            <div><div className="sub">{t('bv.col.status')}</div><span className={'pm-chip ' + (d.status === 'verified' ? 'ok' : d.status === 'pending' ? 'gold' : 'bad')}>{t('bv.st.' + d.status)}</span>{d.staffOverride ? <div className="bv-small">{t('bv.d.override')}</div> : null}</div>
            <div><div className="sub">{t('bv.col.channel')}</div>{chanLabel(d.channel)}</div>
            <div><div className="sub">{t('bv.d.branch')}</div>{d.branchName || '—'}</div>
            <div><div className="sub">{t('bv.d.time')}</div>{d.hold?.startsAt ? when(d.hold.startsAt) : '—'}{d.hold?.technicianName ? ` · ${d.hold.technicianName}` : ''}</div>
            <div><div className="sub">{t('bv.d.services')}</div>{d.services.length ? d.services.join(', ') : '—'}</div>
            <div><div className="sub">{t('bv.col.hold')}</div>{t('bv.hold.' + (d.hold?.status ?? 'none'))}{d.hold?.expiresAt ? ` · ${when(d.hold.expiresAt)}` : ''}</div>
            <div><div className="sub">{t('bv.d.attempts')}</div>{d.attempts} / {d.resends}</div>
            <div><div className="sub">{t('bv.d.provider')}</div>{statusLabel('provider', d.provider.kind)}{d.provider.reference ? ` · ${d.provider.reference}` : ''}</div>
          </div>
          <div className="p-h" style={{ marginTop: 12 }}>{t('bv.d.why')}</div>
          <div data-testid="bv-why">{d.policy.why || t('bv.d.whyNone')}</div>
          <div className="sub bv-small">{t('bv.d.policy')}: {[d.policy.version, d.policy.tenantVersion, d.policy.branchVersion, d.policy.providerVersion].map((x) => x ?? '—').join(' / ')}</div>
          <div className="p-h" style={{ marginTop: 12 }}>{t('bv.d.timeline')}</div>
          <ol className="bv-timeline" data-testid="bv-timeline">{d.timeline.map((e, i) => <li key={i}><span className="sub bv-small">{when(e.at)}</span> {e.event}</li>)}</ol>
          <div className="sub bv-small" style={{ marginTop: 8 }}>{t('bv.d.noCode')}</div>
          {note ? <div data-testid="bv-resend-note" style={{ marginTop: 8 }}>{note}</div> : null}
        </div>
      )}
    </FitDialog>
  );
}
