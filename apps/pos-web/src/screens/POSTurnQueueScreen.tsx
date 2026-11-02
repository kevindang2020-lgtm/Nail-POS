// POSTurnQueueScreen.tsx — Team → Turn Queue (Fair Turn Engine mandate, wave 2): the technician TURN board (who is next
// and why, serving, appointment soon, break / hold, off shift — §90–92), the manager's actions (set next, move to back,
// hold / release, adjust turn credit, join — every one with a reason, §71–73), the queue health strip (§169–170), the
// append-only turn history with "why" lines (§133–138), the fairness dashboard (§112–114, never "unfair" — §56), the team
// report (§171–175, alphabetical — never a revenue ranking), the salon's turn settings with the Current → New preview
// (§120–124, §167), the turn-unit rules (§41–45) and the simulator (§168 — nothing on the floor changes).
// Realtime refresh + the 15-second safety sync come from useRealtime (§97–99). Inline dialogs only; no printing.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { centsToUsd } from '@aipowersalon/money';
import type {
  TurnBoardResponse, TurnBoardTechnician, TurnHealthResponse, TurnHistoryResponse, TurnFairnessResponse, TurnTeamReportResponse, TurnSettingsInfo,
  TurnSettingsPreview, TurnRulesResponse, TurnSimulationResponse, TurnAssignmentMode, TurnTechnicianSummaryResponse,
} from '@aipowersalon/api-contracts/tenant';
import { posTurnQueueApi as api, ApiError } from '../api/posTurnQueueApi';
import { useRealtime } from '../realtime/useRealtime';
import { useCan } from '../components/usePermissions';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel, statusLabelOrNull, humanizeCode } from '../i18n/status-label';
import { msg as note$, renderMsg, type Msg } from '../i18n/notice';
import { fmtTime, fmtYmd } from '../i18n/format';
import { codedText } from '../i18n/coded-text';
const GOLD = '#A96F22';
const card: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minWidth: 0 };
const head: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, color: '#2C2A27', fontFamily: 'var(--aps-font-head, Playfair Display)' };
const muted: React.CSSProperties = { color: '#8A857E', fontSize: 12.5 };
const errText: React.CSSProperties = { color: '#B4451E', fontSize: 12.5 };
const okText: React.CSSProperties = { color: '#3E8F57', fontSize: 12.5 };
const input: React.CSSProperties = { height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 12.5, fontFamily: 'inherit', minWidth: 0 };
const btn: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', color: '#4A4744', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnGold: React.CSSProperties = { ...btn, background: GOLD, color: '#fff', border: 'none' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11.5, color: '#8A857E', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { fontSize: 12.5, padding: '6px 8px', borderBottom: '1px solid #F1EBE1', whiteSpace: 'nowrap' };
const turns = (units: number | null | undefined) => (units == null ? '—' : (units / 100).toFixed(units % 100 === 0 ? 1 : 2).replace(/0$/, '').replace(/\.$/, '.0'));
const mins = (m: number | null | undefined) => (m == null ? '—' : m >= 60 ? tx('ops.common.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 }) : tx('ops.common.minutesShort', { n: m }));
const time = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtTime(d); };
/** the failed call's message (already in the cashier's language — client.ts apiErrorMessage), else the fallback key's text */
const msg = (e: unknown, fallbackKey = 'pos.action_failed_2') => (e instanceof ApiError || e instanceof Error ? e.message || tx(fallbackKey) : tx(fallbackKey));
/** a status note kept as a key + its tone (never guessed from the English words) */
type Note = { ok: boolean; m: Msg };
const opt = (code: string) => { const k = `ops.turn.opt.${code}`; const v = tx(k); return v === k ? null : v; };
const pretty = (s: string | null | undefined) => statusLabelOrNull(['turnReason', 'turnFairness'], s) ?? (s ? opt(s) : null) ?? (s ? humanizeCode(s) : '');
const statusText = (code: string) => (code === 'CLOCKED_IN' ? tx('ops.turn.status.clockedIn') : statusLabel('turnBoard', code));
const modeText = (code: string) => { const k = `ops.turn.mode.${code}`; const v = tx(k); return v === k ? code : v; };
const fairText = (code: string | null | undefined, gapUnits: number | null | undefined) => (code ? tx(`ops.turn.fair.${code}`, { turns: (Math.abs(gapUnits ?? 0) / 100).toFixed(1) }) : null);

const COLUMNS: { key: string; label: string }[] = [
  { key: 'NEXT_READY', get label() { return tx('pos.next_ready'); } }, { key: 'SERVING', get label() { return tx('pos.serving'); } }, { key: 'APPOINTMENT_SOON', get label() { return tx('pos.appointment_soon'); } },
  { key: 'BREAK_HOLD', get label() { return tx('pos.break_hold'); } }, { key: 'OFF_SHIFT', get label() { return tx('pos.off_shift_3'); } },
];
/** the turn reason code (a one-word code — kept apart so the string scanner does not read it as English) */
const TRAINING_CODE = ['TRAINING'][0];
type Tab = 'board' | 'history' | 'fairness' | 'reports' | 'settings' | 'simulate';

export function POSTurnQueueScreen() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('board');
  const tabs: { key: Tab; label: string; perm: string }[] = [
    { key: 'board', label: tx('pos.turn_board'), perm: 'turn_queue.read' }, { key: 'history', label: tx('pos.history'), perm: 'turn_queue.history.read' },
    { key: 'fairness', label: tx('pos.turn_fairness'), perm: 'turn_queue.history.read' }, { key: 'reports', label: tx('pos.team_report'), perm: 'turn_queue.history.read' },
    { key: 'settings', label: tx('pos.settings_turn_rules'), perm: 'turn_queue.read' }, { key: 'simulate', label: tx('pos.simulate'), perm: 'turn_queue.read' },
  ];
  return (
    <div style={{ padding: 18, display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{tx('pos.turn_queue')}</h1>
        <span style={muted}>{tx('pos.fair_turns_every_eligible_technician_gets_1t8f')}</span>
      </div>
      <div role="tablist" aria-label={tx('pos.turn_queue_sections')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.filter((t) => can(t.perm)).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} style={tab === t.key ? btnGold : btn} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'board' ? <BoardTab /> : tab === 'history' ? <HistoryTab /> : tab === 'fairness' ? <FairnessTab /> : tab === 'reports' ? <ReportsTab /> : tab === 'settings' ? <SettingsTab /> : <SimulateTab />}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────────────────────────────────────────
function BoardTab() {
  const can = useCan();
  const { ask, askUi } = useInlineAsk();
  const [board, setBoard] = useState<TurnBoardResponse | null>(null);
  const [health, setHealth] = useState<TurnHealthResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [b, h] = await Promise.all([api.board(), api.health().catch(() => null)]); setBoard(b); setHealth(h); setErr(null); }
    catch (e) { setErr(msg(e, 'ops.turn.err.board')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtime('turn-queue', load);
  const run = async (key: string, fn: () => Promise<unknown>, ok: Msg) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote({ ok: true, m: ok }); await load(); } catch (e) { setNote({ ok: false, m: msg(e) }); } finally { setBusy(null); }
  };
  const withReason = (q: string, f: (r: string) => Promise<unknown>, ok: Msg, key: string) => ask(q, (r) => { void run(key, () => f(r), ok); }, { minLength: 3, inputLabel: tx('pos.reason_2') });

  if (err && !board) return <div role="alert" style={{ ...card, ...errText }}>{err} <button style={btn} onClick={() => void load()}>{tx('pos.try_again')}</button></div>;
  if (!board) return <div style={card}><span style={muted}>{tx('pos.loading_the_turn_board')}</span></div>;
  const by = (col: string) => board.technicians.filter((t) => t.column === col);
  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      {askUi}
      <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><b>{modeText(board.assignmentMode)}</b> <span style={muted}>· {opt(board.mode) ?? board.modeLabel}</span></span>
        <span style={muted}>{tx('pos.business_day')}{' '}{board.businessDate} {tx('pos.rules_v')}{board.policyVersion}</span>
        {health ? <>
          <span>{tx('pos.waiting_guests_2')}{' '}<b>{health.waitingCustomers}</b></span><span>{tx('pos.ready')}{' '}<b>{health.readyTechnicians}</b></span><span>{tx('pos.serving')}{' '}<b>{health.techniciansServing}</b></span>
          <span>{tx('pos.on_break')}{' '}<b>{health.techniciansOnBreak}</b></span><span>{tx('pos.longest_guest_wait')}{' '}<b>{mins(health.longestCustomerWaitMinutes)}</b></span>
          <span>{tx('pos.longest_ready_wait')}{' '}<b>{mins(health.longestTechnicianReadyMinutes)}</b></span><span>{tx('pos.appointments_next_hour')}{' '}<b>{health.upcomingAppointmentsNextHour}</b></span>
        </> : null}
      </div>
      {health?.exceptions?.length ? (
        <div style={{ ...card, background: '#FBEEDD' }} aria-label={tx('pos.queue_exceptions')}>
          {health.exceptions.map((x, i) => (
            <div key={i} style={{ fontSize: 12.5, color: x.severity === 'warning' ? '#9B6B1E' : '#6C6965', display: 'flex', gap: 8, alignItems: 'center' }}>• {codedText({ code: 'TURN_HEALTH.' + x.code, vars: x.vars }, x.text)}
              {x.code === 'TURN_DAY_NOT_CLOSED' && x.businessDate && can('turn_queue.adjust') ? <button style={{ ...btn, height: 24, fontSize: 11 }} disabled={busy === 'close' + x.businessDate}
                onClick={() => void run('close' + x.businessDate, () => api.closeDay(x.businessDate!), note$('ops.turn.ok.closeDay', { date: x.businessDate! }))}>{tx('pos.close')}{' '}{x.businessDate}</button> : null}
            </div>
          ))}
        </div>
      ) : null}
      {note ? <div role="status" style={{ ...card, padding: 8, ...(note.ok ? okText : errText) }}>{renderMsg(note.m)}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, alignItems: 'start' }}>
        {COLUMNS.map((c) => (
          <section key={c.key} aria-label={c.label} style={{ ...card, padding: 10, display: 'grid', gap: 8 }}>
            <div style={head}>{c.label} <span style={muted}>({by(c.key).length})</span></div>
            {by(c.key).length === 0 ? <div style={muted}>{tx('pos.nobody')}</div> : by(c.key).map((t) => (
              <TechCard key={t.technicianId} t={t} isNext={t.technicianId === board.nextUpTechnicianId} busy={busy} money={board.moneyVisible}
                onSetNext={can('turn_queue.reorder') ? () => withReason(tx('ops.turn.ask.setNext', { name: t.name }), (r) => api.reorder(t.technicianId, { setNext: true, reason: r }), note$('ops.turn.ok.setNext', { name: t.name }), t.technicianId + 'next') : undefined}
                onBack={can('turn_queue.reorder') ? () => withReason(tx('ops.turn.ask.back', { name: t.name }), (r) => api.reorder(t.technicianId, { toBack: true, reason: r }), note$('ops.turn.ok.back', { name: t.name }), t.technicianId + 'back') : undefined}
                onHold={can('turn_queue.hold') && t.inRotation && t.status !== 'HOLD' && t.status !== 'CLOCKED_OUT' ? () => withReason(tx('ops.turn.ask.hold', { name: t.name }), (r) => api.hold(t.technicianId, r), note$('ops.turn.ok.hold', { name: t.name }), t.technicianId + 'hold') : undefined}
                onRelease={can('turn_queue.hold') && t.status === 'HOLD' ? () => void run(t.technicianId + 'release', () => api.release(t.technicianId, {}), note$('ops.turn.ok.release', { name: t.name })) : undefined}
                onAdjust={can('turn_queue.adjust') ? () => ask(tx('ops.turn.ask.adjustTurns', { name: t.name }), (v) => withReason(tx('ops.turn.ask.adjustWhy', { name: t.name, turns: v }), (r) => api.adjust(t.technicianId, { turns: v, reason: r }), note$('ops.turn.ok.adjust', { name: t.name, turns: v }), t.technicianId + 'adj'), { inputLabel: tx('pos.turns') }) : undefined}
                onJoin={can('turn_queue.join') && !t.inRotation && t.status === 'CLOCKED_IN' ? () => void run(t.technicianId + 'join', () => api.join(t.technicianId), note$('ops.turn.ok.join', { name: t.name })) : undefined}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function TechCard({ t, isNext, busy, money, onSetNext, onBack, onHold, onRelease, onAdjust, onJoin }: { t: TurnBoardTechnician; isNext: boolean; busy: string | null; money: boolean;
  onSetNext?: () => void; onBack?: () => void; onHold?: () => void; onRelease?: () => void; onAdjust?: () => void; onJoin?: () => void }) {
  const [open, setOpen] = useState(false);
  const disabled = !!busy && busy.startsWith(t.technicianId);
  return (
    <div aria-label={tx('pos.name_turn_card', { name: String(t.name) })} style={{ border: `1px solid ${isNext ? GOLD : 'var(--line)'}`, borderRadius: 12, padding: 8, background: '#fff', display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {t.avatarUrl ? <img src={t.avatarUrl} alt="" width={30} height={30} style={{ borderRadius: 999, objectFit: 'cover' }} /> : <div aria-hidden style={{ width: 30, height: 30, borderRadius: 999, background: '#F3ECE1' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.rank != null ? `#${t.rank} ` : ''}{t.name}</div>
          <div style={{ fontSize: 11.5, color: isNext ? GOLD : '#6C6965', fontWeight: 600 }}>{statusText(t.status)}{t.holdReason ? ` · ${pretty(t.holdReason)}` : ''}</div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: '#4A4744', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <span>{tx('pos.turns')}{' '}<b>{turns(t.turnUnitsToday)}</b>{t.inProgressUnits ? ` (+${turns(t.inProgressUnits)})` : ''}</span>
        <span>{tx('pos.full')}{' '}{t.fullTurns} {tx('pos.half')}{' '}{t.partialTurns}</span>
        <span>{tx('pos.walk_ins')}{' '}{t.walkInsToday}</span><span>{tx('pos.appts_2')}{' '}{t.appointmentsToday}</span>
        <span>{tx('pos.ready')}{' '}{t.readyMinutes != null && t.readySince ? mins(t.readyMinutes) : '—'}</span><span>{tx('pos.clocked')}{' '}{mins(t.clockedMinutes)}</span>
        {t.nextAppointmentAt ? <span style={{ gridColumn: '1 / -1' }}>{tx('pos.next_appt')}{' '}{time(t.nextAppointmentAt)} ({mins(t.nextAppointmentInMinutes)})</span> : null}
        {t.currentService ? <span style={{ gridColumn: '1 / -1' }}>{tx('pos.now_2')}{' '}{t.currentService.label}</span> : null}
        {t.onBreakSince ? <span style={{ gridColumn: '1 / -1' }}>{tx('pos.on_break_since')}{' '}{time(t.onBreakSince)}</span> : null}
        {money && t.money ? <span style={{ gridColumn: '1 / -1' }}>{tx('pos.sales')}{' '}{centsToUsd(t.money.serviceSalesCents)} {tx('pos.comm_3')}{' '}{centsToUsd(t.money.commissionCents)} {tx('pos.tips_2')}{' '}{centsToUsd(t.money.tipsCents)} {tx('pos.est_3')}{' '}{centsToUsd(t.money.estimatedEarningsCents)}</span> : null}
      </div>
      {t.basis ? <div style={{ fontSize: 11, color: '#8A857E' }}>{tx('pos.why_this_place')}{' '}{codedText(t.basisText, t.basis)}{t.skipsToday ? tx('pos.skipped_skipstoday_today_position_kept', { skipsToday: String(t.skipsToday) }) : ''}</div> : null}
      {(onSetNext || onBack || onHold || onRelease || onAdjust || onJoin) ? (
        <div>
          <button style={{ ...btn, height: 24, fontSize: 11 }} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? tx('pos.close') : tx('pos.actions')}</button>
          {open ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {onJoin ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onJoin}>{tx('pos.join_rotation')}</button> : null}
              {onSetNext && t.inRotation ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onSetNext}>{tx('pos.set_next')}</button> : null}
              {onBack && t.inRotation ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onBack}>{tx('pos.move_to_back')}</button> : null}
              {onHold ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onHold}>{tx('pos.hold')}</button> : null}
              {onRelease ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onRelease}>{tx('pos.release')}</button> : null}
              {onAdjust ? <button disabled={disabled} style={{ ...btn, height: 24, fontSize: 11 }} onClick={onAdjust}>{tx('pos.adjust_turns')}</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────
function HistoryTab() {
  const [f, setF] = useState<{ from?: string; to?: string; technicianId?: string; reasonCode?: string; manualOnly?: boolean }>({});
  const [h, setH] = useState<TurnHistoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setH(await api.history(f)); setErr(null); } catch (e) { setErr(msg(e, 'ops.turn.err.history')); } }, [f]);
  useEffect(() => { void load(); }, [load]);
  const techs = useMemo(() => [...new Map((h?.events ?? []).map((e) => [e.technicianId, e.technicianName ?? tx('pos.technician')])).entries()], [h]);
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.from')}</span><input type="date" aria-label={tx('pos.from')} style={input} value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} /></label>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.to_2')}</span><input type="date" aria-label={tx('pos.to_2')} style={input} value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} /></label>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.technician')}</span>
          <select aria-label={tx('pos.technician')} style={input} value={f.technicianId ?? ''} onChange={(e) => setF({ ...f, technicianId: e.target.value || undefined })}>
            <option value="">{tx('pos.everyone')}</option>{techs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select></label>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.reason_2')}</span>
          <select aria-label={tx('pos.reason_2')} style={input} value={f.reasonCode ?? ''} onChange={(e) => setF({ ...f, reasonCode: e.target.value || undefined })}>
            <option value="">{tx('pos.any')}</option>{['SKILL_INELIGIBLE', 'ON_BREAK', 'APPOINTMENT_CONFLICT', 'ALREADY_SERVING', 'CUSTOMER_REQUEST', 'CUSTOMER_DECLINED', 'LANGUAGE_MATCH', 'MANAGER_HOLD', 'NOT_CLOCKED_IN', 'MANUAL_OVERRIDE', TRAINING_CODE, 'MANAGER_DECISION'].map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
          </select></label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={!!f.manualOnly} onChange={(e) => setF({ ...f, manualOnly: e.target.checked || undefined })} /> {tx('pos.manager_actions_only')}</label>
      </div>
      {err ? <div role="alert" style={errText}>{err}</div> : !h ? <div style={muted}>{tx('pos.loading')}</div> : h.events.length === 0 ? <div style={muted}>{tx('pos.no_turn_events_in_this_range')}</div> : (
        <div style={{ maxHeight: 640, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>{tx('pos.day')}</th><th style={th}>#</th><th style={th}>{tx('pos.time')}</th><th style={th}>{tx('pos.what_happened')}</th><th style={th}>{tx('pos.turn')}</th><th style={th}>{tx('pos.by_2')}</th><th style={th}>{tx('pos.rules')}</th></tr></thead>
            <tbody>{h.events.map((e) => (
              <tr key={e.id}><td style={td}>{fmtYmd(e.businessDate, undefined, e.businessDate)}</td><td style={td}>{e.sequenceNumber}</td><td style={td}>{time(e.occurredAt)}</td>
                <td style={{ ...td, whiteSpace: 'normal' }}>{codedText(e.textCoded, e.text)}{e.reasonText ? <span style={muted}> — “{e.reasonText}”</span> : null}</td>
                <td style={td}>{e.turnUnitsDelta ? `${e.turnUnitsDelta > 0 ? '+' : ''}${turns(e.turnUnitsDelta)}` : e.turnUnits ? turns(e.turnUnits) : ''}</td>
                <td style={td}>{e.actorType === 'system' ? tx('pos.system') : e.actorType === 'technician' ? tx('pos.technician') : tx('pos.staff')}</td><td style={td}>v{e.policyVersion ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Fairness ─────────────────────────────────────────────────────────────────────────────────────────────────────
function FairnessTab() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [r, setR] = useState<TurnFairnessResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setR(await api.fairness(range)); setErr(null); } catch (e) { setErr(msg(e, 'ops.turn.err.fairness')); } }, [range]);
  useEffect(() => { void load(); }, [load]);
  useRealtime('turn-queue', load, { intervalMs: 60_000 });
  const tone = (i: string) => (i === 'WITHIN_FAIR_RANGE' ? '#3E8F57' : i === 'BELOW_EXPECTED_OPPORTUNITY' ? '#9B6B1E' : '#6C6965');
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.from')}</span><input type="date" aria-label={tx('pos.fairness_from')} style={input} value={range.from ?? ''} onChange={(e) => setRange({ ...range, from: e.target.value || undefined })} /></label>
        <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.to_2')}</span><input type="date" aria-label={tx('pos.fairness_to')} style={input} value={range.to ?? ''} onChange={(e) => setRange({ ...range, to: e.target.value || undefined })} /></label>
        {r ? <span style={muted}>{tx('pos.opportunities')}{' '}{r.team.opportunities} {tx('pos.automatic')}{' '}{r.team.automaticAssignments} {tx('pos.confirmed_3')}{' '}{r.team.confirmedRecommendations} {tx('pos.manual_overrides')}{' '}{r.team.overrides}{r.team.overrideRate != null ? ` (${r.team.overrideRate}%)` : ''}</span> : null}
      </div>
      {err ? <div role="alert" style={{ ...card, ...errText }}>{err}</div> : !r ? <div style={card}><span style={muted}>{tx('pos.loading')}</span></div> : (
        <div style={card}>
          <div style={{ ...muted, marginBottom: 8 }}>{codedText(r.methodologyCode ? { code: 'TURN_METHODOLOGY.' + r.methodologyCode } : null, r.methodology)} {tx('pos.an_operational_diagnostic_not_payroll')}</div>
          {r.rows.length === 0 ? <div style={muted}>{tx('pos.no_turn_activity_in_this_range_q8dz')}</div> : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{[tx('pos.technician'), tx('pos.eligible_hours'), tx('pos.turn_units'), tx('pos.expected_opportunity'), tx('pos.fairness_gap'), tx('pos.avg_ready_wait'), tx('pos.walk_ins'), tx('pos.appointments'), tx('pos.overrides'), tx('pos.skips_2'), tx('pos.status')].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{r.rows.map((x) => (
                <tr key={x.technicianId}>
                  <td style={td}>{x.name ?? tx('pos.technician')}</td><td style={td}>{x.eligibleHours}</td><td style={td}>{turns(x.actualUnits)}</td><td style={td}>{turns(x.expectedUnits)}</td>
                  <td style={td}>{x.gapUnits > 0 ? '+' : ''}{turns(x.gapUnits)}</td><td style={td}>{mins(x.averageReadyWaitMinutes)}</td><td style={td}>{x.walkIns}</td><td style={td}>{x.appointments}</td>
                  <td style={td}>{x.overrides}</td><td style={{ ...td, whiteSpace: 'normal' }} title={Object.entries(x.skipsByReason).map(([k, v]) => `${pretty(k)}: ${v}`).join(', ')}>{x.skips}</td>
                  <td style={{ ...td, color: tone(x.indicator), fontWeight: 700 }}>{fairText(x.indicator, x.gapUnits) ?? x.indicatorLabel}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {Object.keys(r.team.skipsByReason).length ? <div style={{ marginTop: 10, fontSize: 12.5 }}><b>{tx('pos.why_turn_totals_differ_skips')}</b> {Object.entries(r.team.skipsByReason).map(([k, v]) => `${pretty(k)} ${v}`).join(' · ')}</div> : null}
        </div>
      )}
    </div>
  );
}

// ── Team report (daily closing / weekly / monthly) ───────────────────────────────────────────────────────────────
function ReportsTab() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [date, setDate] = useState<string>('');
  const [r, setR] = useState<TurnTeamReportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; data: TurnTechnicianSummaryResponse | null; err: string | null } | null>(null);
  const openDetail = async (id: string) => {
    if (detail?.id === id) { setDetail(null); return; }
    setDetail({ id, data: null, err: null });
    try { const d = await api.technicianSummary(id, { period, date: date || undefined }); setDetail({ id, data: d, err: null }); }
    catch (e) { setDetail({ id, data: null, err: msg(e, 'ops.turn.err.summary') }); }
  };
  const load = useCallback(async () => { try { setR(await api.teamReport({ period, date: date || undefined })); setErr(null); } catch (e) { setErr(msg(e, 'ops.turn.err.report')); } }, [period, date]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 10 }}>
        {(['day', 'week', 'month'] as const).map((p) => <button key={p} style={period === p ? btnGold : btn} onClick={() => setPeriod(p)}>{p === 'day' ? tx('pos.today_day') : p === 'week' ? tx('pos.week') : tx('pos.month')}</button>)}
        <input type="date" aria-label={tx('pos.report_date')} style={input} value={date} onChange={(e) => setDate(e.target.value)} />
        {r ? <span style={muted}>{r.from} → {r.to} {tx('pos.listed_alphabetically_never_a_revenue_ranking_1gwb')}</span> : null}
      </div>
      {err ? <div role="alert" style={errText}>{err}</div> : !r ? <div style={muted}>{tx('pos.loading')}</div> : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 8 }}>
            <span>{tx('pos.technicians_worked')}{' '}<b>{r.totals.techniciansWorked ?? 0}</b></span><span>{tx('pos.clocked')}{' '}<b>{mins(r.totals.clockedMinutes)}</b></span><span>{tx('pos.breaks')}{' '}<b>{mins(r.totals.breakMinutes)}</b></span>
            <span>{tx('pos.walk_ins')}{' '}<b>{r.totals.walkIns ?? 0}</b></span><span>{tx('pos.appointments')}{' '}<b>{r.totals.appointments ?? 0}</b></span><span>{tx('pos.turns')}{' '}<b>{turns(r.totals.turnUnits)}</b></span><span>{tx('pos.overrides')}{' '}<b>{r.totals.overrides ?? 0}</b></span>
            {r.moneyVisible ? <><span>{tx('pos.sales')}{' '}<b>{centsToUsd(r.totals.serviceSalesCents ?? 0)}</b></span><span>{tx('pos.tips')}{' '}<b>{centsToUsd(r.totals.tipsCents ?? 0)}</b></span><span>{tx('pos.commission')}{' '}<b>{centsToUsd(r.totals.commissionCents ?? 0)}</b></span></> : null}
            {r.totals.fairnessExceptions != null ? <span>{tx('pos.outside_fair_range')}{' '}<b>{r.totals.fairnessExceptions}</b></span> : null}
          </div>
          {r.rows.length === 0 ? <div style={muted}>{tx('pos.nobody_worked_in_this_period')}</div> : (
            <div style={{ overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>{[tx('pos.technician'), tx('pos.worked'), tx('pos.paid_break'), tx('pos.unpaid_break'), tx('pos.service_3'), tx('pos.utilization'), tx('pos.walk_ins'), tx('pos.appts_done_no_show'), tx('pos.turns'), tx('pos.turns_hr'), tx('pos.fairness'), ...(r.moneyVisible ? [tx('pos.sales'), tx('pos.tips'), tx('pos.commission'), tx('pos.est_earnings')] : [])].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{r.rows.map((x) => (
                  <Fragment key={x.technicianId}>
                  <tr>
                    <td style={td}><button style={{ ...btn, height: 24, border: 'none', padding: 0, background: 'transparent', textDecoration: 'underline' }} aria-expanded={detail?.id === x.technicianId} onClick={() => void openDetail(x.technicianId)}>{x.name}</button></td><td style={td}>{mins(x.time.eligibleWorkedMinutes)}</td><td style={td}>{mins(x.time.paidBreakMinutes)}</td><td style={td}>{mins(x.time.unpaidBreakMinutes)}</td>
                    <td style={td}>{mins(x.time.serviceMinutes)}</td><td style={td}>{x.time.utilization == null ? '—' : `${Math.round(x.time.utilization * 100)}%`}</td>
                    <td style={td}>{x.walkIns.assigned}</td><td style={td}>{x.appointments.scheduled} ({x.appointments.completed} / {x.appointments.noShow})</td><td style={td}>{turns(x.turns.turnUnits)}</td>
                    <td style={td}>{x.turnUnitsPerEligibleHour ?? '—'}</td><td style={td}>{fairText(x.fairnessIndicatorCode, x.fairnessGapUnits) ?? x.fairnessIndicator ?? '—'}</td>
                    {r.moneyVisible ? <><td style={td}>{centsToUsd(x.money?.serviceSalesCents ?? 0)}</td><td style={td}>{centsToUsd(x.money?.tipsCents ?? 0)}</td><td style={td}>{centsToUsd(x.money?.commissionCents ?? 0)}</td><td style={td}>{centsToUsd(x.money?.estimatedEarningsCents ?? 0)}</td></> : null}
                  </tr>
                  {detail?.id === x.technicianId ? (
                    <tr><td colSpan={99} style={{ ...td, whiteSpace: 'normal', background: '#FBF7EF' }} aria-label={tx('pos.name_summary', { name: String(x.name) })}>
                      {detail.err ? <span role="alert" style={errText}>{detail.err}</span> : !detail.data ? <span style={muted}>{tx('pos.loading')}</span> : (
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
                          <span>{detail.data.from} → {detail.data.to}</span>
                          <span>{tx('pos.walk_ins')}{' '}{detail.data.walkIns.completed} {tx('pos.done_2')}{' '}{detail.data.walkIns.requested} {tx('pos.requested_4')}{' '}{detail.data.walkIns.firstAvailable} {tx('pos.first_available_2')}</span>
                          <span>{tx('pos.appointments')}{' '}{detail.data.appointments.completed} {tx('pos.done_2')}{' '}{detail.data.appointments.canceled} {tx('pos.canceled')}{' '}{detail.data.appointments.noShow} {tx('pos.no_show_3')}{' '}{detail.data.appointments.anyTechnician} {tx('pos.any_tech')}</span>
                          <span>{tx('pos.turns')}{' '}{turns(detail.data.turns.turnUnits)} {tx('pos.auto')}{' '}{detail.data.turns.automaticAssignments} {tx('pos.manual')}{' '}{detail.data.turns.manualAssignments} {tx('pos.skips')}{' '}{detail.data.turns.eligibleSkips} {tx('pos.declines')}{' '}{detail.data.turns.voluntaryDeclines}</span>
                          <span>{tx('pos.avg_ready_wait')}{' '}{mins(detail.data.turns.averageReadyWaitMinutes)}</span>
                          {detail.data.time.interruptedBreaks ? <span>{tx('pos.interrupted_breaks')}{' '}{detail.data.time.interruptedBreaks}</span> : null}
                          {detail.data.money ? <span>{tx('pos.est_earnings')}{' '}{centsToUsd(detail.data.money.estimatedEarningsCents)}{detail.data.money.approvedCents != null ? tx('pos.approved_approvedcents', { approvedCents: String(centsToUsd(detail.data.money.approvedCents)) }) : ''}{detail.data.money.paidCents != null ? tx('pos.paid_paidcents', { paidCents: String(centsToUsd(detail.data.money.paidCents)) }) : ''} ({statusLabel('payout', detail.data.money.status)})</span> : null}
                          {detail.data.previous ? <span style={muted}>{tx('pos.previous_period_turns')}{' '}{turns(detail.data.previous.turns.turnUnits)} {tx('pos.worked_2')}{' '}{mins(detail.data.previous.time.eligibleWorkedMinutes)}</span> : null}
                        </div>
                      )}
                    </td></tr>
                  ) : null}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
          <div style={{ ...muted, marginTop: 8 }}>{codedText({ code: 'TURN_METHODOLOGY.utilization' }, r.methodology.utilization)} {codedText({ code: 'TURN_METHODOLOGY.money' }, r.methodology.money)}</div>
        </>
      )}
    </div>
  );
}

// ── Settings & turn rules ────────────────────────────────────────────────────────────────────────────────────────
const POLICY_FIELDS: { key: string; label: string; options?: string[]; number?: [number, number] }[] = [
  { key: 'clockInJoinPosition', get label() { return tx('pos.clock_in_join_position'); }, options: ['BACK_OF_QUEUE', 'MANAGER_SELECTED_POSITION', 'FAIRNESS_ENGINE_BASELINE'] },
  { key: 'autoJoinRotationOnClockIn', get label() { return tx('pos.join_the_rotation_on_clock_in'); }, options: ['true', 'false'] },
  { key: 'requestedClientTurnPolicy', get label() { return tx('pos.requested_technician_guest'); }, options: ['DO_NOT_CONSUME_ROTATION_TURN', 'COUNT_FULL_TURN', 'COUNT_WEIGHTED_TURN', 'MANAGER_DECIDES'] },
  { key: 'appointmentTurnPolicy', get label() { return tx('pos.appointments'); }, options: ['DO_NOT_COUNT', 'COUNT_ALL', 'COUNT_ANY_TECH_APPOINTMENTS', 'COUNT_REQUESTED_APPOINTMENTS', 'WEIGHT_BY_SERVICE'] },
  { key: 'walkInPolicy', get label() { return tx('pos.walk_in_policy'); }, options: ['FAIR_TURN_ENGINE', 'PREFERRED_TECHNICIAN_FIRST'] },
  { key: 'languageMatch', get label() { return tx('pos.guest_s_language_158'); }, options: ['OFF', 'SOFT', 'HARD'] },   // SOFT = prefer a technician who speaks it; HARD = required
  { key: 'appointmentProtectionEnabled', get label() { return tx('pos.appointment_protection'); }, options: ['true', 'false'] },
  { key: 'appointmentProtectionBufferMinutes', get label() { return tx('pos.appointment_buffer_min'); }, number: [0, 120] },
  { key: 'breakPositionPolicy', get label() { return tx('pos.break_position'); }, options: ['PRESERVE_POSITION', 'MOVE_TO_BACK_ON_RETURN', 'REJOIN_BY_FAIRNESS', 'MANAGER_DECIDES'] },
  { key: 'preservePositionForMinutes', get label() { return tx('pos.keep_place_for_breaks_up_to_1d4u'); }, number: [0, 240] },
  { key: 'afterPreserveWindow', get label() { return tx('pos.after_that'); }, options: ['PRESERVE', 'MOVE_BACK', 'MANAGER_DECIDES'] },
  { key: 'halfTurnBehavior', get label() { return tx('pos.half_turns'); }, options: ['WAIT_UNTIL_FULL_TURN', 'KEEP_RELATIVE_POSITION', 'MOVE_PARTIALLY'] },
  { key: 'defaultTurnUnits', get label() { return tx('pos.default_turn_hundredths_100_1_0'); }, number: [0, 1000] },
  { key: 'technicianDeclinePolicy', get label() { return tx('pos.technician_declines_personal_reasons'); }, options: ['KEEP_POSITION', 'MOVE_TO_BACK', 'CHARGE_HALF_TURN', 'CHARGE_FULL_TURN', 'MANAGER_DECIDES'] },
  { key: 'offerTimeoutPolicy', get label() { return tx('pos.offer_timeout'); }, options: ['KEEP_POSITION', 'MOVE_BACK', 'MANAGER_REVIEW'] },
  { key: 'manualAssignmentTurnPolicy', get label() { return tx('pos.manual_assignments'); }, options: ['COUNT_AS_TURN', 'DO_NOT_COUNT'] },
  { key: 'maxConsecutiveAutomaticAssignments', get label() { return tx('pos.max_automatic_in_a_row_0_107o'); }, number: [0, 20] },
  { key: 'lateTechnicianPolicy', get label() { return tx('pos.late_technician'); }, options: ['NO_QUEUE_PENALTY', 'JOIN_BACK'] },
  { key: 'dailyFairnessCarryover', get label() { return tx('pos.carry_yesterday_s_imbalance'); }, options: ['NONE', 'PARTIAL', 'FULL'] },
  { key: 'startOfDayOrder', get label() { return tx('pos.start_of_day_order'); }, options: ['CLOCK_IN_ORDER', 'SCHEDULE_ORDER', 'PREVIOUS_ROTATION_CARRYOVER', 'MANAGER_DEFINED'] },
  { key: 'technicianQueueVisibility', get label() { return tx('pos.technician_app_shows'); }, options: ['FULL_TEAM_QUEUE', 'POSITION_ONLY', 'NEXT_FEW', 'PRIVATE_POSITION'] },
  { key: 'specialRotationEnabled', get label() { return tx('pos.special_job_rotation'); }, options: ['true', 'false'] },
  { key: 'revenueBalanceIndicator', get label() { return tx('pos.show_sales_beside_turns_managers'); }, options: ['true', 'false'] },
];

/** a policy value as staff read it: Yes / No, a known option, a number as-is */
const optValue = (v: unknown) => (v === true ? tx('pos.yes') : v === false ? tx('pos.no') : typeof v === 'string' ? pretty(v) : String(v ?? '—'));

function SettingsTab() {
  const can = useCan();
  const { ask, askUi } = useInlineAsk();
  const [info, setInfo] = useState<TurnSettingsInfo | null>(null);
  const [mode, setMode] = useState<TurnAssignmentMode>('RECOMMEND_AND_CONFIRM');
  const [fairness, setFairness] = useState<string>('traditional_weighted_rotation');
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const [scope, setScope] = useState<'branch' | 'salon'>('branch');
  const [preview, setPreview] = useState<TurnSettingsPreview | null>(null);
  const [rules, setRules] = useState<TurnRulesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [rule, setRule] = useState<{ scope: 'service' | 'category' | 'duration'; target: string; turns: string; special: boolean }>({ scope: 'category', target: '', turns: '1', special: false });
  const load = useCallback(async () => {
    try {
      const [i, r] = await Promise.all([api.settings(), api.rules()]);
      setInfo(i); setRules(r); setMode(i.effective.assignmentMode); setFairness(i.effective.fairnessMode); setPatch({}); setPreview(null); setErr(null);
    } catch (e) { setErr(msg(e, 'ops.turn.err.settings')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (err && !info) return <div role="alert" style={{ ...card, ...errText }}>{err}</div>;
  if (!info) return <div style={card}><span style={muted}>{tx('pos.loading')}</span></div>;
  const canManage = info.canManage && can('turn_queue.settings.manage');
  const current = info.effective.turnPolicy as Record<string, unknown>;
  const value = (k: string) => (k in patch ? patch[k] : current[k]);
  const set = (k: string, raw: string, number?: boolean) => { const v = number ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw; setPatch({ ...patch, [k]: v }); setPreview(null); };
  const body = () => ({ assignmentMode: mode !== info.effective.assignmentMode ? mode : undefined, fairnessMode: fairness !== info.effective.fairnessMode ? fairness : undefined, turnPolicy: Object.keys(patch).length ? patch : undefined });
  const doPreview = async () => { setNote(null); try { setPreview(await api.previewSettings({ scope, ...body() })); } catch (e) { setNote({ ok: false, m: msg(e) }); } };
  const save = () => ask(tx('ops.turn.ask.saveRules'), async (reason) => {
    const b = body();
    try {
      await api.saveSettings({ scope, reason, patch: { ...(b.assignmentMode ? { assignmentMode: b.assignmentMode } : {}), ...(b.fairnessMode ? { rotationPolicy: b.fairnessMode } : {}), ...(b.turnPolicy ? { turnPolicy: b.turnPolicy } : {}) } });
      setNote({ ok: true, m: note$('pos.turn_rules_saved_assignments_from_now_vl28') }); await load();
    } catch (e) { setNote({ ok: false, m: msg(e, 'ops.turn.err.save') }); }
  }, { minLength: 3, inputLabel: tx('pos.reason_2') });
  const applyDefaults = () => { setMode(info.recommended.assignmentMode); setFairness(info.recommended.fairnessMode); setPatch({ ...info.recommended.turnPolicy as Record<string, unknown> }); setPreview(null); };
  const saveRule = () => ask(tx('ops.turn.ask.ruleWhy'), async (reason) => {
    try {
      await api.saveRule({ scope: rule.scope, ...(rule.scope === 'service' ? { serviceId: rule.target } : rule.scope === 'category' ? { category: rule.target } : { maxDurationMinutes: Number(rule.target) }), turns: rule.turns, specialRotation: rule.special, reason });
      setNote({ ok: true, m: note$('pos.turn_rule_saved') }); setRule({ ...rule, target: '' }); setRules(await api.rules());
    } catch (e) { setNote({ ok: false, m: msg(e, 'ops.turn.err.rule') }); }
  }, { optional: true, inputLabel: tx('pos.reason_optional') });
  const retire = (ruleKey: string) => ask(tx('ops.turn.ask.retire'), async (reason) => { try { await api.retireRule(ruleKey, reason); setNote({ ok: true, m: note$('pos.turn_rule_retired') }); setRules(await api.rules()); } catch (e) { setNote({ ok: false, m: msg(e) }); } }, { minLength: 3, inputLabel: tx('pos.reason_2') });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 10, alignItems: 'start' }}>
      {askUi}
      <div style={card}>
        <div style={head}>{tx('pos.assignment_and_fairness')}{' '}<span style={muted}>{tx('pos.rules_v')}{info.effective.policyVersion}</span></div>
        {note ? <div role="status" style={{ marginBottom: 8, ...(note.ok ? okText : errText) }}>{renderMsg(note.m)}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.assignment_mode')}</span>
            <select aria-label={tx('pos.assignment_mode')} style={input} value={mode} disabled={!canManage} onChange={(e) => { setMode(e.target.value as TurnAssignmentMode); setPreview(null); }}>
              {info.vocabulary.assignmentModes.map((m) => <option key={m} value={m}>{modeText(m)}</option>)}
            </select></label>
          <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.fairness_mode')}</span>
            <select aria-label={tx('pos.fairness_mode')} style={input} value={fairness} disabled={!canManage} onChange={(e) => { setFairness(e.target.value); setPreview(null); }}>
              {info.vocabulary.fairnessModes.map((m) => <option key={m.value} value={m.value}>{pretty(m.value)}</option>)}
              {!info.vocabulary.fairnessModes.some((m) => m.value === fairness) ? <option value={fairness}>{pretty(fairness)} {tx('pos.legacy')}</option> : null}
            </select></label>
          {POLICY_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'grid', gap: 2 }}><span style={muted}>{f.label}</span>
              {f.number ? <input aria-label={f.label} type="number" min={f.number[0]} max={f.number[1]} style={input} disabled={!canManage} value={String(value(f.key) ?? '')} onChange={(e) => set(f.key, e.target.value, true)} />
                : <select aria-label={f.label} style={input} disabled={!canManage} value={String(value(f.key))} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options!.map((o) => <option key={o} value={o}>{o === 'true' ? tx('pos.yes') : o === 'false' ? tx('pos.no') : pretty(o)}</option>)}
                </select>}
            </label>
          ))}
        </div>
        {canManage ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select aria-label={tx('pos.apply_to')} style={input} value={scope} onChange={(e) => { setScope(e.target.value as 'branch' | 'salon'); setPreview(null); }}>
              <option value="branch">{tx('pos.this_location')}</option><option value="salon">{tx('pos.whole_salon')}</option>
            </select>
            <button style={btn} onClick={applyDefaults}>{tx('pos.use_the_recommended_nail_salon_default')}</button>
            <button style={btn} onClick={() => void doPreview()}>{tx('pos.preview_the_change')}</button>
            <button style={btnGold} disabled={!preview || preview.changes.length === 0} onClick={save}>{tx('pos.save_2')}</button>
          </div>
        ) : <div style={{ ...muted, marginTop: 8 }}>{tx('pos.only_the_owner_changes_the_salon_4dj9')}</div>}
        {preview ? (
          <div aria-label={tx('pos.change_preview')} style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            {preview.changes.length === 0 ? <div style={muted}>{tx('pos.nothing_would_change')}</div> : preview.changes.map((c) => (
              <div key={c.key} style={{ fontSize: 12.5, marginBottom: 4 }}><b>{POLICY_FIELDS.find((f) => f.key === c.key)?.label ?? pretty(c.key)}</b>: {optValue(c.current)} → {optValue(c.next)}. <span style={muted}>{c.outcome}</span></div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={card}>
        <div style={head}>{tx('pos.turn_weights')}{' '}<span style={muted}>{tx('pos.a_service_with_no_rule_counts')}{' '}{turns(rules?.defaultTurnUnits ?? 100)} {tx('pos.turn_2')}</span></div>
        {!rules ? <div style={muted}>{tx('pos.loading')}</div> : rules.rules.length === 0 ? <div style={muted}>{tx('pos.no_turn_rules_yet_every_service_peo2')}</div> : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>{tx('pos.for_2')}</th><th style={th}>{tx('pos.turns')}</th><th style={th}>v</th><th style={th}></th></tr></thead>
            <tbody>{rules.rules.map((r) => (
              <tr key={r.id}><td style={{ ...td, whiteSpace: 'normal' }}>{r.scope === 'service' ? r.serviceName ?? tx('pos.service_3') : r.scope === 'category' ? tx('pos.category_category', { category: String(r.category) }) : tx('pos.up_to_maxdurationminutes_min', { maxDurationMinutes: String(r.maxDurationMinutes) })}{r.specialRotation ? tx('pos.special_job_rotation_2') : ''}</td>
                <td style={td}>{r.turns}</td><td style={td}>{r.version}</td>
                <td style={td}>{canManage ? <button style={{ ...btn, height: 24, fontSize: 11 }} onClick={() => retire(r.ruleKey)}>{tx('pos.retire')}</button> : null}</td></tr>
            ))}</tbody>
          </table>
        )}
        {canManage ? (
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select aria-label={tx('pos.rule_applies_to')} style={input} value={rule.scope} onChange={(e) => setRule({ ...rule, scope: e.target.value as any, target: '' })}>
                <option value="category">{tx('pos.category')}</option><option value="service">{tx('pos.service_id')}</option><option value="duration">{tx('pos.duration_up_to_min')}</option>
              </select>
              <input aria-label={tx('pos.rule_target')} style={{ ...input, flex: 1 }} placeholder={rule.scope === 'category' ? tx('pos.e_g_pedicure') : rule.scope === 'service' ? tx('pos.service_id') : tx('ops.common.egMinutes')} value={rule.target} onChange={(e) => setRule({ ...rule, target: e.target.value })} />
              <input aria-label={tx('pos.turns')} style={{ ...input, width: 70 }} value={rule.turns} onChange={(e) => setRule({ ...rule, turns: e.target.value })} />
            </div>
            <label style={{ fontSize: 12.5, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={rule.special} onChange={(e) => setRule({ ...rule, special: e.target.checked })} /> {tx('pos.count_in_the_special_job_rotation_1cvv')}</label>
            <div><button style={btnGold} disabled={!rule.target.trim()} onClick={saveRule}>{tx('pos.add_turn_rule')}</button></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Simulate ─────────────────────────────────────────────────────────────────────────────────────────────────────
function SimulateTab() {
  const [rows, setRows] = useState<{ name: string; turns: string; readyMinutes: string; skillEligible: boolean; onBreak: boolean; appointmentInMinutes: string }[]>([
    { name: 'Lisa', turns: '2', readyMinutes: '20', skillEligible: true, onBreak: false, appointmentInMinutes: '' },
    { name: 'Mary', turns: '1.5', readyMinutes: '8', skillEligible: true, onBreak: false, appointmentInMinutes: '' },
  ]);
  const [mode, setMode] = useState<string>('lowest_turn_units');
  const [svc, setSvc] = useState(() => tx('ops.turn.sim.sampleService')); const [svcMin, setSvcMin] = useState('45');
  const [res, setRes] = useState<TurnSimulationResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      setRes(await api.simulate({ mode: mode as any, serviceLabel: svc, serviceMinutes: Number(svcMin) || 45,
        technicians: rows.filter((r) => r.name.trim()).map((r, i) => ({ name: r.name.trim(), turns: Number(r.turns) || 0, readyMinutes: Number(r.readyMinutes) || 0, skillEligible: r.skillEligible, onBreak: r.onBreak, position: i + 1,
          appointmentInMinutes: r.appointmentInMinutes === '' ? null : Number(r.appointmentInMinutes) })) }));
    } catch (e) { setErr(msg(e, 'ops.turn.err.simulate')); }
  };
  const upd = (i: number, k: string, v: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 10, alignItems: 'start' }}>
      <div style={card}>
        <div style={head}>{tx('pos.simulate_the_turn_rules')}{' '}<span style={muted}>{tx('pos.nothing_on_the_floor_changes')}</span></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <select aria-label={tx('pos.simulation_fairness_mode')} style={input} value={mode} onChange={(e) => setMode(e.target.value)}>
            {['traditional_weighted_rotation', 'lowest_turn_units', 'workload_balanced', 'hybrid_fairness', 'manual_order'].map((m) => <option key={m} value={m}>{pretty(m)}</option>)}
          </select>
          <input aria-label={tx('pos.service_3')} style={input} value={svc} onChange={(e) => setSvc(e.target.value)} />
          <input aria-label={tx('pos.service_minutes')} style={{ ...input, width: 70 }} value={svcMin} onChange={(e) => setSvcMin(e.target.value)} />
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{[tx('pos.technician_in_rotation_order'), tx('pos.turns_today'), tx('pos.ready_min'), tx('pos.can_do_it'), tx('pos.on_break'), tx('pos.appt_in_min'), ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td style={td}><input aria-label={tx('pos.technician_v0_name', { v0: String(i + 1) })} style={input} value={r.name} onChange={(e) => upd(i, 'name', e.target.value)} /></td>
              <td style={td}><input aria-label={tx('pos.technician_v0_turns', { v0: String(i + 1) })} style={{ ...input, width: 60 }} value={r.turns} onChange={(e) => upd(i, 'turns', e.target.value)} /></td>
              <td style={td}><input aria-label={tx('pos.technician_v0_ready_minutes', { v0: String(i + 1) })} style={{ ...input, width: 60 }} value={r.readyMinutes} onChange={(e) => upd(i, 'readyMinutes', e.target.value)} /></td>
              <td style={td}><input type="checkbox" aria-label={tx('pos.technician_v0_eligible', { v0: String(i + 1) })} checked={r.skillEligible} onChange={(e) => upd(i, 'skillEligible', e.target.checked)} /></td>
              <td style={td}><input type="checkbox" aria-label={tx('pos.technician_v0_on_break', { v0: String(i + 1) })} checked={r.onBreak} onChange={(e) => upd(i, 'onBreak', e.target.checked)} /></td>
              <td style={td}><input aria-label={tx('pos.technician_v0_appointment_minutes', { v0: String(i + 1) })} style={{ ...input, width: 60 }} value={r.appointmentInMinutes} onChange={(e) => upd(i, 'appointmentInMinutes', e.target.value)} /></td>
              <td style={td}><button style={{ ...btn, height: 24 }} aria-label={tx('pos.remove_technician_v0', { v0: String(i + 1) })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}</tbody>
        </table>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button style={btn} onClick={() => setRows([...rows, { name: '', turns: '0', readyMinutes: '0', skillEligible: true, onBreak: false, appointmentInMinutes: '' }])}>{tx('pos.add_technician')}</button>
          <button style={btnGold} onClick={() => void run()}>{tx('pos.run_simulation')}</button>
        </div>
      </div>
      <div style={card} aria-live="polite">
        <div style={head}>{tx('pos.result')}</div>
        {err ? <div role="alert" style={errText}>{err}</div> : !res ? <div style={muted}>{tx('pos.run_a_simulation_to_see_who_1aq9')}</div> : (
          <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
            <div><b>{tx('pos.recommended')}{' '}{res.recommended ?? tx('pos.nobody_eligible')}</b></div>
            {res.why.map((w, i) => <div key={i}>{codedText(res.whyCoded?.[i], w)}</div>)}
            {res.skipped.length ? <div style={{ marginTop: 6 }}><b>{tx('pos.skipped_3')}</b>{res.skipped.map((s, i) => <div key={i} style={muted}>{codedText(s.textCoded, s.text)}</div>)}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
