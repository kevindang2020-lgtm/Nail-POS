// POSReceptionCopilotScreen.tsx — the staff-facing AI Reception Copilot chat. Wired to the REAL, pre-existing
// assistant backend via POST /tenant/ai/center/copilot (package 'ai_reception_copilot'), which is tenant-isolated,
// package-gated, and billed through the existing AI subscription layer. Honest states: an access-denied decision
// shows the reason + a link to plans; a degraded reply (no real AI provider configured) is clearly marked as a
// sample rather than passed off as real. Champagne Gold via existing tokens.
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type CopilotHoldResult, type CopilotReply, type CopilotContextResult, type CopilotSafeCustomer, type CopilotQueueSummary, type CopilotDuplicatesResult, type CopilotAvailability, type CopilotConflict, type CopilotTechnicians, type CopilotSettings, type IntentResult } from '../api/posAiApi';
import { posServicesApi } from '../api/posServicesApi';
import { useRealtime } from '../realtime/useRealtime';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { useCopilotAction, PreparedCard, ActionOutcome, CopilotOpsBar, PriorityAssistant, CopilotWorkspace } from './receptionCopilotCenter';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const GOLD = '#A96F22';
const inputStyle: React.CSSProperties = { flex: 1, height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: '#fff', fontSize: 14, fontFamily: 'inherit' };
const btnGold: React.CSSProperties = { height: 40, padding: '0 18px', borderRadius: 10, border: 'none', background: GOLD, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

interface Msg { role: 'you' | 'copilot'; text: string; degraded?: boolean }

// AI Phone Receptionist activity — what the phone AI already did (spec §1). Also the "take over" surface: calls the AI
// handed off are flagged. Initiating a live transfer is telephony-provider-gated, so this shows status rather than
// faking a transfer.
function AiPhoneActivityPanel() {
  const [state, setState] = useState<{ loading: boolean; calls: any[]; available: boolean }>({ loading: true, calls: [], available: false });
  useEffect(() => {
    let on = true;
    posAiApi.receptionCopilotAiPhoneActivity().then((r) => { if (on) setState({ loading: false, calls: r.calls || [], available: r.available }); }).catch(() => { if (on) setState({ loading: false, calls: [], available: false }); });
    return () => { on = false; };
  }, []);
  if (state.loading) return <section style={cardBox} role="region" aria-label={tx('pos.ai_phone_receptionist_recent_activity')}><div role="status" aria-live="polite" style={{ fontSize: 12.5, color: '#9B8B78' }}>{tx('pos.loading_recent_ai_phone_calls')}</div></section>;
  return (
    <section style={cardBox} role="region" aria-label={tx('pos.ai_phone_receptionist_recent_activity')}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8, margin: '0 0 8px' }}>{tx('pos.ai_phone_receptionist_recent_activity_2')}</h3>
      <div aria-live="polite">
      {!state.available ? <div style={{ fontSize: 12.5, color: '#9B8B78' }} data-testid="rc-phone-unavailable">{tx('pos.copilot_phone_unavailable')}</div>
        : state.calls.length === 0 && <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{tx('pos.no_recent_ai_phone_calls')}</div>}
      {state.calls.map((c) => (
        <div key={c.callId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: '#3A342E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary || (c.intents || []).join(', ') || tx('pos.call_handled')}</div>
            <div style={{ fontSize: 11, color: '#9B8B78' }}>{c.startedAt ? fmtInZone(c.startedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}{c.bookingOutcome ? ` · ${c.bookingOutcome}` : ''}</div>
          </div>
          {c.handedOffToHuman && <span aria-label={tx('pos.handed_off_to_a_human')} title={tx('pos.this_call_was_handed_off_to_5zxg')} style={{ fontSize: 11, fontWeight: 700, color: '#9B3B3B', background: '#F7E4E4', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{tx('pos.handed_off')}</span>}
          {c.followUpRequired && <span aria-label={tx('pos.follow_up_required')} style={{ fontSize: 11, fontWeight: 700, color: '#8A6A22', background: '#F3ECDD', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{tx('pos.follow_up')}</span>}
        </div>
      ))}
      </div>
    </section>
  );
}

// Service + policy explainer (spec §1). Loads the real services list and shows details + approved policies on select.
function ServiceExplainerPanel() {
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [sel, setSel] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    posServicesApi.list().then((r: any) => {
      const rows = Array.isArray(r) ? r : (r?.services || r?.items || []);
      setServices(rows.map((s: any) => ({ id: s.serviceId || s.id, name: s.name })).filter((s: any) => s.id && s.name));
    }).catch(() => setServices([]));
  }, []);
  const explain = (id: string) => { setSel(id); setInfo(null); if (!id) return; setBusy(true); posAiApi.receptionCopilotExplainService(id).then(setInfo).catch(() => setInfo({ found: false })).finally(() => setBusy(false)); };
  return (
    <section style={cardBox} role="region" aria-label={tx('pos.explain_a_service')}>
      <h3 id="rc-explain-svc" style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8, margin: '0 0 8px' }}>{tx('pos.explain_a_service')}</h3>
      <select value={sel} onChange={(e) => explain(e.target.value)} aria-labelledby="rc-explain-svc" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px', fontSize: 13 }}>
        <option value="">{tx('pos.select_a_service')}</option>
        {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div aria-live="polite" aria-busy={busy}>
      {busy && <div role="status" style={{ fontSize: 12, color: '#9B8B78', marginTop: 8 }}>{tx('pos.loading')}</div>}
      {info?.found && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{info.service.name} <span style={{ color: '#9B8B78', fontWeight: 500 }}>· {info.service.category} · {info.service.durationMinutes} {tx('pos.min_2')}{(info.service.priceCents / 100).toFixed(2)}</span></div>
          {info.service.description && <div style={{ fontSize: 12.5, color: '#3A342E', marginTop: 4 }}>{info.service.description}</div>}
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{info.policies.map((p: string, i: number) => <li key={i} style={{ fontSize: 12, color: '#6B5D46', marginBottom: 3 }}>{p}</li>)}</ul>
        </div>
      )}
      {info && !info.found && sel && <div style={{ fontSize: 12, color: '#9B8B78', marginTop: 8 }}>{(info as { needsBranch?: boolean }).needsBranch ? tx('pos.copilot_choose_branch_for_service') : tx('pos.no_details_available_for_that_service')}</div>}
      </div>
    </section>
  );
}

// Waitlist / standby advisory (spec §1). Reads the live queue; placement still goes through the Queue domain service.
function WaitlistPanel() {
  const [w, setW] = useState<{ waiting: number; estimatedWaitMinutes: number | null; message: string } | null>(null);
  useEffect(() => { posAiApi.receptionCopilotWaitlist().then(setW).catch(() => setW(null)); }, []);
  if (!w) return null;
  return (
    <section style={{ ...cardBox, borderColor: '#D9C89F', background: '#FBF6EA' }} role="region" aria-label={tx('pos.waitlist_and_standby')}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 4, margin: '0 0 4px' }}>{tx('pos.waitlist_standby_2')}</h3>
      <div style={{ fontSize: 12.5, color: '#6B5D46' }}>{w.message}</div>
    </section>
  );
}

