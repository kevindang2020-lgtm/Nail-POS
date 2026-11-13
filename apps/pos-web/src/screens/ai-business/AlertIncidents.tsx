// AlertIncidents.tsx — A2 AI Business Alerts (Nov 6 2026): the Incidents panel, the incident dialog (investigate / assign /
// snooze / resolve / reopen / notes, the log and the delivery log) and the per-rule Notifications dialog (severity, channels,
// recipients, quiet hours, cooldown). Server: business-alert-incidents.ts.
import { useCallback, useEffect, useState } from 'react';
import { Pager, Empty, ErrorRetry, FitDialog } from '../../components/FitKit';
import { bt, bzErr, bzWhen, bzNum } from '../../components/BusinessKit';
import { fmtMoney } from '../../i18n/format';
import { posAiBusinessApi } from '../../api/posAiBusinessApi';
import { markAlertsReadEverywhere } from '../../shell/alertReads';

const STATUSES = ['active', 'open', 'investigating', 'snoozed', 'resolved', 'all'] as const;
const SNOOZE = [30, 60, 120, 240, 480, 1440];
const WHY = ['cooldown', 'quiet_hours', 'no_email', 'no_phone', 'no_recipients', 'messaging_not_available'];
const chipTone = (s: string) => (s === 'open' ? 'err' : s === 'investigating' ? 'warn' : s === 'resolved' ? 'ok' : '');

export function IncidentsPanel({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [f, setF] = useState<{ status: string; page: number }>({ status: 'active', page: 1 });
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posAiBusinessApi.center.incidents({ status: f.status, page: f.page, limit: 25 }).then(setList).catch((e) => setErr(bzErr(e))); }, [f]);
  useEffect(() => { load(); }, [load, tick]);
  // extras AI BUSINESS ALERTS 05: opening an incident marks ITS in-app alerts read for me only (my badge clears on all my
  // tabs and devices); it does not acknowledge the incident — Acknowledge / Investigate stay separate actions in the dialog
  const openIncident = (i: { eventId: string; readState?: { unread: boolean; unreadAlertIds: string[] } | null }) => {
    setOpen(i.eventId);
    const ids = i.readState?.unread ? i.readState.unreadAlertIds : [];
    if (ids.length) markAlertsReadEverywhere(ids).then(() => load(), () => undefined);
  };
  const c = list?.counts ?? {};
  return (
    <section className="panel" data-testid="bzx-incidents">
      <div className="p-h">{bt('bzx.i.title')}</div>
      <div className="rvw-filters">
        <select data-testid="bzx-i-status" aria-label={bt('bzx.i.status')} value={f.status} onChange={(e) => setF({ status: e.target.value, page: 1 })}>
          {STATUSES.map((s) => <option key={s} value={s}>{bt('bzx.i.st.' + s)}{s !== 'all' && s !== 'active' && c[s] != null ? ` (${bzNum(c[s])})` : ''}</option>)}
        </select>
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{bt('bzx.loading')}</div> : list.items.length === 0 ? <Empty title={bt('bzx.i.none')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{bt('bzx.i.col.alert')}</th><th>{bt('bzx.i.col.value')}</th><th>{bt('bzx.i.col.status')}</th><th>{bt('bzx.i.col.assignee')}</th><th>{bt('bzx.i.col.when')}</th><th />
        </tr></thead><tbody>
          {list.items.map((i: any) => (
            <tr key={i.eventId} data-testid="bzx-i-row">
              <td><b>{i.title}</b>{i.readState?.unread ? <span className="chip err" data-testid="bzx-i-unread">{bt('bzx.i.unread')}</span> : null}<div className="sub">{bt('bzx.i.sev.' + i.severity)}</div></td>
              <td>{bt('bzx.a.valueVs', { v: i.display.value, t: i.display.threshold })}</td>
              <td><span className={'chip ' + chipTone(i.incidentStatus)}>{bt('bzx.i.st.' + i.incidentStatus)}</span>{i.snoozedUntil ? <div className="sub">{bt('bzx.i.until', { t: bzWhen(i.snoozedUntil) })}</div> : null}</td>
              <td>{i.assignee ?? '—'}</td>
              <td>{bzWhen(i.evaluatedAt)}</td>
              <td><button type="button" className="btn ghost" data-testid="bzx-i-open" onClick={() => openIncident(i)}>{bt('bzx.i.open')}</button></td>
            </tr>))}
        </tbody></table></div>)}
      {list ? <Pager info={{ page: list.page, pageSize: list.limit, totalItems: list.total, totalPages: Math.max(1, Math.ceil(list.total / list.limit)) }} onPage={(p) => setF({ ...f, page: p })} /> : null}
      {open ? <IncidentDialog eventId={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged(); }} /> : null}
    </section>
  );
}

