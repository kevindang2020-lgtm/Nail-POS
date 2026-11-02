// Super Admin → On-call & monitoring — BUILD_PLAN Phase 14 C (Constitution 11 §262–265, §80, §92–95, §114–117).
//
// Four panels over GET /super-admin/oncall/*:
//   • Paged alerts — open critical / high platform alerts with the escalation chain each one walked (§265 created →
//     acknowledged → resolved) and an Acknowledge button (stops the chain; the alert stays open until it resolves).
//   • On-call chain — who is woken, in order, by which channel, for which owners, with quiet hours. Editing needs
//     super_admin.system.manage + step-up (the client re-prompts) + a reason, which is audited.
//   • Synthetic monitoring — the ONE test salon the kiosk probe may read (default none → "not configured") and the latest
//     result of every probe. A skipped probe is shown as skipped with its reason — never as a pass (§332).
//   • Backups — the last report and the staleness rule (no successful backup within the window → P2 alert).
// A panel whose read fails says so; it never renders as empty / all clear.
import { useCallback, useEffect, useState } from 'react';
import type {
  BackupMonitoring, OnCallBoard, OnCallChannel, OnCallContact, OnCallContactInput, OnCallContacts, OnCallRole, SyntheticMonitoring,
} from '@aipowersalon/api-contracts/platform';
import { onCallApi } from '../api/onCallApi';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const errText = (e: unknown, fallback: string) => (e as { message?: string })?.message || fallback;
const BAD = 'var(--aps-bad, #cf222e)', WARN = 'var(--aps-warn, #9a6700)', GOOD = 'var(--aps-good, #1a7f37)';

export const ROLE_LABEL: Record<OnCallRole, string> = { primary: 'Primary', secondary: 'Secondary', incident_commander: 'Incident commander', other: 'Other' };
export const OUTCOME_LABEL: Record<string, string> = {
  sent: 'Sent', failed: 'Send failed', not_configured: 'Channel not configured', skipped_quiet_hours: 'Skipped (quiet hours)', chain_exhausted: 'Nobody left to page',
};
export const PROBE_DETAIL: Record<string, string> = {
  not_configured: 'Not configured',
  test_salon_has_no_active_kiosk: 'The designated test salon has no active kiosk',
  refused_non_sandbox_host: 'Refused — the URL is not a processor sandbox',
  refused_live_credentials: 'Refused — live credentials in the test slot',
  settings_unreadable: 'Settings could not be read',
};
const ACK_VIA: Record<string, string> = { screen: 'on this screen', email_link: 'by the emailed link', alerts_screen: 'on the Alerts screen' };

type Loaded<T> = T | 'failed' | null;

