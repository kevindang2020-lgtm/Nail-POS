// AccountKit.tsx — Account Overview pieces added by the Nov 9 2026 SUNMI guides (Account, Notification Preferences,
// Recent Account Activity). Everything here reads/writes an EXISTING source — no second store:
//   • notification switches → pos/me/notification-prefs (user_notification_prefs), saved only when the server confirms
//   • recent activity → GET /pos/audit/events (the canonical tenant audit), newest first, server-paged
import { useCallback, useEffect, useState } from 'react';
import type { MessagingReadiness, NotificationSwitch } from '@aipowersalon/api-contracts/tenant';
import { NOTIFICATION_SWITCH_EFFECT } from '@aipowersalon/api-contracts/tenant';   // extras round 11: which switches a real send path obeys today
import { posMePrefsApi, type NotificationPrefs, type NotificationDeliveryPage, type DeliveryQuery } from '../api/posMePrefsApi';
import { posAuditApi, type AuditPage, type AuditEventRow } from '../api/posAuditApi';
import { FitDialog, Pager, ErrorRetry, Empty } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');

/** the eight switches, in the screenshot's order — label/description keys are the existing account ones */
export const NOTIF_ITEMS: { key: NotificationSwitch; label: () => string; desc: () => string; channel?: 'sms' | 'email' | 'push' }[] = [
  { key: 'smsNotifications', label: () => tx('admin.account.notif.sms'), desc: () => tx('admin.account.notif.smsDesc'), channel: 'sms' },
  { key: 'emailNotifications', label: () => tx('admin.account.notif.email'), desc: () => tx('admin.account.notif.emailDesc'), channel: 'email' },
  { key: 'pushNotifications', label: () => tx('admin.account.notif.push'), desc: () => tx('admin.account.notif.pushDesc'), channel: 'push' },
  { key: 'missedCallAlerts', label: () => tx('admin.account.notif.missedCall'), desc: () => tx('admin.account.notif.missedCallDesc') },
  { key: 'bookingAlerts', label: () => tx('admin.account.notif.booking'), desc: () => tx('admin.account.notif.bookingDesc') },
  { key: 'lowStockAlerts', label: () => tx('pos.low_stock_alerts'), desc: () => tx('admin.account.notif.lowStockDesc') },
  { key: 'payrollApprovals', label: () => tx('admin.account.notif.payroll'), desc: () => tx('admin.account.notif.payrollDesc') },
  { key: 'weeklyReportSummaries', label: () => tx('admin.account.notif.weekly'), desc: () => tx('admin.account.notif.weeklyDesc') },
];

/** effective eligibility beside the saved switch: an "On" SMS preference cannot deliver if the salon's SMS cannot send */
export function notifEffect(item: (typeof NOTIF_ITEMS)[number], on: boolean, rd: MessagingReadiness | null, rdKnown: boolean): 'off' | 'on' | 'blocked' | 'unknown' {
  if (!on) return 'off';
  if (item.channel !== 'sms') return 'on';
  if (!rdKnown) return 'unknown';
  if (!rd) return 'unknown';
  return rd.outbound?.state === 'ready_to_attempt' ? 'on' : rd.outbound?.state === 'blocked' ? 'blocked' : 'unknown';
}