export function IncidentDialog({ eventId, onClose, onChanged }: { eventId: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [snooze, setSnooze] = useState(60);
  const [assignee, setAssignee] = useState('');
  const load = useCallback(() => {
    posAiBusinessApi.center.incident(eventId).then((x) => {
      setD(x); setAssignee(x.assignee?.userId ?? '');
      posAiBusinessApi.center.alertDelivery(x.alertId).then((dv) => setStaff(dv.staff ?? [])).catch(() => setStaff([]));
    }).catch((e) => setErr(bzErr(e)));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  const act = (action: string, extra: Record<string, unknown> = {}) => {
    if (!d) return;
    setBusy(true); setErr(null);
    posAiBusinessApi.center.incidentAction(eventId, { action, expectedVersion: d.version, note: note.trim() || null, ...extra })
      .then(() => { setNote(''); load(); onChanged(); }).catch((e) => { setErr(bzErr(e)); load(); }).finally(() => setBusy(false));
  };
  const addNote = () => { if (!note.trim()) return; setBusy(true); posAiBusinessApi.center.incidentNote(eventId, note.trim()).then(() => { setNote(''); load(); }).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false)); };
  const st = d?.incidentStatus;
  return (
    <FitDialog testId="bzx-incident" wide title={d ? d.title : bt('bzx.loading')} subtitle={d ? <span className={'chip ' + chipTone(st)}>{bt('bzx.i.st.' + st)}</span> : undefined} onClose={onClose} busy={busy}
      footer={<button className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button>}>
      {err ? <div className="err" role="alert" data-testid="bzx-i-err">{err}</div> : null}
      {!d ? <div className="state">{bt('bzx.loading')}</div> : (<>
        <p className="sub">{bt('bzx.a.valueVs', { v: d.display.value, t: d.display.threshold })} · {bt('bzx.i.sev.' + d.severity)} · {bzWhen(d.evaluatedAt)}</p>
        {d.resolutionNote ? <p data-testid="bzx-i-resolution"><b>{bt('bzx.i.resolved')}</b> {d.resolutionNote} — {d.resolvedBy ?? '—'}, {bzWhen(d.resolvedAt)}</p> : null}
        <label className="rvw-f"><span>{bt('bzx.i.note')}</span><textarea data-testid="bzx-i-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="rvw-actions">
          {st === 'open' || st === 'snoozed' ? <button type="button" className="btn" data-testid="bzx-i-investigate" disabled={busy} onClick={() => act('investigate')}>{bt('bzx.i.investigate')}</button> : null}
          {st !== 'resolved' ? <button type="button" className="btn" data-testid="bzx-i-resolve" disabled={busy || note.trim().length < 3} onClick={() => act('resolve')}>{bt('bzx.i.resolve')}</button> : null}
          {st === 'resolved' || st === 'snoozed' ? <button type="button" className="btn ghost" data-testid="bzx-i-reopen" disabled={busy} onClick={() => act('reopen')}>{bt('bzx.i.reopen')}</button> : null}
          <button type="button" className="btn ghost" data-testid="bzx-i-addnote" disabled={busy || !note.trim()} onClick={addNote}>{bt('bzx.i.addNote')}</button>
        </div>
        {st !== 'resolved' ? <div className="rvw-filters">
          <label className="rvw-f"><span>{bt('bzx.i.snoozeFor')}</span><select data-testid="bzx-i-snooze-min" value={snooze} onChange={(e) => setSnooze(Number(e.target.value))}>{SNOOZE.map((m) => <option key={m} value={m}>{m >= 60 ? bt('bzx.i.hours', { n: m / 60 }) : bt('bzx.i.minutes', { n: m })}</option>)}</select></label>
          <button type="button" className="btn ghost" data-testid="bzx-i-snooze" disabled={busy} onClick={() => act('snooze', { snoozeMinutes: snooze })}>{bt('bzx.i.snooze')}</button>
          <label className="rvw-f"><span>{bt('bzx.i.assignTo')}</span><select data-testid="bzx-i-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{bt('bzx.i.nobody')}</option>{staff.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}</select></label>
          <button type="button" className="btn ghost" data-testid="bzx-i-assign" disabled={busy || assignee === (d.assignee?.userId ?? '')} onClick={() => act('assign', { assigneeUserId: assignee || null })}>{bt('bzx.i.assign')}</button>
        </div> : null}
        <div className="p-h">{bt('bzx.i.log')}</div>
        <ul className="rvw-list" data-testid="bzx-i-log">{d.log.map((l: any, k: number) => <li key={k}><b>{l.by ?? '—'}</b> · {bzWhen(l.at)} — {l.body}</li>)}</ul>
        <div className="p-h">{bt('bzx.i.deliveries')}</div>
        {d.deliveries.length === 0 ? <div className="sub">{bt('bzx.i.noDeliveries')}</div> : (
          <table className="tbl" data-testid="bzx-i-deliveries"><thead><tr><th>{bt('bzx.i.col.channel')}</th><th>{bt('bzx.i.col.to')}</th><th>{bt('bzx.i.col.result')}</th><th>{bt('bzx.i.col.when')}</th></tr></thead>
            <tbody>{d.deliveries.map((x: any, k: number) => <tr key={k}><td>{bt('bzx.i.ch.' + x.channel)}{x.kind === 'escalation' ? ` · ${bt('bzx.i.escalation')}` : ''}</td><td>{x.to ?? '—'}</td>
              <td><span className={'chip ' + (x.status === 'sent' ? 'ok' : x.status === 'failed' ? 'err' : '')}>{bt('bzx.i.ds.' + x.status)}</span>{x.reason ? <div className="sub">{WHY.includes(x.reason) ? bt('bzx.i.why.' + x.reason) : x.reason}</div> : null}</td>
              <td>{bzWhen(x.at)}</td></tr>)}</tbody></table>)}
      </>)}
    </FitDialog>
  );
}

/** extras AI Business Alerts 08 — the server's SMS plan for the SAVED settings (recipients, segments, the salon's own cost,
 *  sender, limits, loop guards); rendered as is, nothing computed here; read-only */
function SmsPlan({ p, dirty }: { p: any; dirty: boolean }) {
  const cd = Number(p.loopGuards?.cooldownMinutes ?? 0);
  const cooldown = cd === 0 ? bt('bzx.d.noCooldown') : cd >= 60 ? bt('bzx.i.hours', { n: cd / 60 }) : bt('bzx.i.minutes', { n: cd });
  const lim = p.limits;
  return (
    <div className="panel" data-testid="bzx-sms-plan" style={{ padding: 10 }}>
      <b>{bt('bzx.sp.title')}</b>
      {dirty ? <div className="sub" data-testid="bzx-sp-dirty">{bt('bzx.sp.dirty')}</div> : null}
      <div data-testid="bzx-sp-recipients">{bt('bzx.sp.recipients', { n: p.recipientsWithPhone, total: p.recipients })}</div>
      <div data-testid="bzx-sp-segments">{bt('bzx.sp.segments', { seg: p.segmentsPerMessage, total: p.segmentsPerTrigger })}</div>
      <div data-testid="bzx-sp-cost">{p.estimatedCostCentsPerTrigger == null ? bt('bzx.sp.costUnknown') : bt('bzx.sp.cost', { cost: fmtMoney(p.estimatedCostCentsPerTrigger) })}</div>
      <div data-testid="bzx-sp-sender">{!p.senderConfigured ? bt('bzx.sp.senderMissing') : p.senderValidatedAt ? bt('bzx.sp.sender', { at: bzWhen(p.senderValidatedAt) }) : bt('bzx.sp.senderNoCheck')}</div>
      <div data-testid="bzx-sp-limits">{!lim ? bt('bzx.sp.noLimits') : bt('bzx.sp.limits', { daily: lim.dailyLimit == null ? bt('bzx.sp.unlimited') : bzNum(lim.dailyLimit), monthly: lim.monthlySms == null ? bt('bzx.sp.unlimited') : bzNum(lim.monthlySms), mode: bt('bzx.sp.mode.' + lim.enforcement) })}</div>
      <div data-testid="bzx-sp-guards">{bt('bzx.sp.guards', { cooldown, esc: p.loopGuards?.escalateOnceAfterMinutes ?? 30, quiet: bt(p.loopGuards?.quietHours ? 'bzx.sp.quietOn' : 'bzx.sp.quietOff') })}</div>
      <div className="sub" data-testid="bzx-sp-sent">{bt('bzx.sp.sent', { rule: p.loopGuards?.sentByRuleLast24h ?? 0, salon: p.loopGuards?.alertSmsSentLast24h ?? 0 })}</div>
      {(p.warnings ?? []).map((w: string) => <div key={w} className="err" role="status" data-testid={'bzx-sp-w-' + w}>{bt('bzx.sp.w.' + w)}</div>)}
    </div>
  );
}

export function DeliveryDialog({ alert, onClose, onSaved }: { alert: { id: string; title: string }; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<any>(null);
  const [saved, setSaved] = useState<any>(null);   // the settings as loaded — the SMS plan describes these
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { posAiBusinessApi.center.alertDelivery(alert.id).then((x) => { setD(x); setSaved(x); }).catch((e) => setErr(bzErr(e))); }, [alert.id]);
  const sig = (x: any) => (x ? JSON.stringify([[...x.channels].sort(), [...x.recipientUserIds].sort(), Number(x.cooldownMinutes), Number(x.quietHoursStart), Number(x.quietHoursEnd)]) : '');
  const set = (p: Record<string, unknown>) => setD({ ...d, ...p });
  const toggle = (key: 'channels' | 'recipientUserIds', v: string) => set({ [key]: d[key].includes(v) ? d[key].filter((x: string) => x !== v) : [...d[key], v] });
  const save = () => {
    if (!d.channels.length) { setErr(bt('bzx.d.needChannel')); return; }
    setBusy(true); setErr(null);
    posAiBusinessApi.center.alertSetDelivery(alert.id, { severity: d.severity, channels: d.channels, recipientUserIds: d.recipientUserIds, quietHoursStart: Number(d.quietHoursStart), quietHoursEnd: Number(d.quietHoursEnd), cooldownMinutes: Number(d.cooldownMinutes) })
      .then(onSaved).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false));
  };
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <FitDialog testId="bzx-delivery" title={bt('bzx.d.title', { t: alert.title })} onClose={onClose} busy={busy}
      footer={<><button className="btn" data-testid="bzx-d-save" disabled={busy || !d} onClick={save}>{bt('bzx.a.save')}</button><button className="btn ghost" onClick={onClose}>{bt('bzx.cancel')}</button></>}>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {!d ? (err ? null : <div className="state">{bt('bzx.loading')}</div>) : (<>
        <div className="rvw-filters">
          <label className="rvw-f"><span>{bt('bzx.d.severity')}</span><select data-testid="bzx-d-severity" value={d.severity} onChange={(e) => set({ severity: e.target.value })}>{['info', 'warning', 'critical'].map((s) => <option key={s} value={s}>{bt('bzx.i.sev.' + s)}</option>)}</select></label>
          <label className="rvw-f"><span>{bt('bzx.d.quietFrom')}</span><select data-testid="bzx-d-qs" value={d.quietHoursStart} onChange={(e) => set({ quietHoursStart: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}</select></label>
          <label className="rvw-f"><span>{bt('bzx.d.quietTo')}</span><select data-testid="bzx-d-qe" value={d.quietHoursEnd} onChange={(e) => set({ quietHoursEnd: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}</select></label>
          <label className="rvw-f"><span>{bt('bzx.d.cooldown')}</span><select data-testid="bzx-d-cooldown" value={d.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })}>{[0, 15, 30, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m === 0 ? bt('bzx.d.noCooldown') : m >= 60 ? bt('bzx.i.hours', { n: m / 60 }) : bt('bzx.i.minutes', { n: m })}</option>)}</select></label>
        </div>
        <fieldset className="rvw-f"><legend>{bt('bzx.d.channels')}</legend>
          {['in_app', 'email', 'sms'].map((c) => <label key={c} className="chk"><input type="checkbox" data-testid={'bzx-d-ch-' + c} checked={d.channels.includes(c)} onChange={() => toggle('channels', c)} /> {bt('bzx.i.ch.' + c)}</label>)}
        </fieldset>
        <fieldset className="rvw-f"><legend>{bt('bzx.d.recipients')}</legend>
          <div className="sub">{bt('bzx.d.recipientsHint')}</div>
          {d.staff.map((s: any) => <label key={s.userId} className="chk"><input type="checkbox" data-testid="bzx-d-rcpt" checked={d.recipientUserIds.includes(s.userId)} onChange={() => toggle('recipientUserIds', s.userId)} /> {s.name}
            {!s.hasEmail || !s.hasPhone ? <span className="sub"> · {!s.hasEmail ? bt('bzx.d.noEmail') : bt('bzx.d.noPhone')}</span> : null}</label>)}
        </fieldset>
        {saved?.smsPlan && (d.channels.includes('sms') || saved.channels.includes('sms')) ? <SmsPlan p={saved.smsPlan} dirty={sig(d) !== sig(saved)} /> : null}
        <p className="sub">{bt('bzx.d.note')}</p>
      </>)}
    </FitDialog>
  );
}
