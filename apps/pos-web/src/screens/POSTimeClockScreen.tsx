// POSTimeClockScreen.tsx — Team → Time Clock. Wired to /pos/time-clock (pos.technicians.view read,
// pos.technicians.manage write). Today's roster with each technician's clock state, hours worked, and
// clock-in / clock-out actions. Writes to the technician_shifts table.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { fmtInZone } from '../i18n/format';
import { posTimeClockApi, type BreakPolicyView } from '../api/posTimeClockApi';
import type { TimeClockTechnicianRow, TimeClockRosterPage } from '@aipowersalon/api-contracts/tenant';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { reportError } from './reportsCommon';
import { ProfileAvatarWithPreview, useInlineAsk } from '@aipowersalon/ui';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

type Punch = { id: string; technicianId: string; startTime: string | null; endTime: string | null; status: string };
// the server's row (api-contracts TimeClockTechnicianRow) + the roster avatar; `on_break` since the Oct 12 merge (breaks, 580)
type Row = Omit<TimeClockTechnicianRow, 'shifts'> & { avatarUrl?: string | null; shifts: Punch[] };
type State = { kpis: { technicianCount: number; clockedInCount: number; totalHoursToday: number }; technicians: Row[]; page?: TimeClockRosterPage };
/** 200-technician §2 (Oct 27 2026): the roster is paged on the server (on the clock first) — the state used to carry every
 *  technician of the salon; the KPIs still count everyone. */
export const TIME_CLOCK_PAGE_SIZE = 25;