export function Toggle({ on, label, disabled, onChange, testId }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} data-testid={testId} className={'acx-switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** compact card (Account Overview) + Manage All workspace — one state, one save path */
export function NotificationPrefsPanel({ rd, rdKnown }: { rd: MessagingReadiness | null; rdKnown: boolean }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { setErr(null); posMePrefsApi.notifications().then(setPrefs).catch((e) => setErr(reportError(e, tx('pos.notification_preferences')))); }, []);
  useEffect(load, [load]);
  const set = (key: keyof NotificationPrefs, v: boolean) => {
    if (!prefs) return;
    setSaving(key); setMsg(null);
    // the switch moves only after the server answers (no optimistic "saved")
    posMePrefsApi.setNotifications({ [key]: v }).then((next) => { setPrefs(next); setMsg({ tone: 'ok', text: tt('acx.notif.saved') }); })
      .catch((e) => setMsg({ tone: 'err', text: reportError(e, tx('pos.notification_preferences')) })).finally(() => setSaving(null));
  };
  const row = (it: (typeof NOTIF_ITEMS)[number], big = false) => {
    const on = !!prefs?.[it.key];
    const eff = prefs ? notifEffect(it, on, rd, rdKnown) : 'unknown';
    const applies = NOTIFICATION_SWITCH_EFFECT[it.key];
    return (
      <div key={it.key} className={big ? 'acx-ncard' : 'row acx-nrow'} data-testid={big ? `acx-ncard-${it.key}` : `acx-nrow-${it.key}`}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: big ? 14 : 12.5 }}>{it.label()}</div>
          <div style={{ fontSize: big ? 12 : 10.5, color: 'var(--muted)' }}>{it.desc()}</div>
          {big || eff === 'blocked' ? <div className={'acx-eff ' + eff} data-testid="acx-eff" data-state={eff}>{tt('acx.eff.' + eff)}</div> : null}
          {/* extras round 11: say honestly whether this switch changes anything today (the server's own table, api-contracts) */}
          {big ? <div className="sub" style={{ fontSize: 11 }} data-testid="acx-applies" data-state={applies}>{tt('acx.applies.' + applies)}</div>
            : applies === 'no_sender' ? <div className="sub" style={{ fontSize: 10.5 }} data-testid="acx-applies" data-state={applies}>{tt('acx.applies.short_no_sender')}</div> : null}
        </div>
        <Toggle on={on} label={it.label()} disabled={!prefs || saving != null} onChange={(v) => set(it.key, v)} testId={big ? `acx-ntoggle-big-${it.key}` : `acx-ntoggle-${it.key}`} />
      </div>
    );
  };
  return (
    <section className="panel" data-testid="acx-notif">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div className="acx-h">{tx('pos.notification_preferences')}</div>
        <button className="btn ghost whitespace-nowrap w-fit" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11.5 }} data-testid="acx-notif-manage" onClick={() => setOpen(true)}>{tx('pos.manage_all')}</button>
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !prefs ? <div className="state">{tx('pos.loading')}</div> : <div className="list" style={{ maxHeight: 'none' }}>{NOTIF_ITEMS.map((it) => row(it))}</div>}
      {msg && !open ? <div className={msg.tone === 'err' ? 'err' : 'sub'} data-testid="acx-notif-msg" style={{ fontSize: 11, marginTop: 6 }}>{msg.text}</div> : null}
      {open ? (
        <FitDialog wide testId="acx-notif-dialog" title={tx('pos.notification_preferences')} subtitle={tt('acx.notif.sub')} onClose={() => setOpen(false)}
          footer={<button className="btn ghost" onClick={() => setOpen(false)}>{tx('pos.close')}</button>}>
          {err ? <ErrorRetry message={err} onRetry={load} /> : !prefs ? <div className="state">{tx('pos.loading')}</div> : <div className="acx-ngrid">{NOTIF_ITEMS.map((it) => row(it, true))}</div>}
          {msg ? <div className={msg.tone === 'err' ? 'err' : 'sub'} style={{ marginTop: 8 }}>{msg.text}</div> : null}
          <p className="sub" style={{ marginTop: 10 }}>{tt('acx.notif.foot')}</p>
          <p className="sub" style={{ marginTop: 4 }} data-testid="acx-notif-always">{tt('acx.notif.always')}</p>
          {prefs ? <QuietHours prefs={prefs} onSaved={(next) => { setPrefs(next); setMsg({ tone: 'ok', text: tt('acx.notif.saved') }); }} /> : null}
          <DeliveryHistory />
        </FitDialog>
      ) : null}
    </section>
  );
}

/** extras Customer Notifications 08 (round 10): personal quiet hours — salon local time; the server holds non-required pushes
 *  to this person inside the window (security notices always go). Both times, or Turn off. Saved only when the server answers. */
