// POSCustomerPhoneEditor.tsx — Change phone number (the receptionist's side of the ONE canonical phone flow).
//
// ── Why this is a FLOW and not a field ──────────────────────────────────────────────────────────────────
//
// Typing a phone number used to change, immediately and silently: where every booking code is sent, where every
// appointment reminder goes, and who the AI receptionist thinks is calling — with no proof the customer holds it. So it
// is a flow: enter → duplicate check → (manager approval, if the salon requires it) → code → the number becomes real.
//
// BUILD_PLAN Phase 3 (customer_phone_number_management) completed it:
//   • it opens on the customer's CURRENT state (GET …/phone/status): the number, whether it is verified, and any change
//     already in flight — which it resumes instead of colliding with;
//   • the record version comes from that status, so a stale screen cannot overwrite a newer number (the POS never sent it);
//   • a country selector — not every customer's phone is North American;
//   • with SMS not required by the salon, the change is DONE when the server says so (audit E9: it then called
//     /phone//send and showed a false error);
//   • a change waiting for approval says so, and a manager can approve it right here;
//   • a duplicate a receptionist may not resolve can be resolved by a manager, with a reason;
//   • a manager may confirm a number WITHOUT a code (if the salon allows it) — labelled "OTP not completed", always;
//   • Twilio not connected → a button to the Text Messaging Setup screen;
//   • resend has a countdown; a synchronisation still running says so, and a manager can retry it.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';
import { posCustomersApi } from '../api/posCustomersApi';
import { useCan } from '../components/usePermissions';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange, #A96F22)';
const LINE = 'var(--line, #E7DBC6)';
const TEXT = 'var(--text, #2B2118)';
const MUTED = '#7A6C57';
const BAD = '#8F3226';

interface DuplicateMatch { customerId: string; maskedName: string; status: string }
interface Duplicates { outcome: string; requiresResolution: boolean; requiresManager: boolean; matches: DuplicateMatch[]; message: string }

export interface PhoneEditorProps {
  customerId: string;
  customerName: string;
  /** The number on file as the list shows it (used until the status loads). */
  currentMasked: string | null;
  /** Optional: the record version the caller already holds. The editor reads the current one from the server. */
  recordVersion?: number;
  onDone: () => void;
  onCancel: () => void;
}

type Step = 'enter' | 'duplicates' | 'approval' | 'code' | 'done';

/** Calling codes offered at the counter. Anything else: type the number with its "+". */
export const COUNTRIES: { code: string; label: string }[] = [
  { code: '1', get label() { return tx('pos.us_canada_1'); } }, { code: '52', get label() { return tx('pos.mexico_52'); } }, { code: '44', get label() { return tx('pos.united_kingdom_44'); } },
  { code: '84', get label() { return tx('pos.vietnam_84'); } }, { code: '63', get label() { return tx('pos.philippines_63'); } }, { code: '82', get label() { return tx('pos.south_korea_82'); } },
  { code: '86', get label() { return tx('pos.china_86'); } }, { code: '91', get label() { return tx('pos.india_91'); } }, { code: '61', get label() { return tx('pos.australia_61'); } },
  { code: '57', get label() { return tx('pos.colombia_57'); } }, { code: '55', get label() { return tx('pos.brazil_55'); } }, { code: '49', get label() { return tx('pos.germany_49'); } },
];

/** What the server receives: "+<code><digits>", or the number as typed when it already starts with "+". */
export function withCountry(countryCode: string, raw: string): string {
  const t = raw.trim();
  if (t.startsWith('+')) return t;
  const digits = t.replace(/\D/g, '');
  if (!digits) return '';
  // A North American number typed with its leading 1 stays one number, not "+11…".
  if (countryCode === '1' && digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Outside North America a nationally-written number starts with the trunk prefix "0", which is NOT part of the
  // international number (UK 07700 900123 → +44 7700 900123; Vietnam 090… → +84 90…).
  const national = countryCode !== '1' && digits.startsWith('0') ? digits.slice(1) : digits;
  return `+${countryCode}${national}`;
}

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13.5, marginBottom: 10 };
const primary = (disabled: boolean): React.CSSProperties => ({ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: disabled ? 0.5 : 1 });
const ghost: React.CSSProperties = { background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: MUTED };
const RESEND_SECONDS = 30;