const fmtTime = (iso?: string | null) => { if (!iso) return '—'; try { return fmtInZone(iso, { hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
// ISO → value for <input type="datetime-local"> (local YYYY-MM-DDTHH:mm).
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hrs = (h: number) => t('admin.ads.hours', { n: (h || 0).toFixed(2) });
// Fair Turn §35–40: how the salon's break policy classified a break (pay treatment comes from the policy, never the queue)
const breakClass = (c: string) => codeLabel('admin.timeClock.break', c);

/** The salon's break policy (paid rest / bona fide meal). Owner / payroll managers edit it; everyone with the time clock reads it. */
function BreakPolicyPanel() {
  const can = useCan();
  const [v, setV] = useState<BreakPolicyView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({ jurisdiction: '', rest: '', meal: '', interrupted: true, scope: 'salon' as 'salon' | 'branch', reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setV(await posTimeClockApi.breakPolicy()); setErr(null); } catch (e: any) { setErr(e?.message || t('pos.could_not_load_the_break_policy')); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <section className="panel" style={{ marginTop: 12 }}><div className="p-h">{t('pos.break_policy')}</div><div className="err">{err}</div></section>;
  if (!v) return <section className="panel" style={{ marginTop: 12 }}><div className="p-h">{t('pos.break_policy')}</div><div className="state">{t('pos.loading_break_policy')}</div></section>;
  const p = v.policy;
  const open = () => { setMsg(null); setDraft({ jurisdiction: p.jurisdiction, rest: String(p.restBreakPaidUpToMinutes), meal: String(p.mealBreakMinMinutes), interrupted: p.interruptedMealCompensable, scope: 'salon', reason: '' }); setEdit(true); };
  const save = async () => {
    const rest = Number(draft.rest), meal = Number(draft.meal);
    if (!Number.isInteger(rest) || rest < 0 || rest > 120) { setMsg(t('pos.paid_rest_minutes_must_be_a_b8my')); return; }
    if (!Number.isInteger(meal) || meal < 0 || meal > 240) { setMsg(t('pos.meal_minimum_must_be_a_whole_1vnb')); return; }
    setBusy(true); setMsg(null);
    try {
      setV(await posTimeClockApi.saveBreakPolicy({ scope: draft.scope, policy: { jurisdiction: draft.jurisdiction.trim().toUpperCase(), restBreakPaidUpToMinutes: rest, mealBreakMinMinutes: meal, interruptedMealCompensable: draft.interrupted }, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) }));
      setEdit(false); setMsg(t('pos.break_policy_saved_new_breaks_are_16k2'));
    } catch (e: any) { setMsg(e?.message || t('pos.could_not_save_the_break_policy')); } finally { setBusy(false); }
  };
  return (
    <section className="panel" style={{ marginTop: 12 }} aria-label={t('pos.break_policy')}>
      <div className="p-h" style={{ display: 'flex', alignItems: 'center' }}>{t('pos.break_policy')}{' '}<span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{t('pos.version_2')}{' '}{v.version || 'default'}</span>
        {can('payroll.manage') && !edit ? <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={open}>{t('pos.edit')}</button> : null}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        {p.jurisdiction} {t('pos.rest_breaks_paid_up_to')}{' '}<strong>{p.restBreakPaidUpToMinutes} {t('pos.min')}</strong> {t('pos.a_meal_of')}{' '}<strong>{p.mealBreakMinMinutes}{t('pos.min_3')}</strong> {t('pos.with_no_work_is_unpaid_an_4khg')}{' '}{p.interruptedMealCompensable ? <strong>{t('pos.paid_5')}</strong> : <strong>{t('pos.not_paid')}</strong>}.
        <div className="muted" style={{ fontSize: 12 }}>{t('pos.the_salon_sets_this_for_its_bmng')}</div>
      </div>
      {edit ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>{t('pos.jurisdiction')}{' '}<input value={draft.jurisdiction} onChange={(e) => setDraft({ ...draft, jurisdiction: e.target.value })} aria-label={t('pos.jurisdiction')} style={{ width: 110 }} /></label>
          <label style={{ fontSize: 12 }}>{t('pos.paid_rest_up_to_min')}{' '}<input value={draft.rest} onChange={(e) => setDraft({ ...draft, rest: e.target.value.replace(/\D/g, '') })} inputMode="numeric" aria-label={t('pos.paid_rest_minutes')} style={{ width: 60 }} /></label>
          <label style={{ fontSize: 12 }}>{t('pos.unpaid_meal_minimum_min')}{' '}<input value={draft.meal} onChange={(e) => setDraft({ ...draft, meal: e.target.value.replace(/\D/g, '') })} inputMode="numeric" aria-label={t('pos.meal_minimum_minutes')} style={{ width: 60 }} /></label>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={draft.interrupted} onChange={(e) => setDraft({ ...draft, interrupted: e.target.checked })} /> {t('pos.interrupted_meal_is_paid')}</label>
          <label style={{ fontSize: 12 }}>{t('pos.applies_to')}{' '}<select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as 'salon' | 'branch' })} aria-label={t('pos.policy_scope')}><option value="salon">{t('pos.whole_salon')}</option><option value="branch">{t('pos.this_location_only')}</option></select></label>
          <input placeholder={t('pos.reason_optional')} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} aria-label={t('pos.policy_change_reason')} style={{ minWidth: 160, flex: 1 }} />
          <button className="btn" disabled={busy} onClick={save}>{busy ? t('pos.saving_2') : t('pos.save_policy')}</button>
          <button className="btn ghost" type="button" onClick={() => setEdit(false)}>{t('pos.cancel')}</button>
        </div>
      ) : null}
      {msg ? <div className="muted" role="status" style={{ marginTop: 6, fontSize: 12.5 }}>{msg}</div> : null}
    </section>
  );
}
const badge = (state: Row['state']) => {
  const map = { clocked_in: { t: t('pos.clocked_in'), bg: '#E9F6EC', fg: '#2E9E54' }, on_break: { t: t('pos.on_break_2'), bg: '#FFF4E0', fg: '#B5821F' }, clocked_out: { t: t('pos.clocked_out'), bg: '#F0F0F0', fg: '#666' }, off: { t: t('pos.off'), bg: '#FBF3E6', fg: '#B5821F' } } as const;
  const m = map[state] ?? map.off;
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: m.bg, color: m.fg }}>{m.t}</span>;
};

