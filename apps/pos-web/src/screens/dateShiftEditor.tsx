// dateShiftEditor.tsx — F4 (Finish the Five, 30 Oct 2026): Edit Shift for Selected Date on the Live Technician Schedule.
// A large overlay (Close / Esc, Cancel, Save) with a month calendar (month / year header, previous / next, weekday grid,
// selected date, Today, Apply / Cancel) that names the ONE effective date being edited. Create Shift · Change Start / End
// · Mark Off · Add / Edit / Delete Lunch or Break · Restore Recurring Shift · View Conflicts · Save. The recurring weekly
// baseline, the saved date shift and the proposed day are shown side by side; the weekly template is never changed.
// Conflicts come from the server before saving (bookings, breaks, time off, the active queue, another branch); a booking
// is never cancelled, shortened or moved — the manager acknowledges, adjusts, or goes to rescheduling. A stale version
// (another manager saved first) keeps what was typed and offers Reload. Nothing claims success before the server confirms.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posShiftOverrideApi } from '../api/posTeamScreensApi';
import { FitDialog, Empty } from '../components/FitKit';
import { MonthView, useLoad, StateBlock, fmtYmdSafe } from '../components/FinanceKit';
import { whenTime } from './technicianScreenParts';
import { hm12, apptStatus } from './teamShared';

type Mode = 'CUSTOM_SHIFT' | 'DAY_OFF' | 'RESTORE_BASELINE';
interface Brk { type: string; startLocalTime: string; endLocalTime: string }
const ymdParts = (d: string) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1 });
const dayText = (s: any) => {
  if (!s) return tx('so.followsStore');
  if (s.isWorking === false) return tx('so.off');
  const shifts = s.shifts?.length ? s.shifts : s.startTime && s.endTime ? [{ startTime: s.startTime, endTime: s.endTime }] : [];
  const brks = s.breaks?.length ? s.breaks : s.lunchStartTime && s.lunchEndTime ? [{ startTime: s.lunchStartTime, endTime: s.lunchEndTime, type: 'lunch' }] : [];
  return [shifts.map((x: any) => `${hm12(x.startTime)} – ${x.endTime === '24:00' ? tx('so.midnight') : hm12(x.endTime)}`).join(', ') || '—',
    ...brks.map((b: any) => `${tx('so.b.' + (b.type ?? 'unpaid'))} ${hm12(b.startTime)} – ${hm12(b.endTime)}`)].join(' · ');
};