export function POSCustomerPhoneEditor({ customerId, customerName, currentMasked, recordVersion, onDone, onCancel }: PhoneEditorProps) {
  const nav = useNavigate();
  const can = useCan();
  const isManager = can('customers.phone_manage');

  const [status, setStatus] = useState<CustomerPhoneStatus | null>(null);
  const [step, setStep] = useState<Step>('enter');
  const [country, setCountry] = useState('1');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sharedFamily, setSharedFamily] = useState(false);
  const [resolution, setResolution] = useState<'shared_family_phone' | 'different_people' | 'same_person_keep_separate'>('different_people');
  const [managerReason, setManagerReason] = useState('');

  const [sessionId, setSessionId] = useState('');
  const [maskedNew, setMaskedNew] = useState('');
  const [dups, setDups] = useState<Duplicates | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [noProvider, setNoProvider] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [onDisplay, setOnDisplay] = useState(false);   // the code pad is up on the customer display

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const full = withCountry(country, phone);

  const loadStatus = useCallback(async () => {
    try {
      const s = await posCustomersApi.phoneStatus(customerId);
      setStatus(s);
      // A change already in flight is RESUMED, not collided with (one open change per customer).
      if (s.openChange && !s.openChange.expired) {
        setSessionId(s.openChange.sessionId); setMaskedNew(s.openChange.maskedPhone);
        if (s.openChange.state === 'manager_review_required') setStep('approval');
        else if (['verification_sent', 'verification_failed', 'verification_expired', 'pending_phone_saved', 'twilio_not_configured', 'verification_send_failed'].includes(s.openChange.state)) setStep('code');
      }
    } catch { /* the editor still works without the status — the server re-checks everything */ }
  }, [customerId]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (resendIn <= 0) return; const t = setTimeout(() => setResendIn((n) => n - 1), 1000); return () => clearTimeout(t); }, [resendIn]);

  const finish = () => { setStep('done'); onDone(); };

  // The customer is typing the code on the display: watch for the change to land (or to stop being open) and finish.
  useEffect(() => {
    if (!onDisplay || !sessionId) return;
    const t = setInterval(() => {
      void posCustomersApi.phoneStatus(customerId).then((s) => {
        if (!s.openChange || s.openChange.sessionId !== sessionId) {
          setOnDisplay(false); setStatus(s);
          const landed = s.lastChange?.sessionId === sessionId && ['phone_activated', 'customer_records_synchronized', 'synchronization_failed'].includes(s.lastChange.state);
          if (landed) finish(); else { setNote(null); setErr(tx('pos.the_change_was_not_completed_on_jyhz')); }
        }
      }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [onDisplay, sessionId, customerId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toDisplay = async () => {
    setBusy(true); setErr(null);
    try { await posCustomersApi.phoneToDisplay(customerId, sessionId); setOnDisplay(true); setNote(tx('pos.the_code_pad_is_on_the_1g2v', { customerName: String(customerName) })); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_show_the_code_on_dezh')); }
    finally { setBusy(false); }
  };

  const start = async (opts: { assertShared?: boolean; resolve?: boolean } = {}) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const body = { phone: full, reason: (opts.resolve ? managerReason : reason).trim() || undefined, expectedVersion: status?.recordVersion ?? recordVersion, sharedFamilyPhone: !!opts.assertShared, idempotencyKey: `pos-${customerId}-${full}-${Date.now()}` };
      const r = opts.resolve ? await posCustomersApi.phoneResolve(customerId, { ...body, resolution, reason: managerReason.trim() }) : await posCustomersApi.phoneStart(customerId, body);
      setSessionId(r.sessionId); setMaskedNew(r.maskedPhone);
      if (r.state === 'phone_activated' || !r.sessionId) { finish(); return; }          // salon policy: no SMS — done (audit E9)
      if (r.state === 'manager_review_required') { setStep('approval'); return; }
      await send(r.sessionId);
    } catch (e: any) {
      if (e?.code === 'duplicate_conflict' && e?.duplicates) { setDups(e.duplicates as Duplicates); setStep('duplicates'); }
      else if (e?.code === 'VERSION_CONFLICT' || e?.code === 'stale_record') { setErr(e?.message || tx('pos.this_customer_was_changed_by_someone_1mhv')); void loadStatus(); }
      else setErr(e?.message || tx('pos.we_could_not_save_that_number'));
    } finally { setBusy(false); }
  };

  const send = async (sid: string) => {
    setErr(null); setNoProvider(false);
    try {
      const r = await posCustomersApi.phoneSend(customerId, sid, full);
      setNote(r.message); setStep('code'); setResendIn(RESEND_SECONDS);
    } catch (e: any) {
      setStep('code');
      if (e?.code === 'no_provider') { setNoProvider(true); setErr(tx('pos.phone_saved_but_verification_could_not_1gfn')); }
      else setErr(e?.message || tx('pos.we_could_not_send_a_verification_1wyr'));
    }
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await posCustomersApi.phoneVerify(customerId, sessionId, full, code.trim());
      if (r.activated) finish(); else { setErr(r.message); setCode(''); }
    } catch (e: any) { setErr(e?.message || tx('pos.that_code_is_incorrect')); setCode(''); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await posCustomersApi.phoneApprove(customerId, sessionId);
      if (r.activated) { finish(); return; }
      setNote(tx('pos.approved_re_enter_the_new_number_1wv0')); setStep('code');
    } catch (e: any) { setErr(e?.message || tx('pos.we_could_not_approve_this_change')); }
    finally { setBusy(false); }
  };

  const manualConfirm = async () => {
    setBusy(true); setErr(null);
    try { await posCustomersApi.phoneManualConfirm(customerId, sessionId, full, managerReason.trim()); finish(); }
    catch (e: any) { setErr(e?.message || tx('pos.we_could_not_confirm_this_number')); }
    finally { setBusy(false); }
  };

  const retrySync = async () => {
    if (!status?.lastChange) return;
    setBusy(true); setErr(null);
    try { await posCustomersApi.phoneRetrySync(customerId, status.lastChange.sessionId); setNote(tx('pos.all_records_are_up_to_date')); void loadStatus(); }
    catch (e: any) { setErr(e?.message || tx('pos.still_could_not_update_every_record_19ax')); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (sessionId) await posCustomersApi.phoneCancel(customerId, sessionId).catch(() => undefined);
    onCancel();
  };

  const header = (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, color: TEXT, marginBottom: 2 }}>{tx('pos.change_phone_number')}</div>
      <div style={{ fontSize: 12, color: MUTED }} data-testid="phone-current">
        {tx('pos.current')}{' '}<strong>{status?.phone?.display ?? currentMasked ?? tx('pos.none_on_file')}</strong>
        {status?.phone ? <span style={{ marginLeft: 6, color: status.phone.verified ? '#2E7D4F' : '#7A5A12' }}>· {status.phone.label}</span> : null}
      </div>
      {status?.sync === 'retrying' ? (
        <div role="status" style={{ fontSize: 12, color: '#7A5A12', background: '#FBF3DE', border: '1px solid #ECDCAE', borderRadius: 6, padding: '6px 8px', marginTop: 8 }} data-testid="phone-sync">
          {tx('pos.the_last_change_is_active_but_i7is')}
          {isManager ? <button onClick={() => void retrySync()} disabled={busy} style={{ marginLeft: 8, background: 'none', border: 0, color: GOLD, fontWeight: 600, cursor: 'pointer' }}>{tx('pos.retry_now')}</button> : null}
        </div>
      ) : null}
    </div>
  );
  const messages = (
    <>
      {note ? <div role="status" style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>{note}</div> : null}
      {err ? <div role="alert" style={{ fontSize: 12.5, color: BAD, marginBottom: 8 }}>{err}</div> : null}
      {noProvider ? <button onClick={() => nav('/tenant/communications/messaging-setup')} style={{ ...ghost, color: GOLD, fontWeight: 600, marginBottom: 10 }}>{tx('pos.open_twilio_settings')}</button> : null}
    </>
  );

  if (step === 'enter') {
    return (
      <div style={{ padding: 14, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }}>
        {header}
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={tx('pos.country')} style={{ ...input, width: 170 }}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx('pos.new_mobile_number')} inputMode="tel" style={input} aria-label={tx('pos.new_phone_number')} />
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.reason_for_the_change_e_g_19ah')} style={input} aria-label={tx('pos.reason_for_change')} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: TEXT, marginBottom: 12 }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            {tx('pos.i_confirmed_this_number_with')}{' '}<strong>{customerName}</strong> {tx('pos.in_person')}
            <span style={{ display: 'block', color: MUTED, fontSize: 11.5 }}>{tx('pos.a_code_is_texted_to_the_witc')}</span>
          </span>
        </label>
        {messages}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void start()} disabled={busy || !full || !confirmed} style={primary(busy || !full || !confirmed)}>{busy ? tx('pos.saving_2') : tx('pos.save_and_continue')}</button>
          <button onClick={cancel} style={ghost}>{tx('pos.cancel')}</button>
        </div>
      </div>
    );
  }

  if (step === 'duplicates' && dups) {
    return (
      <div style={{ padding: 14, border: '1px solid #F0D2C9', borderRadius: 10, background: '#FBEDE9' }} role="alert">
        <div style={{ fontWeight: 700, color: BAD, marginBottom: 6 }}>{tx('pos.this_number_is_already_in_use')}</div>
        <div style={{ fontSize: 13, color: BAD, marginBottom: 10 }}>{dups.message}</div>
        {/* MASKED. A duplicate warning must not become a customer directory — staff see enough to decide, and no more. */}
        <div style={{ fontSize: 12.5, color: TEXT, marginBottom: 12 }}>{dups.matches.map((m) => <div key={m.customerId} style={{ padding: '4px 0' }}>• {m.maskedName}</div>)}</div>
        {!dups.requiresManager && !isManager ? (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginBottom: 10 }}>
              <input type="checkbox" checked={sharedFamily} onChange={(e) => setSharedFamily(e.target.checked)} style={{ marginTop: 2 }} />
              <span>{tx('pos.this_is_a')}{' '}<strong>{tx('pos.shared_family_phone')}</strong> {tx('pos.both_customers_really_do_use_this_1o5l')}<span style={{ display: 'block', color: MUTED, fontSize: 11.5 }}>{tx('pos.the_two_records_stay_separate_nothing_9ly6')}</span></span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void start({ assertShared: true })} disabled={!sharedFamily || busy} style={primary(!sharedFamily || busy)}>{tx('pos.continue_as_a_shared_number')}</button>
              <button onClick={cancel} style={ghost}>{tx('pos.cancel')}</button>
            </div>
          </>
        ) : isManager ? (
          <div data-testid="manager-resolve">
            <div style={{ fontSize: 12.5, color: TEXT, marginBottom: 6 }}>{tx('pos.as_a_manager_you_can_let_q5pp')}</div>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} aria-label={tx('pos.resolution')} style={input}>
              <option value="shared_family_phone">{tx('pos.a_shared_family_phone')}</option>
              <option value="different_people">{tx('pos.different_people_the_other_record_is_6o3z')}</option>
              <option value="same_person_keep_separate">{tx('pos.same_person_keep_the_records_separate_1qya')}</option>
            </select>
            <input value={managerReason} onChange={(e) => setManagerReason(e.target.value)} placeholder={tx('pos.reason_at_least_12_characters')} style={input} aria-label={tx('pos.manager_reason')} />
            {messages}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void start({ resolve: true })} disabled={busy || managerReason.trim().length < 12} style={primary(busy || managerReason.trim().length < 12)}>{tx('pos.resolve_and_continue')}</button>
              <button onClick={cancel} style={ghost}>{tx('pos.cancel')}</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: BAD }}>{tx('pos.a_manager_must_review_this_before_1oj0')}</div>
        )}
      </div>
    );
  }

  if (step === 'approval') {
    return (
      <div style={{ padding: 14, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }} data-testid="phone-approval">
        {header}
        <div style={{ fontSize: 12, color: '#7A5A12', background: '#FBF3DE', border: '1px solid #ECDCAE', borderRadius: 6, padding: '6px 8px', marginBottom: 12 }}>
          <strong>{maskedNew}</strong> {tx('pos.waiting_for_a_manager_s_approval_1h4l')}
        </div>
        {messages}
        <div style={{ display: 'flex', gap: 8 }}>
          {isManager ? <button onClick={() => void approve()} disabled={busy} style={primary(busy)}>{busy ? tx('pos.approving') : tx('pos.approve_change')}</button> : null}
          <button onClick={cancel} style={ghost}>{tx('pos.cancel_the_change')}</button>
        </div>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div style={{ padding: 14, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }}>
        {header}
        {/* Saved, and honest about what it is: an unverified number that LOOKS verified is one the salon starts relying on. */}
        <div style={{ fontSize: 12, color: '#7A5A12', background: '#FBF3DE', border: '1px solid #ECDCAE', borderRadius: 6, padding: '6px 8px', margin: '0 0 12px' }}>
          <strong>{maskedNew}</strong> {tx('pos.unverified_sms_verification_pending')}
        </div>
        {!full ? (
          <>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>{tx('pos.re_enter_the_new_number_to_1i6m')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={tx('pos.country')} style={{ ...input, width: 170 }}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx('pos.the_number_ending_v0', { v0: String(maskedNew.replace(/[^0-9]/g, '')) })} inputMode="tel" style={input} aria-label={tx('pos.new_phone_number')} />
            </div>
          </>
        ) : null}
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10 }}>{tx('pos.ask')}{' '}<strong>{customerName}</strong> {tx('pos.to_read_the_6_digit_code_17rm')}</div>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tx('pos.6_digit_code')} inputMode="numeric" maxLength={6}
          style={{ ...input, letterSpacing: 4, fontSize: 18, fontWeight: 700, textAlign: 'center' }} aria-label={tx('pos.verification_code_2')} />
        {messages}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => void verify()} disabled={busy || code.length !== 6 || !full} style={primary(busy || code.length !== 6 || !full)}>{busy ? tx('pos.verifying') : tx('pos.verify_and_activate')}</button>
          <button onClick={() => void send(sessionId)} disabled={busy || resendIn > 0 || !full} style={{ ...ghost, color: GOLD, fontWeight: 600 }} data-testid="resend">
            {resendIn > 0 ? tx('pos.resend_code_in_resendin_s', { resendIn: String(resendIn) }) : tx('pos.resend_code')}
          </button>
          <button onClick={() => void toDisplay()} disabled={busy || onDisplay} style={{ ...ghost, fontSize: 12 }} data-testid="to-display">{onDisplay ? tx('pos.waiting_for_the_display_2') : tx('pos.enter_the_code_on_the_customer_1so7')}</button>
          {isManager ? <button onClick={() => setManualOpen((v) => !v)} style={{ ...ghost, fontSize: 12 }}>{tx('pos.confirm_without_a_code')}</button> : null}
          <button onClick={cancel} style={{ background: 'none', border: 0, padding: '9px 4px', fontSize: 12.5, cursor: 'pointer', color: MUTED }}>{tx('pos.cancel')}</button>
        </div>
        {manualOpen && isManager ? (
          <div style={{ marginTop: 12, padding: 10, border: '1px solid #ECDCAE', borderRadius: 8, background: '#FFFBF2' }} data-testid="manual-confirm">
            <div style={{ fontSize: 12.5, color: TEXT, marginBottom: 6 }}>
              {tx('pos.the_number_will_be_marked')}{' '}<strong>{tx('pos.manually_confirmed_otp_not_completed')}</strong>{tx('pos.it_is_usable_for_calls_and_o3zi')}
            </div>
            <input value={managerReason} onChange={(e) => setManagerReason(e.target.value)} placeholder={tx('pos.why_can_the_customer_not_receive_1unn')} style={input} aria-label={tx('pos.manual_confirmation_reason')} />
            <button onClick={() => void manualConfirm()} disabled={busy || managerReason.trim().length < 12 || !full} style={primary(busy || managerReason.trim().length < 12 || !full)}>{tx('pos.confirm_without_a_code_2')}</button>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}
