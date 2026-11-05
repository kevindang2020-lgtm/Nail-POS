import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { useInlineAsk } from '@aipowersalon/ui';
import type { BookingVerificationUsageView, PendingVerificationView } from '@aipowersalon/api-contracts';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtDateTime } from '../i18n/format';
import { statusLabel } from '../i18n/status-label';
import { msg, renderMsg, type Msg } from '../i18n/notice';


interface Settings {
  enabled: boolean;
  channels: { online: boolean; customerApp: boolean; aiReceptionist: boolean };
  verifyEveryBooking: boolean;
  reverifyAfterSeconds: number;
  reverifyOnGroupBooking: boolean;
  reverifyOnDeposit: boolean;
  reverifyOnHighValue: boolean;
  holdSeconds: number;
  version: number;
  provider: { connected: boolean; validated: boolean; blockedReason: string | null };
  platform: { requiredByPlatform: boolean; blockedByPlatform: boolean; emergencyDisabled: boolean; moduleDisabled?: boolean };
}

/** a verification channel code → its label (read at render: a getter table, never translated at import) */
const CHANNEL_LABEL: Record<string, string> = {
  get online() { return t('ops.verify.channel.online'); }, get customer_app() { return t('pos.customer_app'); },
  get ai_receptionist() { return t('pos.ai_receptionist'); }, get kiosk() { return t('ops.verify.channel.kiosk'); },
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

function CheckOption({ label, hint, on, disabled, onChange }: { label: string; hint?: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16 }} />
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
    <div className="work">
      <div className="vh" style={{ marginBottom: 12 }}>
        <h1>{t('pos.booking_phone_verification')}</h1>
        <div className="sub">{t('pos.send_a_6_digit_code_to_1vjx')}</div>
      </div>

      {s.platform.emergencyDisabled ? (
        <div className="panel" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12, maxWidth: 640 }}>
          {t('pos.temporarily_disabled_by_platform_operations_your_pge8')}
        </div>
      ) : null}
      {s.platform.requiredByPlatform ? (
        <div className="panel" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12, maxWidth: 640 }}>
          <strong>{t('pos.required_by_ai_powersalon_platform_policy')}</strong> {t('pos.phone_verification_cannot_be_turned_off_1c0j')}
        </div>
      ) : null}
      {s.platform.moduleDisabled ? (
        <div className="panel" data-testid="module-disabled" style={{ background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', marginBottom: 12, maxWidth: 640 }}>
          {t('pos.phone_verification_is_not_available_on_mi47')}
        </div>
      ) : null}
      {s.platform.blockedByPlatform ? (
        <div className="err" style={{ marginBottom: 12, maxWidth: 640 }}>
          {t('pos.phone_verification_is_unavailable_for_this_imds')}
        </div>
      ) : null}

      {!providerReady ? (
        <div className="panel" style={{ background: '#FBEDE9', borderColor: '#F0D2C9', marginBottom: 12, maxWidth: 640 }}>
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

      <section className="panel" style={{ maxWidth: 640 }}>
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

          {/* Phase 4 (decided): the "always re-verify group / deposit / high-value bookings" switches are not shown — no remote
              booking path (app, link, AI receptionist) has a party size, a deposit step or a high-value threshold to feed
              them, so they could only promise something that never happened. "Every booking" covers the strict case. */}
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

      {pending ? (
        <section className="panel" data-testid="pending-verifications" style={{ maxWidth: 640, marginTop: 14 }}>
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
        <section className="panel" data-testid="verification-usage" style={{ maxWidth: 640, marginTop: 14 }}>
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
      {askUi}
    </div>
  );
}