// Safe recommended next actions (spec §1), driven by the detected caller intent.
function NextActionsPanel({ intent }: { intent: IntentResult | null }) {
  const [actions, setActions] = useState<{ action: string; label: string; reason: string }[]>([]);
  const intentName = intent ? intent.intent : null;
  useEffect(() => {
    if (intentName === null) { setActions([]); return; }
    posAiApi.receptionCopilotNextActions({ intent: intentName }).then(setActions).catch(() => setActions([]));
  }, [intentName]);
  if (!actions.length) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }} role="list" aria-label={tx('pos.recommended_next_actions')}>
      {actions.map((a) => (
        <span key={a.action} role="listitem" title={a.reason} aria-label={`${a.label}. ${a.reason}`} style={{ fontSize: 11.5, fontWeight: 600, color: GOLD, background: '#F7EFE1', border: '1px solid #E7D3AE', borderRadius: 999, padding: '3px 10px' }}>{a.label}</span>
      ))}
    </div>
  );
}

function CustomerCard({ c, primary }: { c: CopilotSafeCustomer; primary?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 6, background: primary ? '#FBF4E8' : '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#3A342E' }}>{c.fullName}</div>
        <div style={{ fontSize: 11.5, color: '#9B8B78' }}>{c.maskedPhone}</div>
      </div>
      <div style={{ fontSize: 11.5, color: '#8A7A66', marginTop: 3 }}>
        {c.returning ? tx('pos.returning_visitscount_visit_plural', { visitsCount: String(c.visitsCount), plural: String(c.visitsCount === 1 ? '' : 's') }) : tx('pos.new_customer_3')}
        {c.lastVisitDate ? tx('pos.last_visit_lastvisitdate', { lastVisitDate: String(c.lastVisitDate) }) : ''}
        {c.loyaltyTier ? ` · ${c.loyaltyTier}` : ''}
      </div>
      {c.favoriteTechnicianName && <div style={{ fontSize: 11.5, color: '#8A7A66', marginTop: 2 }}>{tx('pos.usually_sees')}{' '}{c.favoriteTechnicianName}{c.favoriteServiceName ? tx('pos.for_favoriteservicename', { favoriteServiceName: String(c.favoriteServiceName) }) : ''}</div>}
      {c.upcomingAppointment && <div style={{ fontSize: 11.5, color: GOLD, marginTop: 2 }}>{tx('pos.upcoming')}{' '}{c.upcomingAppointment.serviceName} {tx('pos.with')}{' '}{c.upcomingAppointment.technicianName}</div>}
    </div>
  );
}

const SUGGESTIONS = (): string[] => [tx('growth.copilot.suggest.summarizeQueue'), tx('growth.copilot.suggest.nextAppointment'), tx('growth.copilot.suggest.draftReschedule'), tx('growth.copilot.suggest.prioritize')];