function QuietHours({ prefs, onSaved }: { prefs: NotificationPrefs; onSaved: (p: NotificationPrefs) => void }) {
  const on = !!prefs.quietHoursStart && !!prefs.quietHoursEnd;
  const [a, setA] = useState(prefs.quietHoursStart ?? '22:00'); const [b, setB] = useState(prefs.quietHoursEnd ?? '07:00');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = (patch: Partial<NotificationPrefs>) => { setBusy(true); setErr(null); posMePrefsApi.setNotifications(patch).then(onSaved).catch((e) => setErr(reportError(e, tt('acx.quiet.title')))).finally(() => setBusy(false)); };
  const valid = /^\d{2}:\d{2}$/.test(a) && /^\d{2}:\d{2}$/.test(b) && a !== b;
  return (
    <div className="panel" data-testid="acx-quiet" style={{ marginTop: 10, padding: 10 }}>
      <div style={{ fontWeight: 700 }}>{tt('acx.quiet.title')}</div>
      <div className="sub" data-testid="acx-quiet-state">{on ? tt('acx.quiet.on', { a: prefs.quietHoursStart ?? '', b: prefs.quietHoursEnd ?? '' }) : tt('acx.quiet.off')}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <label className="sub">{tt('acx.quiet.from')} <input type="time" value={a} onChange={(e) => setA(e.target.value)} data-testid="acx-quiet-start" /></label>
        <label className="sub">{tt('acx.quiet.to')} <input type="time" value={b} onChange={(e) => setB(e.target.value)} data-testid="acx-quiet-end" /></label>
        <button className="btn" disabled={busy || !valid} onClick={() => save({ quietHoursStart: a, quietHoursEnd: b })} data-testid="acx-quiet-save">{tt('acx.quiet.save')}</button>
        {on ? <button className="btn ghost" disabled={busy} onClick={() => save({ quietHoursStart: null, quietHoursEnd: null })} data-testid="acx-quiet-off">{tt('acx.quiet.turnOff')}</button> : null}
      </div>
      <div className="sub" style={{ marginTop: 4 }}>{tt('acx.quiet.rule')}</div>
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}

const humanAction = (a: string) => { const code = (a || '').trim(); const k = `admin.audit.action.${code}`; const l = tx(k); return l !== k ? l : code.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || tx('pos.event'); };

/** full Recent Account Activity — canonical audit, server search / From–To / numbered pages, newest first, read-only detail */
export function AccountActivityDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState<{ search?: string; from?: string; to?: string; page: number; pageSize: number }>({ page: 1, pageSize: 25 });
  const [draft, setDraft] = useState('');
  const [cal, setCal] = useState(false);
  const [d, setD] = useState<AuditPage | null>(null); const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<AuditEventRow | null>(null);
  const load = useCallback(() => { setErr(null); setD(null); posAuditApi.events(q).then(setD).catch((e) => setErr(reportError(e, tx('pos.recent_account_activity')))); }, [q]);
  useEffect(load, [load]);
  const any = !!(q.search || q.from || q.to);
  return (
    <FitDialog wide testId="acx-activity-dialog" title={tx('pos.recent_account_activity')} subtitle={tt('acx.act.sub')} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{tt('acx.act.back')}</button>}>
      <div className="rvw-filters acx-afilters">
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setQ((c) => ({ ...c, search: draft.trim() || undefined, page: 1 })); }}>
          <input className="rvw-search" type="search" data-testid="acx-act-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('acx.act.searchPh')} aria-label={tt('acx.act.searchPh')} />
          <button className="btn" type="submit" data-testid="acx-act-search-btn">{tt('dfx.search')}</button>
        </form>
        <button className={'btn ghost' + (q.from || q.to ? ' on' : '')} data-testid="acx-act-range" onClick={() => setCal(true)}>{q.from || q.to ? `${q.from ?? '…'} → ${q.to ?? '…'}` : tt('dfx.range')}</button>
        {any ? <button className="btn ghost" data-testid="acx-act-clear" onClick={() => { setDraft(''); setQ({ page: 1, pageSize: q.pageSize }); }}>{tt('acx.act.clear')}</button> : null}
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: q.from, to: q.to }} today={deviceToday()} onApply={(r) => { setQ((c) => ({ ...c, from: r.from, to: r.to, page: 1 })); setCal(false); }}
          onCancel={() => setCal(false)} onClear={() => { setQ((c) => ({ ...c, from: undefined, to: undefined, page: 1 })); setCal(false); }} /></div> : null}
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{tx('pos.loading_activity')}</div>
        : d.items.length === 0 ? <Empty title={any ? tt('acx.act.noMatch') : tx('pos.no_recent_account_activity')} />
        : <div className="rvw-table-wrap"><table className="tbl rvw-table" data-testid="acx-act-table">
          <thead><tr><th>{tx('pos.time')}</th><th>{tx('pos.event')}</th><th>{tt('acx.act.details')}</th><th>{tt('acx.act.by')}</th></tr></thead>
          <tbody>{d.items.map((a) => (
            <tr key={a.id} data-testid="acx-act-row" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setRow(a)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRow(a); } }}>
              <td className="sub nowrap">{when(a.occurredAt)}</td><td style={{ fontWeight: 700 }}>{humanAction(a.action)}</td>
              <td className="sub">{a.summary || codeLabel('admin.audit.module', a.module)}</td><td>{a.actorName || tx('pos.system')}</td>
            </tr>))}</tbody></table></div>}
      <div className="rvw-pager">
        <Pager info={d ? d.pagination : null} onPage={(p) => setQ((c) => ({ ...c, page: p }))} />
        <label className="rvw-f"><span>{tt('dfx.rows')}</span><select data-testid="acx-act-pagesize" value={String(q.pageSize)} onChange={(e) => setQ((c) => ({ ...c, pageSize: Number(e.target.value), page: 1 }))}>
          {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {row ? (
        <FitDialog testId="acx-act-detail" title={humanAction(row.action)} subtitle={when(row.occurredAt)} onClose={() => setRow(null)} footer={<button className="btn ghost" onClick={() => setRow(null)}>{tx('pos.close')}</button>}>
          <div className="list">
            {([[tt('acx.act.by'), row.actorName || tx('pos.system')], [tt('acx.act.role'), row.actorRole || '—'], [tt('acx.act.module'), codeLabel('admin.audit.module', row.module)],
              [tt('acx.act.details'), row.summary || '—'], [tt('acx.act.status'), row.status || '—'], [tt('acx.act.code'), row.action], [tt('acx.act.id'), row.id]] as [string, string][]).map(([k, v]) => (
              <div className="row" key={k}><div className="t" style={{ flex: 1, color: 'var(--muted)' }}>{k}</div><div style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</div></div>))}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>{tt('acx.act.readOnly')}</p>
        </FitDialog>
      ) : null}
    </FitDialog>
  );
}