function useLoad<T>(fn: () => Promise<T>): [Loaded<T>, () => void, (v: T) => void] {
  const [v, setV] = useState<Loaded<T>>(null);
  const load = useCallback(() => {
    try { fn().then(setV).catch(() => setV('failed')); } catch { setV('failed'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  return [v, load, setV];
}

// ── Paged alerts ────────────────────────────────────────────────────────────────────────────────────────────────

function AlertsPanel() {
  const [board, reload] = useLoad<OnCallBoard>(() => onCallApi.alerts());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);
  const ack = async (id: string) => {
    setBusy(id); setErr(null);
    try { await onCallApi.acknowledge(id); reload(); } catch (e) { setErr(errText(e, 'Could not acknowledge the alert.')); } finally { setBusy(null); }
  };
  return (
    <section data-testid="oncall-alerts">
      <h2>Paged alerts</h2>
      {err && <div className="err" role="alert">{err}</div>}
      {board === null ? <div className="state">Loading…</div>
        : board === 'failed' ? <div className="err" data-testid="alerts-failed">Could not load paged alerts — this is not the same as "no alerts".</div>
        : board.alerts.length === 0 ? <div className="state">No paged platform alerts in the last 7 days.</div> : (
          <table className="tbl"><thead><tr><th>Severity</th><th>Alert</th><th>Owner</th><th>State</th><th>Escalation</th><th /></tr></thead>
            <tbody>{board.alerts.map((a) => {
              const open = a.status === 'unread' && !a.acknowledgedAt;
              const state = a.resolvedAt || a.status === 'resolved' ? `Resolved ${when(a.resolvedAt)}`
                : a.acknowledgedAt ? `Acknowledged ${when(a.acknowledgedAt)}${a.acknowledgedVia ? ` ${ACK_VIA[a.acknowledgedVia] ?? ''}` : ''}` : `Raised ${when(a.createdAt)}`;
              return (
                <tr key={a.id} data-testid={`alert-${a.id}`}>
                  <td style={{ color: a.severity === 'critical' ? BAD : WARN, fontWeight: 600 }}>{a.severity}</td>
                  <td>{a.title}</td>
                  <td>{a.owner}</td>
                  <td>{state}</td>
                  <td>{a.steps.length === 0 ? 'Not escalated yet' : (
                    <ol style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                      {a.steps.map((s) => <li key={s.step}>{s.contact ?? '—'}{s.channel ? ` (${s.channel})` : ''}: {OUTCOME_LABEL[s.outcome] ?? s.outcome} · {when(s.notifiedAt)}</li>)}
                    </ol>
                  )}</td>
                  <td>{open && <button type="button" className="btn" disabled={busy === a.id} onClick={() => ack(a.id)} data-testid={`ack-${a.id}`}>Acknowledge</button>}</td>
                </tr>
              );
            })}</tbody></table>
        )}
    </section>
  );
}

// ── On-call chain ───────────────────────────────────────────────────────────────────────────────────────────────

type Draft = { position: string; role: OnCallRole; name: string; channel: OnCallChannel; destination: string; owners: string[]; quietStart: string; quietEnd: string; timezone: string; active: boolean };
const emptyDraft = (position: number): Draft => ({ position: String(position), role: position === 1 ? 'primary' : position === 2 ? 'secondary' : 'incident_commander', name: '', channel: 'email', destination: '', owners: [], quietStart: '', quietEnd: '', timezone: 'America/New_York', active: true });
const toDraft = (c: OnCallContact): Draft => ({ position: String(c.position), role: c.role, name: c.name, channel: c.channel, destination: c.destination, owners: [...c.owners], quietStart: c.quietStart ?? '', quietEnd: c.quietEnd ?? '', timezone: c.timezone, active: c.active });
export function draftToInput(d: Draft, reason: string): OnCallContactInput {
  return { position: Number(d.position), role: d.role, name: d.name.trim(), channel: d.channel, destination: d.destination.trim(), owners: d.owners,
    quietStart: d.quietStart || null, quietEnd: d.quietEnd || null, timezone: d.timezone.trim() || null, active: d.active, reason: reason.trim() };
}
const DEST_HINT: Record<OnCallChannel, string> = { email: 'name@example.com', sms: '+16095551234', push: 'Super Admin user id' };

function ChainPanel() {
  const [data, , setData] = useLoad<OnCallContacts>(() => onCallApi.contacts());
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(1));
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (data === null) return <section data-testid="oncall-chain"><h2>On-call chain</h2><div className="state">Loading…</div></section>;
  if (data === 'failed') return <section data-testid="oncall-chain"><h2>On-call chain</h2><div className="err" data-testid="chain-failed">Could not load the on-call chain.</div></section>;

  const start = (c: OnCallContact | null) => { setErr(null); setReason(''); setRemoving(null); setEditing(c ? c.id : 'new'); setDraft(c ? toDraft(c) : emptyDraft((data.contacts[data.contacts.length - 1]?.position ?? 0) + 1)); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    if (!reason.trim()) { setErr('A reason is required (it is audited).'); return; }
    setBusy(true); setErr(null);
    try {
      const body = draftToInput(draft, reason);
      setData(editing === 'new' ? await onCallApi.addContact(body) : await onCallApi.updateContact(String(editing), body));
      setEditing(null);
    } catch (e) { setErr(errText(e, 'Could not save the contact.')); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!reason.trim()) { setErr('A reason is required (it is audited).'); return; }
    setBusy(true); setErr(null);
    try { setData(await onCallApi.removeContact(id, reason.trim())); setRemoving(null); setReason(''); } catch (e) { setErr(errText(e, 'Could not remove the contact.')); } finally { setBusy(false); }
  };

  return (
    <section data-testid="oncall-chain">
      <h2>On-call chain</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        A critical or high platform alert pages step 1 at once. Not acknowledged within 10 minutes (critical) or 30 minutes (high), it pages the next
        contact. A contact that cannot be reached is skipped at once. Quiet hours hold back high alerts only — a critical alert always pages.
        Changes need a reason and a fresh sign-in confirmation.
      </p>
      {err && <div className="err" role="alert" data-testid="chain-error">{err}</div>}
      {data.contacts.length === 0 ? (
        <div className="err" data-testid="chain-empty">Nobody is on call. Paged alerts only reach the broadcast email to every Super Admin — add at least a primary contact.</div>
      ) : (
        <table className="tbl" data-testid="chain-table"><thead><tr><th>#</th><th>Role</th><th>Name</th><th>Channel</th><th>Covers</th><th>Quiet hours</th><th>Active</th><th /></tr></thead>
          <tbody>{data.contacts.map((c) => (
            <tr key={c.id} data-testid={`contact-${c.id}`}>
              <td>{c.position}</td><td>{ROLE_LABEL[c.role] ?? c.role}</td><td>{c.name}</td>
              <td>{c.channel} · <code>{c.destination}</code></td>
              <td>{c.owners.length ? c.owners.join(', ') : 'Everything'}</td>
              <td>{c.quietStart && c.quietEnd ? `${c.quietStart}–${c.quietEnd} ${c.timezone}` : '—'}</td>
              <td style={{ color: c.active ? GOOD : WARN }}>{c.active ? 'Yes' : 'Paused'}</td>
              <td>
                <button type="button" className="btn-link" onClick={() => start(c)}>Edit</button>{' '}
                <button type="button" className="btn-link" onClick={() => { setEditing(null); setErr(null); setReason(''); setRemoving(c.id); }} data-testid={`remove-${c.id}`}>Remove</button>
              </td>
            </tr>
          ))}</tbody></table>
      )}
      {removing && (
        <div className="panel" data-testid="remove-form">
          <label>Reason for removing {data.contacts.find((c) => c.id === removing)?.name ?? 'this contact'}
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} data-testid="remove-reason" /></label>
          <button type="button" className="btn" disabled={busy} onClick={() => remove(removing)} data-testid="remove-confirm">Remove contact</button>{' '}
          <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>Cancel</button>
        </div>
      )}
      {editing === null ? (
        <button type="button" className="btn" onClick={() => start(null)} data-testid="add-contact">Add contact</button>
      ) : (
        <div className="panel" data-testid="contact-form" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <div className="t">{editing === 'new' ? 'Add contact' : 'Edit contact'}</div>
          <label>Order <input type="number" min={1} max={50} value={draft.position} onChange={(e) => set('position', e.target.value)} data-testid="f-position" /></label>
          <label>Role <select value={draft.role} onChange={(e) => set('role', e.target.value as OnCallRole)} data-testid="f-role">
            {(Object.keys(ROLE_LABEL) as OnCallRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <label>Name <input value={draft.name} maxLength={120} onChange={(e) => set('name', e.target.value)} data-testid="f-name" /></label>
          <label>Channel <select value={draft.channel} onChange={(e) => set('channel', e.target.value as OnCallChannel)} data-testid="f-channel">
            {data.channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Destination <input value={draft.destination} placeholder={DEST_HINT[draft.channel]} maxLength={254} onChange={(e) => set('destination', e.target.value)} data-testid="f-destination" /></label>
          <fieldset><legend>Covers (none ticked = everything)</legend>
            {data.owners.map((o) => (
              <label key={o} style={{ marginRight: 12 }}><input type="checkbox" checked={draft.owners.includes(o)}
                onChange={(e) => set('owners', e.target.checked ? [...draft.owners, o] : draft.owners.filter((x) => x !== o))} /> {o}</label>
            ))}
          </fieldset>
          <label>Quiet hours from <input type="time" value={draft.quietStart} onChange={(e) => set('quietStart', e.target.value)} data-testid="f-quiet-start" /></label>
          <label>to <input type="time" value={draft.quietEnd} onChange={(e) => set('quietEnd', e.target.value)} data-testid="f-quiet-end" /></label>
          <label>Time zone <input value={draft.timezone} maxLength={64} onChange={(e) => set('timezone', e.target.value)} data-testid="f-timezone" /></label>
          <label><input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
          <label>Reason (audited) <input value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} data-testid="f-reason" /></label>
          <div>
            <button type="button" className="btn" disabled={busy} onClick={save} data-testid="save-contact">Save</button>{' '}
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Synthetic monitoring ────────────────────────────────────────────────────────────────────────────────────────

function SyntheticPanel() {
  const [s, , setS] = useLoad<SyntheticMonitoring>(() => onCallApi.synthetic());
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (id: string | null) => {
    if (!reason.trim()) { setErr('A reason is required (it is audited).'); return; }
    setBusy(true); setErr(null);
    try { setS(await onCallApi.setSynthetic(id, reason.trim())); setTenantId(''); setReason(''); } catch (e) { setErr(errText(e, 'Could not change the test salon.')); } finally { setBusy(false); }
  };
  return (
    <section data-testid="oncall-synthetic">
      <h2>Synthetic monitoring</h2>
      {s === null ? <div className="state">Loading…</div> : s === 'failed' ? <div className="err" data-testid="synthetic-failed">Could not load synthetic monitoring.</div> : (
        <>
          <div className="panel" data-testid="test-salon">
            <div className="t">Test salon for the kiosk probe</div>
            {s.testTenant ? (
              <div>{s.testTenant.name ?? s.testTenant.id} <span className="muted">· set {when(s.testTenant.updatedAt)}{s.testTenant.reason ? ` · ${s.testTenant.reason}` : ''}</span></div>
            ) : <div style={{ color: WARN }} data-testid="test-salon-none">None designated — the kiosk probe is not configured and reports nothing.</div>}
            <div className="s muted">Only a dedicated test salon. The probe reads that salon's kiosk configuration and never writes.</div>
            {err && <div className="err" role="alert">{err}</div>}
            <label>Salon id <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant uuid" data-testid="test-salon-id" /></label>{' '}
            <label>Reason (audited) <input value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} data-testid="test-salon-reason" /></label>{' '}
            <button type="button" className="btn" disabled={busy || !tenantId.trim()} onClick={() => submit(tenantId.trim())} data-testid="test-salon-set">Designate</button>{' '}
            {s.testTenant && <button type="button" className="btn ghost" disabled={busy} onClick={() => submit(null)} data-testid="test-salon-clear">Clear</button>}
          </div>
          {s.probes.length === 0 ? <div className="state" data-testid="probes-none">No probe has run yet.</div> : (
            <table className="tbl" data-testid="probe-table"><thead><tr><th>Probe</th><th>Result</th><th>Detail</th><th>Time</th><th>Failures in a row</th><th>Ran</th></tr></thead>
              <tbody>{s.probes.map((p) => (
                <tr key={p.probe} data-testid={`probe-${p.probe}`}>
                  <td><code>{p.probe}</code></td>
                  <td style={{ color: p.outcome === 'pass' ? GOOD : p.outcome === 'fail' ? BAD : WARN, fontWeight: 600 }}>{p.outcome === 'skipped' ? 'Skipped' : p.outcome === 'pass' ? 'Pass' : 'Fail'}</td>
                  <td>{PROBE_DETAIL[p.detail] ?? p.detail}</td>
                  <td>{p.outcome === 'skipped' ? '—' : `${p.durationMs} ms`}</td>
                  <td>{p.consecutiveFailures}</td>
                  <td>{when(p.ranAt)}</td>
                </tr>
              ))}</tbody></table>
          )}
        </>
      )}
    </section>
  );
}

// ── Backups ─────────────────────────────────────────────────────────────────────────────────────────────────────

function BackupsPanel() {
  const [b] = useLoad<BackupMonitoring>(() => onCallApi.backups());
  return (
    <section data-testid="oncall-backups">
      <h2>Backups</h2>
      {b === null ? <div className="state">Loading…</div> : b === 'failed' ? <div className="err" data-testid="backups-failed">Could not load backup status — this is not the same as "backups are fine".</div> : (
        <div className="panel">
          <div style={{ fontWeight: 600, color: b.evaluation.status === 'HEALTHY' ? GOOD : b.evaluation.status === 'UNKNOWN' ? WARN : BAD }} data-testid="backup-status">
            {b.summary?.lastBackupAt ? b.evaluation.status : 'No backup report received yet'}
          </div>
          <div className="s">Last successful backup: {when(b.summary?.lastSuccessfulBackupAt ?? null)} · latest report: {b.summary?.lastBackupStatus ?? '—'} at {when(b.summary?.lastBackupAt ?? null)}</div>
          <div className="s">Last restore drill: {when(b.summary?.lastDrillAt ?? null)}{b.summary?.lastDrillOk === false ? ' (FAILED)' : ''}</div>
          <div className="s muted">Rule: no successful backup reported within {b.maxAgeHours} hours raises a high alert and pages the on-call chain. Reports come from the backup job (<code>scripts/report-backup.mjs</code>).</div>
        </div>
      )}
    </section>
  );
}

export function OnCallScreen() {
  return (
    <div className="work">
      <div className="vh"><h1>On-call &amp; monitoring</h1><div className="sub">Escalation chain, paged alerts, synthetic probes and backups</div></div>
      <AlertsPanel />
      <ChainPanel />
      <SyntheticPanel />
      <BackupsPanel />
    </div>
  );
}