export function POSReceptionCopilotScreen() {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [intent, setIntent] = useState<IntentResult | null>(null);
  useEffect(() => {
    const t = input.trim();
    if (t.length < 4) { setIntent(null); return; }
    const h = setTimeout(() => { posAiApi.receptionCopilotIntent(t).then(setIntent).catch(() => setIntent(null)); }, 400);
    return () => clearTimeout(h);
  }, [input]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<{ label?: string; reason?: string } | null>(null);
  const [lookupPhone, setLookupPhone] = useState('');
  const [ctxResult, setCtxResult] = useState<CopilotContextResult | null>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  const [queue, setQueue] = useState<CopilotQueueSummary | null>(null);
  const [dupes, setDupes] = useState<CopilotDuplicatesResult | null>(null);
  const [settings, setSettings] = useState<CopilotSettings | null>(null);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [settingsScope, setSettingsScope] = useState<'tenant' | 'branch'>('tenant');
  useEffect(() => { posAiApi.receptionCopilotGetSettings().then(setSettings).catch(() => setSettings(null)); }, []);
  const toggleSetting = async (key: keyof CopilotSettings) => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next); setSettingsNote(null);
    try { setSettings(await posAiApi.receptionCopilotPatchSettings({ [key]: next[key], level: settingsScope })); }
    catch { setSettings(settings); setSettingsNote(tx('growth.copilot.noPermission')); }
  };
  const actionOff = (key: keyof CopilotSettings) => !!settings && (!settings.enabled || !settings.actionsEnabled || !settings[key]);
  const [availDate, setAvailDate] = useState('');
  const [avail, setAvail] = useState<CopilotAvailability | null>(null);
  const [techs, setTechs] = useState<CopilotTechnicians | null>(null);
  const [availBusy, setAvailBusy] = useState(false);
  const [cf, setCf] = useState({ technicianId: '', startTime: '', endTime: '', date: '' });
  const [cfResult, setCfResult] = useState<CopilotConflict | null>(null);
  const [cfBusy, setCfBusy] = useState(false);
  const checkConflict = async () => {
    if (cfBusy || !cf.technicianId.trim() || !cf.startTime.trim() || !cf.endTime.trim()) return;
    setCfBusy(true); setCfResult(null);
    try { setCfResult(await posAiApi.receptionCopilotConflict(cf.technicianId.trim(), cf.startTime.trim(), cf.endTime.trim(), cf.date.trim())); }
    catch { setCfResult({ hasConflict: false, status: 'error', conflictingAppointmentId: null, unavailable: true }); }
    finally { setCfBusy(false); }
  };
  // Round 2 H: "Hold this time" — reserve a recommended slot while the caller decides (server: copilot/hold, the booking
  // desk's pos.booking.create). One hold per desk session: holding another slot moves it. Countdown to the server's expiry.
  const [holdServices, setHoldServices] = useState('');
  const [hold, setHold] = useState<{ token: string; expiresAt: number; date: string; startTime: string; technicianId: string; technicianName: string } | null>(null);
  const [holdNote, setHoldNote] = useState<string | null>(null);
  const [holdBusy, setHoldBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const holdRef = useRef<string | null>(null);
  holdRef.current = hold?.token ?? null;
  useEffect(() => {
    if (!hold) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hold]);
  useEffect(() => () => { if (holdRef.current) posAiApi.receptionCopilotReleaseHold(holdRef.current).catch(() => undefined); }, []);   // leaving the screen gives the time back
  const holdLeftMs = hold ? hold.expiresAt - nowMs : 0;
  useEffect(() => {
    if (hold && holdLeftMs <= 0) { setHold(null); setBkHoldToken(null); setHoldNote(tx('growth.copilot.holdExpired')); }
  }, [hold, holdLeftMs]);
  const holdServiceIds = () => holdServices.split(',').map((s) => s.trim()).filter(Boolean);
  const holdSlot = async (s: { time: string; technicianId: string; technicianName: string }) => {
    const date = avail?.date || availDate.trim();
    if (holdBusy || !date || !holdServiceIds().length) return;
    setHoldBusy(true); setHoldNote(null);
    try {
      const r: CopilotHoldResult = await posAiApi.receptionCopilotHold({ date, startTime: s.time, serviceIds: holdServiceIds(), technicianId: s.technicianId, holdToken: hold?.token });
      if (r.held && r.holdToken && r.expiresAt) {
        setNowMs(Date.now());
        setHold({ token: r.holdToken, expiresAt: Date.parse(r.expiresAt), date, startTime: s.time, technicianId: s.technicianId, technicianName: s.technicianName });
      } else {
        setHoldNote(r.reason === 'taken' ? tx('pos.that_time_was_just_taken_pick_rryd') : r.reason === 'invalid' ? tx('pos.check_the_service_ids_that_time_138p') : tx('pos.holding_times_isn_t_available_here'));
      }
    } catch (e: any) {
      setHoldNote(e?.status === 403 ? tx('pos.you_don_t_have_permission_to_1750') : (e?.message || tx('pos.could_not_hold_that_time')));
    } finally { setHoldBusy(false); }
  };
  const releaseHold = async () => {
    if (!hold) return;
    const token = hold.token;
    setHold(null); setBkHoldToken(null);
    await posAiApi.receptionCopilotReleaseHold(token).catch(() => undefined);
    setHoldNote(tx('growth.copilot.holdReleased'));
  };
  const bookHeld = () => {
    if (!hold) return;
    setBk((b) => ({ ...b, serviceIds: holdServiceIds().join(', '), date: hold.date, startTime: hold.startTime, technicianId: hold.technicianId }));
    setBkHoldToken(hold.token); bkA.reset();
    setHoldNote(tx('growth.copilot.enterName'));
  };
  const findAvailability = async () => {
    if (availBusy) return;
    setAvailBusy(true); setAvail(null); setTechs(null);
    try {
      const [a, t] = await Promise.all([
        posAiApi.receptionCopilotAvailability(availDate.trim(), holdServiceIds()),
        posAiApi.receptionCopilotTechnicians(availDate.trim()).catch(() => null),
      ]);
      setAvail(a); setTechs(t);
    } catch { setAvail({ available: false, date: null, recommendations: [], byTechnician: [] }); }
    finally { setAvailBusy(false); }
  };
  // Reception Copilot guide §06: every customer-affecting action is PREPARED on the server (no side effect: current vs
  // proposed, warnings, a sealed 5-minute confirmation token and a fresh request key), then CONFIRMED exactly as reviewed
  // and VERIFIED from the persisted record. A double tap replays the same request key — it never runs twice.
  const [cxApptId, setCxApptId] = useState('');
  const [cxReason, setCxReason] = useState('');
  const cx = useCopilotAction(); const cxActing = !!cx.busy;
  const [rs, setRs] = useState({ appointmentId: '', startTime: '', date: '' });
  const rsA = useCopilotAction(); const rsActing = !!rsA.busy;
  const [bk, setBk] = useState({ customerName: '', serviceIds: '', date: '', startTime: '', technicianId: '' });
  const bkA = useCopilotAction(); const bkActing = !!bkA.busy;
  const [bkHoldToken, setBkHoldToken] = useState<string | null>(null);   // Round 2 H: booking FROM a hold converts it
  const [mg, setMg] = useState({ to: '', body: '' });
  const [draftRefined, setDraftRefined] = useState(false);
  const mgA = useCopilotAction(); const mgActing = !!mgA.busy;
  const draftInto = async (kind: string) => {
    try {
      const d = await posAiApi.receptionCopilotDraftMessage(kind, mg.to.trim() || undefined);
      setMg((m) => ({ ...m, body: d.body }));
      setDraftRefined(!!d.refined);
    } catch { /* drafting is best-effort; leave the body as-is */ }
  };
  const prepareMsg = () => { if (!mg.to.trim() || !mg.body.trim()) return; void mgA.prepare({ type: 'send_message', to: mg.to.trim(), body: mg.body.trim() }); };
  useEffect(() => { if (mgA.result?.ok) setMg({ to: '', body: '' }); }, [mgA.result]);
  const prepareBook = () => {
    if (!bk.customerName.trim() || !bk.serviceIds.trim() || !bk.date.trim() || !bk.startTime.trim()) return;
    // the hold travels with the booking only while it is live and still for the time being reviewed
    const fromHold = bkHoldToken && hold && hold.token === bkHoldToken && hold.date === bk.date.trim() && hold.startTime === bk.startTime.trim() ? bkHoldToken : null;
    void bkA.prepare({ type: 'create_appointment', customerName: bk.customerName.trim(), serviceIds: bk.serviceIds.split(',').map((x) => x.trim()).filter(Boolean),
      date: bk.date.trim(), startTime: bk.startTime.trim(), ...(bk.technicianId.trim() ? { technicianId: bk.technicianId.trim() } : {}), ...(fromHold ? { holdToken: fromHold } : {}) });
  };
  useEffect(() => {
    if (!bkA.result?.ok) return;
    setBk({ customerName: '', serviceIds: '', date: '', startTime: '', technicianId: '' });
    if (bkHoldToken) { setBkHoldToken(null); setHold(null); setHoldNote(null); }   // converted by the server — nothing to release
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bkA.result]);
  const prepareResched = () => { if (!rs.appointmentId.trim() || !rs.startTime.trim()) return; void rsA.prepare({ type: 'reschedule_appointment', appointmentId: rs.appointmentId.trim(), startTime: rs.startTime.trim(), ...(rs.date.trim() ? { date: rs.date.trim() } : {}) }); };
  useEffect(() => { if (rsA.result?.ok) setRs({ appointmentId: '', startTime: '', date: '' }); }, [rsA.result]);
  const endRef = useRef<HTMLDivElement>(null);

  const prepareCancel = () => { if (!cxApptId.trim() || !cxReason.trim()) return; void cx.prepare({ type: 'cancel_appointment', appointmentId: cxApptId.trim(), reason: cxReason.trim() }); };
  useEffect(() => { if (cx.result?.ok) { setCxApptId(''); setCxReason(''); } }, [cx.result]);

  useEffect(() => { posAiApi.receptionCopilotQueue().then(setQueue).catch(() => setQueue(null)); }, []);
  useEffect(() => { posAiApi.receptionCopilotDuplicates().then(setDupes).catch(() => setDupes(null)); }, []);

  const lookedUp = useRef<string | null>(null);   // the number whose card is on screen (see the §62 refresh below)
  const lookup = async () => {
    const p = lookupPhone.trim();
    if (!p || ctxBusy) return;
    setCtxBusy(true); setCtxResult(null); lookedUp.current = p;
    try { setCtxResult(await posAiApi.receptionCopilotContext(p)); }
    catch { setCtxResult({ matchState: 'none', candidates: [], customer: null }); }
    finally { setCtxBusy(false); }
  };

  // Smooth Refresh spec §62: the caller card on screen is refreshed IN PLACE when a customer is created or edited on
  // another device (customer events route to 'customers'). Silent: no busy state, the card is never cleared, and the
  // number that was looked up is re-used even if the receptionist has started typing a new one.
  useRealtime('customers', () => {
    const p = lookedUp.current; if (!p) return;
    posAiApi.receptionCopilotContext(p).then((r) => { if (lookedUp.current === p) setCtxResult(r); }).catch(() => { /* keep the card */ });
  }, { intervalMs: 0 });
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: 'you', text: q }]);
    setInput(''); setBusy(true); setDenied(null);
    try {
      const r: CopilotReply = await posAiApi.receptionCopilot(q);
      if (!r.ok) { setDenied(r.decision ?? { label: tx('pos.unavailable') }); }
      else { setMsgs((m) => [...m, { role: 'copilot', text: r.text || tx('pos.no_response'), degraded: r.degraded }]); }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'copilot', text: e?.message || tx('pos.something_went_wrong_reaching_the_copilot') }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div className="vh"><div><h1>{tx('pos.reception_copilot')}</h1><div className="sub">{tx('pos.ask_your_front_desk_assistant_about_bwcw')}</div></div></div>

      <CopilotOpsBar />
      <PriorityAssistant nav={nav} />

      {queue && queue.available && (
        <div style={{ ...cardBox, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#3A342E' }}>{tx('pos.queue_now')}</span>
          <span style={{ fontSize: 13, color: '#515050' }}>{queue.waiting} {tx('pos.waiting')}</span>
          <span style={{ fontSize: 13, color: '#515050' }}>{queue.inService} {tx('pos.in_service_2')}</span>
          {queue.unassigned > 0 && <span style={{ fontSize: 13, color: '#9B6B1E' }}>{queue.unassigned} {tx('pos.unassigned_2')}</span>}
          {queue.vipWaiting > 0 && <span style={{ fontSize: 13, color: GOLD }}>{queue.vipWaiting} VIP</span>}
          {queue.longestWaitMinutes != null && <span style={{ fontSize: 13, color: '#515050' }}>{tx('pos.longest_wait')}{queue.longestWaitMinutes}{tx('pos.m_est')}</span>}
        </div>
      )}

      {denied && (
        <div style={{ ...cardBox, borderColor: '#E7C9A0', background: '#FBEEDD' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#9B6B1E' }}>{denied.label || tx('pos.reception_copilot_isn_t_active')}</div>
          <div style={{ fontSize: 12.5, color: '#8A7A66', marginTop: 4 }}>
            {denied.reason === 'unpaid' ? tx('pos.this_assistant_needs_an_active_subscription') : denied.reason === 'limit_exceeded' ? tx('pos.you_ve_used_all_included_messages_t236') : denied.reason === 'permission_denied' ? tx('pos.your_role_doesn_t_have_access_1738') : tx('pos.this_assistant_isn_t_available_right_13if')}
            {' '}<button style={linkBtn} onClick={() => nav('/tenant/ai/plans')}>{tx('pos.view_plans')}</button>
          </div>
        </div>
      )}

      <style>{`
        [role="region"] :focus-visible, .rc-a11y-scope button:focus-visible, .rc-a11y-scope select:focus-visible, .rc-a11y-scope input:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .rc-a11y-scope *, [role="region"] * { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
      `}</style>
      <AiPhoneActivityPanel />
      <ServiceExplainerPanel />
      <WaitlistPanel />

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.caller_lookup')}</div>
        <div className='flex flex-col sm:flex-row gap-3 w-full shrink-0'>
          <input className='!flex-auto' type="tel" inputMode="tel" style={inputStyle} value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} placeholder={tx('pos.caller_phone_number_u2026')} disabled={ctxBusy} />
          <button className='whitespace-nowrap' style={{ ...btnGold, opacity: ctxBusy || !lookupPhone.trim() ? 0.6 : 1 }} disabled={ctxBusy || !lookupPhone.trim()} onClick={lookup}>{tx('pos.look_up')}</button>
        </div>
        {ctxBusy && <div style={{ fontSize: 12.5, color: '#9B8B78', marginTop: 8 }}>{tx('pos.searching_your_customers_u2026')}</div>}
        {ctxResult && !ctxBusy && (
          <div style={{ marginTop: 10 }}>
            {ctxResult.denied ? (
              <div style={{ fontSize: 12.5, color: '#B4673B' }}>{tx('pos.you_don_u2019t_have_permission_to_8on4')}</div>
            ) : ctxResult.matchState === 'none' ? (
              <div style={{ fontSize: 12.5, color: '#8A7A66' }}>{tx('pos.unknown_caller_u2014_no_customer_in_yts9')}</div>
            ) : ctxResult.matchState === 'multiple' ? (
              <div>
                <div style={{ fontSize: 12, color: '#9B6B1E', marginBottom: 6 }}>{tx('pos.multiple_possible_matches_u2014_confirm_which_1495')}</div>
                {ctxResult.candidates.map((c) => <CustomerCard key={c.customerId} c={c} />)}
              </div>
            ) : ctxResult.customer ? (
              <CustomerCard c={ctxResult.customer} primary />
            ) : null}
          </div>
        )}
      </section>

      {dupes && dupes.groups.length > 0 && (
        <section style={cardBox}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 6 }}>{tx('pos.possible_duplicate_customers')}</div>
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 8 }}>{tx('pos.review_only_the_copilot_never_merges_1x8o')}</div>
          {dupes.groups.slice(0, 5).map((g) => (
            <div key={g.groupId} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 11.5, color: '#9B6B1E', marginBottom: 4 }}>{tx('pos.possible_match')}{' '}{g.reason}</div>
              {g.members.map((m) => (
                <div key={m.customerId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#515050', padding: '2px 0' }}>
                  <span>{m.fullName}</span>
                  <span style={{ color: '#9B8B78' }}>{m.maskedPhone}{m.visitCount != null ? tx('pos.visitcount_visit_plural', { visitCount: String(m.visitCount), plural: String(m.visitCount === 1 ? '' : 's') }) : ''}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.find_open_times')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={inputStyle} type="date" aria-label={tx('pos.date_to_check')} value={availDate} onChange={(e) => setAvailDate(e.target.value)} disabled={availBusy} />
          <input style={inputStyle} value={holdServices} onChange={(e) => setHoldServices(e.target.value)} placeholder={tx('pos.service_ids_to_hold_comma_sep_6tz5')} disabled={availBusy} />
          <button style={{ ...btnGold, opacity: availBusy ? 0.6 : 1 }} disabled={availBusy} onClick={findAvailability}>{tx('pos.check')}</button>
        </div>
        {hold && holdLeftMs > 0 && (
          <div style={{ border: '1px solid #E7C9A0', background: '#FBF4E8', borderRadius: 10, padding: 10, marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: '#515050', flex: 1 }}>
              <b>{tx('pos.held')}{' '}{hold.startTime} {tx('pos.with')}{' '}{hold.technicianName}</b> · {hold.date} {tx('pos.nobody_else_is_offered_it_for')}{' '}
              <span role="timer" aria-live="off" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#9B6B1E' }}>{Math.floor(holdLeftMs / 60000)}:{String(Math.floor((holdLeftMs % 60000) / 1000)).padStart(2, '0')}</span>
            </div>
            <button style={{ ...btnGold, height: 32, padding: '0 12px', fontSize: 12.5 }} onClick={bookHeld}>{tx('pos.book_this_time')}</button>
            <button style={{ ...inputStyle, flex: 'none', width: 'auto', height: 32, padding: '0 12px', cursor: 'pointer', fontSize: 12.5 }} aria-label={tx('pos.release_hold')} onClick={releaseHold}>{tx('pos.release')}</button>
          </div>
        )}
        {holdNote && <div role="status" style={{ fontSize: 12.5, color: '#8A7A66', marginTop: 8 }}>{holdNote}</div>}
        {availBusy && <div style={{ fontSize: 12.5, color: '#9B8B78', marginTop: 8 }}>{tx('pos.checking_the_schedule_u2026')}</div>}
        {avail && !availBusy && (
          <div style={{ marginTop: 10 }}>
            {avail.denied ? (
              <div style={{ fontSize: 12.5, color: '#B4673B' }}>{tx('pos.you_don_u2019t_have_permission_to_1ebr')}</div>
            ) : !avail.available ? (
              <div style={{ fontSize: 12.5, color: '#8A7A66' }}>{tx('pos.no_open_times')}{avail.date ? tx('pos.on_date', { date: String(avail.date) }) : ''}{tx('pos.suggest_another_day_or_the_waitlist')}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#8A7A66', marginBottom: 6 }}>{tx('pos.earliest_openings')}{avail.date ? tx('pos.on_date', { date: String(avail.date) }) : ''}:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {avail.recommendations.map((s, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--line)', background: '#FBF4E8', fontSize: 12.5, color: '#515050' }}>
                      {s.time} · {s.technicianName}
                      {holdServiceIds().length > 0 && !actionOff('allowCreate') && (
                        <button style={linkBtn} disabled={holdBusy || (hold?.startTime === s.time && hold?.technicianId === s.technicianId)} aria-label={tx('pos.hold_time_with_technicianname', { time: String(s.time), technicianName: String(s.technicianName) })} onClick={() => holdSlot(s)}>
                          {hold?.startTime === s.time && hold?.technicianId === s.technicianId ? tx('pos.held_3') : tx('pos.hold_this_time')}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {techs && techs.available && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: '#8A7A66', marginBottom: 4 }}>{tx('pos.recommended_technicians')}</div>
                    {techs.technicians.map((t) => (
                      <div key={t.technicianId} style={{ fontSize: 12.5, color: '#515050', padding: '2px 0' }}>
                        {t.name}{t.isUsual ? ' (usual)' : ''} {tx('pos.first_at')}{' '}{t.firstAvailable ?? '—'}, {t.openSlots} {tx('pos.opening')}{enPlural(t.openSlots === 1 ? '' : 's')}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.check_for_conflicts')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, minWidth: 120 }} value={cf.technicianId} onChange={(e) => setCf({ ...cf, technicianId: e.target.value })} placeholder={tx('pos.technician_id')} disabled={cfBusy} />
          <input style={{ ...inputStyle, width: 90, minWidth: 90 }} value={cf.startTime} onChange={(e) => setCf({ ...cf, startTime: e.target.value })} placeholder="14:00" disabled={cfBusy} />
          <input style={{ ...inputStyle, width: 90, minWidth: 90 }} value={cf.endTime} onChange={(e) => setCf({ ...cf, endTime: e.target.value })} placeholder="14:45" disabled={cfBusy} />
          <input style={{ ...inputStyle, width: 140, minWidth: 140 }} type="date" value={cf.date} onChange={(e) => setCf({ ...cf, date: e.target.value })} disabled={cfBusy} />
          <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer' }} disabled={cfBusy || !cf.technicianId.trim() || !cf.startTime.trim() || !cf.endTime.trim()} onClick={checkConflict}>{tx('pos.check')}</button>
        </div>
        {cfResult && !cfBusy && (
          <div style={{ fontSize: 12.5, marginTop: 8, color: cfResult.denied ? '#B4673B' : cfResult.unavailable ? '#8A7A66' : cfResult.hasConflict ? '#B4673B' : '#2E7D5B' }}>
            {cfResult.denied ? tx('pos.you_don_t_have_permission_to_1trb')
              : cfResult.status === 'error' ? tx('pos.copilot_conflict_check_failed')   /* a network / server failure is not a form mistake (Nov 3 audit) */
              : cfResult.unavailable ? tx('pos.enter_a_technician_start_and_end_rljj')
              : cfResult.hasConflict ? tx('pos.conflict_that_technician_is_already_booked_443t', { v0: String(cfResult.conflictingAppointmentId ? tx('pos.appointment_conflictingappointmentid', { conflictingAppointmentId: String(cfResult.conflictingAppointmentId) }) : '') })
              : tx('pos.no_conflict_that_time_is_clear_rw0j')}
          </div>
        )}
      </section>

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.cancel_an_appointment')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, minWidth: 160 }} value={cxApptId} onChange={(e) => setCxApptId(e.target.value)} placeholder={tx('pos.appointment_id')} disabled={cxActing} />
          <input style={{ ...inputStyle, minWidth: 160 }} value={cxReason} onChange={(e) => setCxReason(e.target.value)} placeholder={tx('pos.reason_2')} disabled={cxActing} />
          <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer', flex: '0 0 auto', opacity: !cxApptId.trim() || !cxReason.trim() ? 0.6 : 1 }} disabled={!cxApptId.trim() || !cxReason.trim() || actionOff('allowCancel')} onClick={prepareCancel}>{tx('pos.prepare')}</button>
        </div>
        <PreparedCard h={cx} confirmLabel={tx('pos.confirm_cancel')} testId="rcc-cancel" />
        <ActionOutcome h={cx} testId="rcc-cancel-outcome" />
      </section>

      {settings && (
        <section style={cardBox}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.copilot_settings')}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['tenant', 'branch'] as const).map((sc) => (
              <button key={sc} onClick={() => setSettingsScope(sc)} style={{ padding: '3px 10px', borderRadius: 999, border: `1px solid ${settingsScope === sc ? '#A96F22' : 'var(--line)'}`, background: settingsScope === sc ? '#FBF4E8' : '#FFF', fontSize: 11.5, color: settingsScope === sc ? '#9B6B1E' : '#8A7A66', cursor: 'pointer' }}>{sc === 'tenant' ? tx('pos.all_branches_2') : tx('pos.this_branch_only')}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {([['enabled', tx('growth.copilot.setting.enabled')], ['actionsEnabled', tx('growth.copilot.setting.actionsEnabled')], ['allowCreate', tx('growth.copilot.setting.allowCreate')], ['allowReschedule', tx('growth.copilot.setting.allowReschedule')], ['allowCancel', tx('growth.copilot.setting.allowCancel')], ['allowSendMessage', tx('growth.copilot.setting.allowSendMessage')], ['allowDrafting', tx('growth.copilot.setting.allowDrafting')], ['showCustomerHistory', tx('growth.copilot.setting.showCustomerHistory')], ['allowAiPhoneActivity', tx('growth.copilot.setting.allowAiPhoneActivity')], ['allowExplainServices', tx('growth.copilot.setting.allowExplainServices')], ['allowWaitlist', tx('growth.copilot.setting.allowWaitlist')]] as [keyof CopilotSettings, string][]).map(([k, label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#515050', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!settings[k]} onChange={() => toggleSetting(k)} /> {label}
              </label>
            ))}
          </div>
          {settingsNote && <div style={{ fontSize: 11.5, color: '#B4673B', marginTop: 6 }}>{settingsNote}</div>}
        </section>
      )}

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.send_a_text_message')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {([['reminder', tx('growth.copilot.message.reminder')], ['running_late', tx('growth.copilot.message.running_late')], ['ready_now', tx('growth.copilot.message.ready_now')], ['thank_you', tx('growth.copilot.message.thank_you')], ['reschedule_offer', tx('growth.copilot.message.reschedule_offer')]] as [string, string][]).map(([k, label]) => (
            <button key={k} style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: '#FFF', fontSize: 12, color: '#6E5B43', cursor: 'pointer' }} disabled={mgActing} onClick={() => draftInto(k)}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="tel" inputMode="tel" style={{ ...inputStyle, minWidth: 150 }} value={mg.to} onChange={(e) => setMg({ ...mg, to: e.target.value })} placeholder={tx('pos.customer_phone_1_u2026')} disabled={mgActing} />
          <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} value={mg.body} onChange={(e) => setMg({ ...mg, body: e.target.value })} placeholder={tx('pos.message')} disabled={mgActing} />
          {draftRefined && <span style={{ fontSize: 11, color: '#9B6B1E', alignSelf: 'center' }} title={tx('pos.polished_by_your_ai_assistant')}>{tx('pos.ai_polished')}</span>}
          <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer', opacity: !mg.to.trim() || !mg.body.trim() ? 0.6 : 1 }} disabled={!mg.to.trim() || !mg.body.trim() || actionOff('allowSendMessage')} onClick={prepareMsg}>{tx('pos.review_text')}</button>
        </div>
        <PreparedCard h={mgA} confirmLabel={tx('pos.confirm_send')} testId="rcc-msg" />
        <ActionOutcome h={mgA} testId="rcc-msg-outcome" />
      </section>

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.book_an_appointment')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, minWidth: 130 }} value={bk.customerName} onChange={(e) => setBk({ ...bk, customerName: e.target.value })} placeholder={tx('pos.customer_name_2')} disabled={bkActing} />
          <input style={{ ...inputStyle, minWidth: 130 }} value={bk.serviceIds} onChange={(e) => setBk({ ...bk, serviceIds: e.target.value })} placeholder={tx('pos.service_ids_comma_sep')} disabled={bkActing} />
          <input style={{ ...inputStyle, width: 140, minWidth: 140 }} type="date" value={bk.date} onChange={(e) => setBk({ ...bk, date: e.target.value })} disabled={bkActing} />
          <input style={{ ...inputStyle, width: 90, minWidth: 90 }} value={bk.startTime} onChange={(e) => setBk({ ...bk, startTime: e.target.value })} placeholder="10:00" disabled={bkActing} />
          <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer', opacity: !bk.customerName.trim() || !bk.serviceIds.trim() || !bk.date.trim() || !bk.startTime.trim() ? 0.6 : 1 }} disabled={!bk.customerName.trim() || !bk.serviceIds.trim() || !bk.date.trim() || !bk.startTime.trim() || actionOff('allowCreate')} onClick={prepareBook}>{tx('pos.review_booking')}</button>
        </div>
        <PreparedCard h={bkA} confirmLabel={tx('pos.confirm_booking_3')} testId="rcc-book" />
        <ActionOutcome h={bkA} testId="rcc-book-outcome" />
      </section>

      <section style={cardBox}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3A342E', marginBottom: 8 }}>{tx('pos.reschedule_an_appointment')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, minWidth: 150 }} value={rs.appointmentId} onChange={(e) => setRs({ ...rs, appointmentId: e.target.value })} placeholder={tx('pos.appt_id_to_move')} disabled={rsActing} />
          <input style={{ ...inputStyle, width: 90, minWidth: 90 }} value={rs.startTime} onChange={(e) => setRs({ ...rs, startTime: e.target.value })} placeholder="11:15" disabled={rsActing} />
          <input style={{ ...inputStyle, width: 140, minWidth: 140 }} type="date" value={rs.date} onChange={(e) => setRs({ ...rs, date: e.target.value })} disabled={rsActing} />
          <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer', opacity: !rs.appointmentId.trim() || !rs.startTime.trim() ? 0.6 : 1 }} disabled={!rs.appointmentId.trim() || !rs.startTime.trim() || actionOff('allowReschedule')} onClick={prepareResched}>{tx('pos.review')}</button>
        </div>
        <PreparedCard h={rsA} confirmLabel={tx('pos.confirm_reschedule')} testId="rcc-resched" />
        <ActionOutcome h={rsA} testId="rcc-resched-outcome" />
      </section>

      <CopilotWorkspace />

      <section style={{ ...cardBox,  display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1,  display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}>
              <div style={{ fontSize: 13, color: '#8A7A66', marginBottom: 12 }}>{tx('pos.try_one_of_these')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {SUGGESTIONS().map((s) => <button key={s} onClick={() => send(s)} style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid var(--line)', background: '#FFFCF6', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', color: '#515050' }}>{s}</button>)}
              </div>
            </div>
          ) : msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'you' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <div style={{ fontSize: 10.5, color: '#9B8B78', marginBottom: 2, textAlign: m.role === 'you' ? 'right' : 'left' }}>{m.role === 'you' ? tx('pos.you_2') : tx('pos.copilot')}</div>
              <div style={{ padding: '10px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', background: m.role === 'you' ? '#F0D4AB' : '#F5EFE5', color: '#3A342E' }}>{m.text}</div>
              {m.degraded && <div style={{ fontSize: 10.5, color: '#B4673B', marginTop: 3 }}>{tx('pos.u26a0_sample_response_u2014_no_ai_xp56')}</div>}
            </div>
          ))}
          {busy && <div style={{ alignSelf: 'flex-start', fontSize: 12.5, color: '#9B8B78', padding: '4px 2px' }}>{tx('pos.copilot_is_thinking_u2026')}</div>}
          <div ref={endRef} />
        </div>

        {intent && intent.intent !== 'general_question' && (
          <div style={{ fontSize: 11.5, color: '#9B6B1E', marginTop: 10 }}>
            {tx('pos.looks_like')}{' '}<b>{intent.label}</b>{intent.confidence === 'high' ? '' : ' (maybe)'} {tx('pos.use_the_matching_section_above')}
          </div>
        )}
        <NextActionsPanel intent={intent} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input style={inputStyle} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(input); }} placeholder={tx('pos.ask_the_copilot_u2026')} disabled={busy} />
          <button style={{ ...btnGold, opacity: busy || !input.trim() ? 0.6 : 1 }} disabled={busy || !input.trim()} onClick={() => send(input)}>{tx('pos.send')}</button>
        </div>
      <div className='mt-3' style={{ fontSize: 11, color: '#9B8B78' }}>{tx('pos.the_copilot_uses_your_salon_u2019s_1d6h')}</div>
      </section>

    </div>
  );
}