/** batch 8 decision 7: my own alert deliveries (notification_delivery_logs) — search, channel, status, From–To, pages */
export function DeliveryHistory() {
  const [q, setQ] = useState<DeliveryQuery>({ page: 1, pageSize: 10 });
  const [draft, setDraft] = useState('');
  const [cal, setCal] = useState(false);
  const [d, setD] = useState<NotificationDeliveryPage | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posMePrefsApi.deliveries(q).then(setD).catch((e) => setErr(reportError(e, tt('acx.dh.title')))); }, [q]);
  useEffect(load, [load]);
  const set = (p: Partial<DeliveryQuery>) => setQ((c) => ({ ...c, ...p, page: p.page ?? 1 }));
  const any = !!(q.q || q.channel || q.status || q.from || q.to);
  return (
    <section className="acx-dh" data-testid="acx-dh">
      <div className="acx-h" style={{ margin: '14px 0 8px' }}>{tt('acx.dh.title')}</div>
      <div className="acx-afilters">
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="acx-dh-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('acx.dh.searchPh')} aria-label={tt('acx.dh.searchPh')} />
          <button className="btn" type="submit">{tt('dfx.search')}</button>
        </form>
        <select data-testid="acx-dh-channel" aria-label={tt('acx.dh.channel')} value={q.channel ?? 'all'} onChange={(e) => set({ channel: e.target.value })}>
          {['all', 'sms', 'email', 'push'].map((c) => <option key={c} value={c}>{tt('acx.dh.ch.' + c)}</option>)}</select>
        <select data-testid="acx-dh-status" aria-label={tt('acx.dh.status')} value={q.status ?? 'all'} onChange={(e) => set({ status: e.target.value })}>
          {['all', 'delivered', 'sent', 'queued', 'failed', 'suppressed', 'blocked'].map((c) => <option key={c} value={c}>{tt('acx.dh.st.' + c)}</option>)}</select>
        <button type="button" className={'btn ghost' + (q.from || q.to ? ' on' : '')} data-testid="acx-dh-range" onClick={() => setCal(true)}>{q.from || q.to ? `${q.from ?? '…'} → ${q.to ?? '…'}` : tt('dfx.range')}</button>
        {any ? <button type="button" className="btn ghost" onClick={() => { setDraft(''); setQ({ page: 1, pageSize: q.pageSize }); }}>{tt('acx.act.clear')}</button> : null}
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: q.from, to: q.to }} today={deviceToday()} onApply={(r) => { set({ from: r.from, to: r.to }); setCal(false); }}
          onCancel={() => setCal(false)} onClear={() => { set({ from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{tx('pos.loading')}</div>
        : d.items.length === 0 ? <Empty title={any ? tt('acx.dh.noMatch') : tt('acx.dh.none')} />
        : <div className="rvw-table-wrap"><table className="tbl rvw-table" data-testid="acx-dh-table">
          <thead><tr><th>{tx('pos.time')}</th><th>{tt('acx.dh.alert')}</th><th>{tt('acx.dh.channel')}</th><th>{tt('acx.dh.to')}</th><th>{tt('acx.dh.status')}</th></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.id} data-testid="acx-dh-row"><td className="sub nowrap">{when(r.createdAt)}</td><td style={{ fontWeight: 700 }}>{codeLabel('admin.notif.template', r.template)}</td>
              <td>{tt('acx.dh.ch.' + r.channel)}</td><td className="sub">{r.targetMasked}</td>
              <td><span className={'chip ' + (r.status === 'delivered' || r.status === 'sent' ? 'ok' : r.status === 'failed' || r.status === 'blocked' ? 'bad' : 'warn')}>{tt('acx.dh.st.' + r.status)}</span>{r.error ? <div className="sub" style={{ fontSize: 11 }} data-testid="acx-dh-error">{r.error === 'staff_pref_off' ? tt('acx.dh.err.staff_pref_off') : r.error}</div> : null}</td></tr>))}</tbody></table></div>}
      <div className="rvw-pager"><Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={(p) => set({ page: p })} /></div>
    </section>
  );
}