export function DateShiftEditor({ technicianId, technicianName, initialDate, today, canEdit, onClose, onSaved }: {
  technicianId: string; technicianName: string; initialDate: string; today: string; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const [pick, setPick] = useState<string | null>(null);   // a calendar choice waiting for Apply
  const [tick, setTick] = useState(0);
  const ed = useLoad(() => posShiftOverrideApi.editor(technicianId, date), [technicianId, date, tick]);
  const x: any = ed.data;
  const [mode, setMode] = useState<Mode>('CUSTOM_SHIFT'); const [start, setStart] = useState('09:00'); const [end, setEnd] = useState('17:00'); const [overnight, setOvernight] = useState(false);
  const [breaks, setBreaks] = useState<Brk[]>([]); const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<any | null>(null); const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; reload?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  // load the form from the saved override (or the weekly baseline) when the date changes — never over unsaved typing
  useEffect(() => {
    if (!x || dirty) return;
    const o = x.override; const b = x.baseline;
    if (o) { setMode(o.overrideType); setStart(o.startLocalTime ?? '09:00'); setEnd(o.endLocalTime ?? '17:00'); setOvernight(!!o.endsNextDay); setBreaks(o.breaks ?? []); setReason(o.note ?? ''); }
    else { setMode(b?.isWorking === false ? 'DAY_OFF' : 'CUSTOM_SHIFT'); setStart(b?.startTime ?? '09:00'); setEnd(b?.endTime ?? '17:00'); setOvernight(false);
      setBreaks(b?.lunchStartTime && b?.lunchEndTime ? [{ type: 'lunch', startLocalTime: b.lunchStartTime, endLocalTime: b.lunchEndTime }] : []); setReason(''); }
  }, [x, dirty]);
  const touch = () => { setDirty(true); setPreview(null); setAck(false); setMsg(null); };
  const body = () => ({ technicianId, localDate: date, overrideType: mode, ...(mode === 'CUSTOM_SHIFT' ? { startLocalTime: start, endLocalTime: end, endsNextDay: overnight, breaks } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}), ...(x?.override ? { expectedVersion: x.override.version } : {}) });
  const localInvalid = mode === 'CUSTOM_SHIFT' && (!start || !end || (!overnight && end <= start) || (overnight && end > start) || breaks.some((b) => !b.startLocalTime || !b.endLocalTime || b.endLocalTime <= b.startLocalTime));
  const check = async () => {
    setBusy(true); setMsg(null);
    try { setPreview(await posShiftOverrideApi.preview(body())); }
    catch (e: any) { setMsg({ tone: 'bad', text: e?.message || tx('pos.action_failed') }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await posShiftOverrideApi.save({ ...body(), acknowledgeConflicts: ack });
      setMsg({ tone: 'ok', text: tx(mode === 'RESTORE_BASELINE' ? 'so.restored' : 'so.saved', { d: fmtYmdSafe(date) }) }); setDirty(false); setPreview(null); setAck(false); setTick((n) => n + 1); onSaved();
    } catch (e: any) {
      if (e?.status === 409 && e?.code === 'VERSION_CONFLICT') setMsg({ tone: 'warn', text: tx('so.race'), reload: true });
      else if (e?.status === 409 && e?.body?.conflicts) { setPreview({ conflicts: e.body.conflicts, blocking: true, canAcknowledge: e.body.canAcknowledge }); setMsg({ tone: 'warn', text: e?.message || tx('so.conflictsFirst') }); }
      else setMsg({ tone: 'bad', text: e?.message || tx('pos.action_failed') });   // the typed edit stays on screen
    } finally { setBusy(false); }
  };
  const blocking = !!preview?.conflicts?.some((c: any) => c.blocking);
  const canSave = canEdit && !!x?.canEdit && !busy && !localInvalid && !!preview && (!blocking || (ack && preview.canAcknowledge !== false)) && !(mode === 'RESTORE_BASELINE' && !x?.override);
  const setBreak = (i: number, p: Partial<Brk>) => { setBreaks((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b))); touch(); };
  return (
    <FitDialog wide title={tx('so.title', { n: technicianName })} busy={busy} onClose={onClose} testId="date-shift-editor"
      subtitle={<span data-testid="so-date"><b>{tx('so.only', { d: fmtYmdSafe(date) })}</b>{x?.tz ? ` · ${x.tz}` : ''}</span>}
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy} data-testid="so-cancel">{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn" onClick={check} disabled={busy || localInvalid || !canEdit || !x?.canEdit} data-testid="so-check">{tx('so.viewConflicts')}</button>
        <button type="button" className="fk-btn primary" onClick={save} disabled={!canSave} aria-busy={busy} data-testid="so-save">{busy ? tx('cr.saving') : tx('so.save')}</button></>}>
      <div className="so-grid">
        <div className="so-cal">
          <MonthView value={ymdParts(pick ?? date)} range={{ from: pick ?? date, to: pick ?? date }} today={today} onPick={(d) => setPick(d)} label={tx('so.calendar')} testId="so-calendar" />
          <div className="so-cal-foot">
            <button type="button" className="fk-btn ghost sm" onClick={() => setPick(today)} data-testid="so-today">{tx('so.today')}</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="fk-btn ghost sm" onClick={() => setPick(null)} disabled={!pick} data-testid="so-cal-cancel">{tx('pos.cancel')}</button>
            <button type="button" className="fk-btn sm" disabled={!pick || pick < today || pick === date} onClick={() => { if (pick) { setDate(pick); setPick(null); setDirty(false); setPreview(null); setMsg(null); } }} data-testid="so-apply">{tx('finance.cal.apply')}</button>
          </div>
          {pick && pick < today ? <p className="fk-hint">{tx('so.pastDate')}</p> : null}
          {x?.month?.overrides?.length ? <p className="fk-hint" data-testid="so-month">{tx('so.monthList')} {x.month.overrides.map((o: any) => `${o.date.slice(8)} (${tx('so.t.' + o.type)})`).join(', ')}</p> : null}
        </div>
        <div className="so-main">
          {ed.error ? <StateBlock error={ed.error} onRetry={ed.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
            <div className="so-compare" data-testid="so-compare">
              <div><span className="fk-muted">{tx('so.baseline')}</span><b data-testid="so-baseline">{dayText(x.baseline)}</b><span className="fk-li-s">{tx('so.baselineRule')}</span></div>
              <div><span className="fk-muted">{tx('so.effective')}</span><b data-testid="so-effective">{dayText(x.effective)}</b><span className="fk-li-s">{x.override ? tx('so.hasOverride', { v: String(x.override.version) }) : tx('so.noOverride')}</span></div>
              <div><span className="fk-muted">{tx('so.proposed')}</span><b data-testid="so-proposed">{preview?.effective !== undefined ? dayText(preview.effective) : tx('so.checkToSee')}</b></div>
            </div>
            {x.previousNightCarry ? <p className="fk-hint">{tx('so.carry', { t: hm12(x.previousNightCarry.endLocalTime) })}</p> : null}
            {!x.canEdit ? <p className="fk-hint">{x.past ? tx('so.pastDate') : tx('ls.noEdit')}</p> : null}
            <div className="fk-seg" role="radiogroup" aria-label={tx('so.action')}>
              {(['CUSTOM_SHIFT', 'DAY_OFF', 'RESTORE_BASELINE'] as Mode[]).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} disabled={!x.canEdit || (m === 'RESTORE_BASELINE' && !x.override)}
                onClick={() => { setMode(m); touch(); }} data-testid={'so-mode-' + m}>{tx(m === 'CUSTOM_SHIFT' ? (x.override || x.baseline ? 'so.m.change' : 'so.m.create') : 'so.m.' + m)}</button>)}
            </div>
            {mode === 'CUSTOM_SHIFT' ? <>
              <div className="cg-form four">
                <label className="fk-field">{tx('tm.start')}<input type="time" step={900} value={start} disabled={!x.canEdit} onChange={(e) => { setStart(e.target.value); touch(); }} data-testid="so-start" /></label>
                <label className="fk-field">{tx('ls.end')}<input type="time" step={900} value={end} disabled={!x.canEdit} onChange={(e) => { setEnd(e.target.value); touch(); }} data-testid="so-end" /></label>
                <label className="ls-ack so-overnight"><input type="checkbox" checked={overnight} disabled={!x.canEdit} onChange={(e) => { setOvernight(e.target.checked); touch(); }} data-testid="so-overnight" /> {tx('so.overnight')}</label>
              </div>
              <h3 className="fk-h3">{tx('so.breaks')}</h3>
              {breaks.length === 0 ? <p className="fk-hint">{tx('so.noBreaks')}</p> : breaks.map((b, i) => <div key={i} className="cg-form four so-break" data-testid="so-break">
                <label className="fk-field">{tx('so.breakType')}<select value={b.type} disabled={!x.canEdit} onChange={(e) => setBreak(i, { type: e.target.value })}>{['lunch', 'paid', 'unpaid'].map((t) => <option key={t} value={t}>{tx('so.b.' + t)}</option>)}</select></label>
                <label className="fk-field">{tx('tm.start')}<input type="time" step={300} value={b.startLocalTime} disabled={!x.canEdit} onChange={(e) => setBreak(i, { startLocalTime: e.target.value })} data-testid="so-break-start" /></label>
                <label className="fk-field">{tx('ls.end')}<input type="time" step={300} value={b.endLocalTime} disabled={!x.canEdit} onChange={(e) => setBreak(i, { endLocalTime: e.target.value })} data-testid="so-break-end" /></label>
                <button type="button" className="fk-btn ghost sm" disabled={!x.canEdit} onClick={() => { setBreaks((bs) => bs.filter((_, j) => j !== i)); touch(); }} data-testid="so-break-delete">{tx('so.deleteBreak')}</button>
              </div>)}
              {x.canEdit && breaks.length < 6 ? <button type="button" className="fk-btn ghost sm" onClick={() => { setBreaks((bs) => [...bs, { type: 'lunch', startLocalTime: '13:00', endLocalTime: '13:30' }]); touch(); }} data-testid="so-add-break">{tx('so.addBreak')}</button> : null}
              {localInvalid ? <div className="fk-note bad" role="alert"><span>{tx('so.invalid')}</span></div> : null}
            </> : mode === 'DAY_OFF' ? <p className="fk-hint">{tx('so.offRule')}</p> : <p className="fk-hint">{tx('so.restoreRule')}</p>}
            <label className="fk-field">{tx('so.reason')}<input value={reason} maxLength={500} disabled={!x.canEdit} onChange={(e) => { setReason(e.target.value); setDirty(true); }} data-testid="so-reason" /></label>
            {msg ? <div className={'fk-note ' + msg.tone} role="status" data-testid="so-msg"><span>{msg.text}</span>{msg.reload ? <button type="button" className="fk-btn sm" onClick={() => { setDirty(false); setMsg(null); setPreview(null); setTick((n) => n + 1); }} data-testid="so-reload">{tx('so.reload')}</button> : null}</div> : null}
            {preview ? (preview.conflicts.length === 0 ? <div className="fk-note ok" data-testid="so-no-conflicts"><span>{tx('so.noConflicts')}</span></div>
              : <div className="fk-note warn" data-testid="so-conflicts"><span><b>{tx('so.conflictsN', { n: String(preview.conflicts.length) })}</b>
                <ul className="tm-reasons">{preview.conflicts.map((c: any, i: number) => <li key={i} data-testid="so-conflict">{tx('so.c.' + c.kind)}: {c.detail}{c.appointmentId ? <span className="fk-li-s">{tx('so.booking', { id: c.appointmentId.slice(0, 8) })}</span> : null}</li>)}</ul>
                <Link to="/tech-appointments" className="fk-link" data-testid="so-reschedule">{tx('so.reschedule')}</Link>
                {blocking && preview.canAcknowledge !== false ? <label className="ls-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="so-ack" /> {tx('so.ack')}</label>
                  : blocking ? <p>{tx('so.cannotAck')}</p> : null}</span></div>) : null}
            <h3 className="fk-h3">{tx('so.dayHolds')}</h3>
            {x.appointments.length === 0 ? <p className="fk-hint">{tx('so.noBookings')}</p> : <ul className="fk-list dense" data-testid="so-bookings">{x.appointments.map((a: any) => <li key={a.id} className="fk-li"><span className="fk-li-t">{a.date !== date ? `${a.date.slice(5)} ` : ''}{hm12(a.startTime)} – {hm12(a.endTime)} · {a.customer ?? '—'}<span className="fk-li-s">{apptStatus(a.status)}</span></span></li>)}</ul>}
            {x.timeOff.length ? <p className="fk-hint">{tx('so.timeOff', { n: String(x.timeOff.length) })}</p> : null}
            {x.activeQueue.length ? <p className="fk-hint">{tx('so.activeQueue', { n: String(x.activeQueue.length) })}</p> : null}
            {x.history.length ? <><h3 className="fk-h3">{tx('so.history')}</h3><ul className="fk-list dense" data-testid="so-history">{x.history.map((h: any) => <li key={h.id} className="fk-li"><span className="fk-li-t">{tx('so.h.' + h.action)}{h.reason ? ` — ${h.reason}` : ''}<span className="fk-li-s">{whenTime(h.at)} · {h.actor ?? '—'}</span></span></li>)}</ul></> : <Empty title={tx('so.noHistory')} />}
          </>}
        </div>
      </div>
      <p className="fk-hint">{tx('so.rule')}</p>
    </FitDialog>
  );
}