export function POSTimeClockScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Kiosk clock-PIN editor: which technician is being edited, the draft PIN, save state, and the last-set result
  // (shown so the manager can hand the PIN to the technician).
  const [pinEditFor, setPinEditFor] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinResult, setPinResult] = useState<{ technicianId: string; pin: string } | null>(null);
  // Timecard correction: which technician's punches are expanded, which punch is being adjusted, and the draft values.
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<string | null>(null); // a technician_shifts id
  const [adjStart, setAdjStart] = useState('');
  const [adjEnd, setAdjEnd] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);
  // break correction (Fair Turn §39): which break is being corrected + its draft times / reason
  const [brkFor, setBrkFor] = useState<string | null>(null);
  const [brkStart, setBrkStart] = useState('');
  const [brkEnd, setBrkEnd] = useState('');
  const [brkReason, setBrkReason] = useState('');
  const { ask, askUi } = useInlineAsk();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setQ(search.trim()); setPage(1); }, 250); return () => clearTimeout(h); }, [search]);

  const genPin4 = () => {
    // Avoid the obvious weak PINs the server rejects; it still validates server-side regardless.
    let p = '';
    do { p = String(Math.floor(1000 + Math.random() * 9000)); } while (/^(\d)\1{3}$/.test(p) || ['1234', '4321', '2580', '1212'].includes(p));
    return p;
  };
  const openPinEditor = (technicianId: string) => { setNote(null); setPinResult(null); setPinEditFor(technicianId); setPinValue(genPin4()); };
  const savePin = async (technicianId: string) => {
    if (!/^\d{4}$/.test(pinValue)) { setNote(t('pos.a_clock_pin_must_be_exactly_1k07')); return; }
    setPinBusy(true); setNote(null);
    try {
      await posTimeClockApi.resetClockPin(technicianId, pinValue);
      setPinResult({ technicianId, pin: pinValue });
      setPinEditFor(null); setPinValue('');
    } catch (e: any) { setNote(e?.message || t('pos.could_not_set_the_clock_pin')); }
    finally { setPinBusy(false); }
  };

  // Stale-while-revalidate (Smooth Refresh §20–§22): only the FIRST load shows the loading state; a refresh after an
  // action keeps the roster on screen and a failed refresh keeps the last good data (a note instead of a blank page).
  const hasData = useRef(false);
  const load = useCallback(async () => {
    if (!hasData.current) { setLoading(true); setError(null); }
    try { setS(await posTimeClockApi.state({ page, pageSize: TIME_CLOCK_PAGE_SIZE, search: q || undefined }) as State); hasData.current = true; setError(null); }
    catch (e: any) { if (!hasData.current) setError(reportError(e, t('admin.timeClock.noun'))); else setNote(reportError(e, t('admin.timeClock.noun'))); }
    finally { setLoading(false); }
  }, [page, q]);
  useEffect(() => { load(); }, [load]);
  // Smooth Refresh: a punch on Go Check-In / another POS (time_clock_updated, technician_clock_updated) refetches this
  // roster in place; the shared 15 s safety sync covers a missed event. No spinner, last good data kept on failure.
  useRealtime(['technicians', 'time-clock'], load);

  const act = async (technicianId: string, dir: 'in' | 'out' | 'break' | 'lunch' | 'back') => {
    setBusy(technicianId); setNote(null);
    try {
      if (dir === 'in') await posTimeClockApi.clockIn(technicianId);
      else if (dir === 'out') await posTimeClockApi.clockOut(technicianId);
      else if (dir === 'back') await posTimeClockApi.breakEnd(technicianId);
      else await posTimeClockApi.breakStart(technicianId, dir);
      await load();
    } catch (e: any) { setNote(e?.message || t('pos.could_not_update_the_time_clock')); }
    finally { setBusy(null); }
  };

  // §36: the technician was called back to work during the break — recorded, never counted as a full meal
  const interrupt = (technicianId: string) => ask(t('admin.timeClock.askInterrupted'), async (why) => {
    setBusy(technicianId); setNote(null);
    try { await posTimeClockApi.breakInterrupt(technicianId, why); await load(); } catch (e: any) { setNote(e?.message || t('pos.could_not_record_the_interruption')); } finally { setBusy(null); }
  }, { confirmLabel: t('pos.record_interruption') });
  const saveBreakAdjust = async (breakId: string) => {
    if (!brkReason.trim()) { setNote(t('pos.a_correction_reason_is_required')); return; }
    const body: { startedAt?: string; endedAt?: string; reason: string } = { reason: brkReason.trim() };
    if (brkStart) body.startedAt = new Date(brkStart).toISOString();
    if (brkEnd) body.endedAt = new Date(brkEnd).toISOString();
    if (body.startedAt && body.endedAt && new Date(body.endedAt).getTime() <= new Date(body.startedAt).getTime()) { setNote(t('pos.the_break_must_end_after_it_1sq4')); return; }
    setAdjBusy(true); setNote(null);
    try { await posTimeClockApi.adjustBreak(breakId, body); setBrkFor(null); await load(); } catch (e: any) { setNote(e?.message || t('pos.could_not_correct_the_break')); } finally { setAdjBusy(false); }
  };
  const toggleShifts = (technicianId: string) => { setExpandedTech((cur) => (cur === technicianId ? null : technicianId)); setAdjustFor(null); setNote(null); };
  const openAdjust = (p: Punch) => { setNote(null); setAdjustFor(p.id); setAdjStart(toLocalInput(p.startTime)); setAdjEnd(toLocalInput(p.endTime)); setAdjReason(''); };
  const saveAdjust = async (shiftId: string) => {
    if (!adjReason.trim()) { setNote(t('pos.a_correction_reason_is_required')); return; }
    const body: { startTime?: string; endTime?: string; reason: string } = { reason: adjReason.trim() };
    if (adjStart) body.startTime = new Date(adjStart).toISOString();
    if (adjEnd) body.endTime = new Date(adjEnd).toISOString();
    if (body.startTime && body.endTime && new Date(body.endTime).getTime() <= new Date(body.startTime).getTime()) { setNote(t('pos.clock_out_must_be_after_clock_1oib')); return; }
    setAdjBusy(true); setNote(null);
    try {
      await posTimeClockApi.adjustTimecard(shiftId, body);
      setAdjustFor(null);
      await load();
    } catch (e: any) { setNote(e?.message || t('pos.could_not_adjust_the_timecard')); }
    finally { setAdjBusy(false); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_time_clock')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const rows = s.technicians || [];
  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.time_clock')}</h1><div className="sub">{t('pos.today_s_technician_attendance')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.technicians')}</div><div className="v">{s.kpis.technicianCount}</div></div>
        <div className="kpi"><div className="l">{t('pos.clocked_in')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{s.kpis.clockedInCount}</div></div>
        <div className="kpi"><div className="l">{t('pos.hours_today')}</div><div className="v">{hrs(s.kpis.totalHoursToday)}</div></div>
      </div>

      {note ? <div className="err" style={{ marginTop: 12 }}>{note}</div> : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.roster')}</div>
        <div data-testid="tc-pager" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 14px 0' }}>
          <ImeSafeInput type="search" aria-label={t('pos.find_technician')} placeholder={t('pos.find_technician_placeholder')} value={search} onValue={setSearch} style={{ flex: '1 1 200px', minWidth: 0, height: 36 }} />
          {s.page && s.page.totalPages > 1 ? (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn ghost" disabled={s.page.page <= 1} onClick={() => setPage(Math.max(1, s.page!.page - 1))}>{t('pos.previous')}</button>
              <span>{t('pos.page_x_of_y', { page: String(s.page.page), pages: String(s.page.totalPages) })}</span>
              <button type="button" className="btn ghost" disabled={s.page.page >= s.page.totalPages} onClick={() => setPage(Math.min(s.page!.totalPages, s.page!.page + 1))}>{t('pos.next')}</button>
            </span>
          ) : null}
        </div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{s.page && s.page.totalAll > 0 ? t('pos.no_technician_matches') : t('pos.no_active_technicians')}</div> : (
       <div className="w-full overflow-x-auto">
  <table className="tbl min-w-[700px]">
            <thead><tr><th>{t('pos.technician')}</th><th>{t('pos.status')}</th><th>{t('pos.in_2')}</th><th>{t('pos.out')}</th><th style={{ textAlign: 'right' }}>{t('pos.hours_today')}</th><th style={{ width: 230 }}></th></tr></thead>
            <tbody>{rows.map((r) => (
              <Fragment key={r.technicianId}>
              <tr>
                <td style={{ fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ProfileAvatarWithPreview name={r.technicianName || 'Technician'} url={r.avatarUrl} size={28} type="technician" />
                    <span>{r.technicianName || <span style={{ color: 'var(--muted)' }}>{t('pos.unknown')}</span>}</span>
                  </div>
                </td>
                <td>{badge(r.state)}</td>
                <td>{fmtTime(r.clockedInAt)}</td>
                <td>{fmtTime(r.lastClockOutAt)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{hrs(r.hoursToday)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {r.state === 'clocked_in' ? (
                      <>
                        <button className="btn ghost" disabled={busy === r.technicianId} onClick={() => act(r.technicianId, 'break')}>{t('pos.start_break')}</button>
                        <button className="btn ghost" disabled={busy === r.technicianId} onClick={() => act(r.technicianId, 'lunch')}>{t('pos.lunch')}</button>
                        <button className="btn ghost" disabled={busy === r.technicianId} onClick={() => act(r.technicianId, 'out')}>{t('pos.clock_out')}</button>
                      </>
                    ) : r.state === 'on_break' ? (
                      <>
                        <button className="btn" disabled={busy === r.technicianId} onClick={() => act(r.technicianId, 'back')} title={r.onBreakSince ? t('pos.on_break_since_onbreaksince', { onBreakSince: String(fmtTime(r.onBreakSince)) }) : undefined}>{t('pos.end_break')}</button>
                        <button className="btn ghost" disabled={busy === r.technicianId} onClick={() => interrupt(r.technicianId)}>{t('pos.interrupted')}</button>
                      </>
                    ) : <button className="btn" disabled={busy === r.technicianId} onClick={() => act(r.technicianId, 'in')}>{t('pos.clock_in')}</button>}
                    <button className="btn ghost" disabled={pinBusy} onClick={() => openPinEditor(r.technicianId)}>{t('pos.reset_pin')}</button>
                    {r.shiftCount > 0 ? <button className="btn ghost" onClick={() => toggleShifts(r.technicianId)}>{expandedTech === r.technicianId ? t('pos.hide') : t('pos.shifts')}</button> : null}
                  </div>
                </td>
              </tr>
              {pinEditFor === r.technicianId ? (
                <tr><td colSpan={6} style={{ background: '#FBF7EF', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{t('pos.new_kiosk_clock_pin')}{r.technicianName ? t('pos.for_technicianname', { technicianName: String(r.technicianName) }) : ''}:</span>
                    <input value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} aria-label={t('pos.new_clock_pin_v0', { v0: String(r.technicianName ? t('pos.for_technicianname', { technicianName: String(r.technicianName) }) : '') })} style={{ width: 84, letterSpacing: 5, textAlign: 'center', fontWeight: 700, fontSize: 16 }} />
                    <button className="btn ghost" type="button" onClick={() => setPinValue(genPin4())}>{t('pos.generate')}</button>
                    <button className="btn" disabled={pinBusy} onClick={() => savePin(r.technicianId)}>{pinBusy ? t('pos.saving_2') : t('pos.save_pin')}</button>
                    <button className="btn ghost" type="button" onClick={() => { setPinEditFor(null); setPinValue(''); }}>{t('pos.cancel')}</button>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('pos.4_digits_used_by_the_technician_3vwv')}</span>
                  </div>
                </td></tr>
              ) : pinResult?.technicianId === r.technicianId ? (
                <tr><td colSpan={6} style={{ background: '#E9F6EC', padding: '9px 14px', color: '#2E7D5B', fontSize: 13 }}>
                  {t('pos.clock_pin_set_to')}{' '}<strong style={{ letterSpacing: 3 }}>{pinResult.pin}</strong>{r.technicianName ? t('pos.share_it_with_technicianname', { technicianName: String(r.technicianName) }) : ''} {t('pos.for_kiosk_clock_in')}
                </td></tr>
              ) : null}
              {expandedTech === r.technicianId ? (
                <tr><td colSpan={6} style={{ background: '#FBF7EF', padding: '8px 14px' }}>
                  {r.shifts.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{t('pos.no_punches_today')}</div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {r.shifts.map((p) => (
                        <div key={p.id} style={{ borderTop: '1px solid var(--line, #EADFCE)', paddingTop: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                            <span>{t('pos.in_2')}{' '}<strong>{fmtTime(p.startTime)}</strong></span>
                            <span>{t('pos.out')}{' '}<strong>{fmtTime(p.endTime)}</strong></span>
                            <span className="muted" style={{ fontSize: 11.5 }}>{codeLabel('admin.timeClock.shift', p.status)}</span>
                            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => openAdjust(p)}>{t('pos.adjust')}</button>
                          </div>
                          {adjustFor === p.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                              <label style={{ fontSize: 12 }}>{t('pos.in_2')}{' '}<input type="datetime-local" value={adjStart} onChange={(e) => setAdjStart(e.target.value)} aria-label={t('pos.corrected_clock_in')} /></label>
                              <label style={{ fontSize: 12 }}>{t('pos.out')}{' '}<input type="datetime-local" value={adjEnd} onChange={(e) => setAdjEnd(e.target.value)} aria-label={t('pos.corrected_clock_out')} /></label>
                              <input placeholder={t('pos.reason_for_correction')} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} aria-label={t('pos.correction_reason')} style={{ minWidth: 170, flex: 1 }} />
                              <button className="btn" disabled={adjBusy} onClick={() => saveAdjust(p.id)}>{adjBusy ? t('pos.saving_2') : t('pos.save_correction')}</button>
                              <button className="btn ghost" type="button" onClick={() => setAdjustFor(null)}>{t('pos.cancel')}</button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {(r.breaks || []).length ? <div style={{ fontWeight: 700, fontSize: 12, marginTop: 4 }}>{t('pos.breaks')}</div> : null}
                      {(r.breaks || []).map((b) => (
                        <div key={b.id} style={{ borderTop: '1px solid var(--line, #EADFCE)', paddingTop: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                            <span>{b.kind === 'lunch' ? t('pos.lunch') : t('pos.break')} <strong>{fmtTime(b.startedAt)}</strong> – <strong>{fmtTime(b.endedAt)}</strong></span>
                            <span className="muted" style={{ fontSize: 11.5 }}>{b.classification ? t('pos.v0_paid_v1_m_unpaid_v2_j2g4', { v0: String(breakClass(b.classification)), v1: String(b.paidMinutes ?? 0), v2: String(b.unpaidMinutes ?? 0) }) : t('admin.timeClock.breakOpen')}{b.interrupted ? t('pos.interrupted_2') : ''}</span>
                            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => { setNote(null); setBrkFor(b.id); setBrkStart(toLocalInput(b.startedAt)); setBrkEnd(toLocalInput(b.endedAt)); setBrkReason(''); }}>{t('pos.adjust')}</button>
                          </div>
                          {brkFor === b.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                              <label style={{ fontSize: 12 }}>{t('pos.start')}{' '}<input type="datetime-local" value={brkStart} onChange={(e) => setBrkStart(e.target.value)} aria-label={t('pos.corrected_break_start')} /></label>
                              <label style={{ fontSize: 12 }}>{t('pos.end')}{' '}<input type="datetime-local" value={brkEnd} onChange={(e) => setBrkEnd(e.target.value)} aria-label={t('pos.corrected_break_end')} /></label>
                              <input placeholder={t('pos.reason_for_correction')} value={brkReason} onChange={(e) => setBrkReason(e.target.value)} aria-label={t('pos.break_correction_reason')} style={{ minWidth: 170, flex: 1 }} />
                              <button className="btn" disabled={adjBusy} onClick={() => saveBreakAdjust(b.id)}>{adjBusy ? t('pos.saving_2') : t('pos.save_break')}</button>
                              <button className="btn ghost" type="button" onClick={() => setBrkFor(null)}>{t('pos.cancel')}</button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </td></tr>
              ) : null}
              </Fragment>
            ))}</tbody>
          </table>
          </div>
        )}
      </section>
      <BreakPolicyPanel />
      {askUi}
    </div>
  );
}
