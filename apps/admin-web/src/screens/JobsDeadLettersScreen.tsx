// Super-Admin → Jobs & Dead Letters — BUILD_PLAN Phase 2 (Constitution 4 §32–36, Constitution 8 §150–155).
//
// Two queues that fail quietly when nobody looks:
//   • the job queue (migration 519) — per class: due, running, dead, done in the last hour and how long the oldest due
//     job has waited; the jobs themselves, dead ones first, with their last error. Retry or cancel needs a reason (it
//     is audited, and the next person needs to know why).
//   • the event dead letters — a consumer that could not handle an event after its retries. They had an API and no
//     screen. Retry re-runs the consumer; discard keeps the row for history.
// Nothing here is computed: every number comes from the API; a section whose request failed says so (no fake green).
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { superAdminJobsApi, type JobClassStats, type JobListRow, type JobStatus, type EventDeadLetter, type EventPipelineHealth } from '../api/superAdminJobsApi';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
export function waitLabel(seconds: number | null): string {
  if (seconds === null) return 'nothing waiting';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
const STATUSES: JobStatus[] = ['dead', 'queued', 'running', 'succeeded', 'canceled'];

export function JobsDeadLettersScreen() {
  const [stats, setStats] = useState<JobClassStats[] | 'failed' | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [status, setStatus] = useState<JobStatus>('dead');
  const [jobs, setJobs] = useState<JobListRow[] | 'failed' | null>(null);
  const [letters, setLetters] = useState<EventDeadLetter[] | 'failed' | null>(null);
  const [health, setHealth] = useState<EventPipelineHealth | 'failed' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const { confirm, confirmUi } = useInlineConfirm();

  const load = useCallback(() => {
    superAdminJobsApi.stats().then((r) => { setStats(r.classes); setHandlers(r.handlers); }).catch(() => setStats('failed'));
    superAdminJobsApi.list({ status, limit: 100 }).then((r) => setJobs(r.items)).catch(() => setJobs('failed'));
    superAdminJobsApi.deadLetters({ status: 'open', limit: 100 }).then((r) => setLetters(Array.isArray(r) ? r : [])).catch(() => setLetters('failed'));
    superAdminJobsApi.eventHealth().then((r) => setHealth(r && Array.isArray(r.consumers) ? r : 'failed')).catch(() => setHealth('failed'));
  }, [status]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const runJobAction = async (j: JobListRow, action: 'retry' | 'cancel', reason: string) => {
    setBusy(j.id);
    try { await (action === 'retry' ? superAdminJobsApi.retry(j.id, reason) : superAdminJobsApi.cancel(j.id, reason)); setNotice(`${j.jobType}: ${action === 'retry' ? 'queued again' : 'canceled'}.`); load(); }
    catch (e: any) { setNotice(e?.message || `Could not ${action} the job.`); }
    finally { setBusy(null); }
  };
  // A reason is required (min 5 characters) — it is recorded in the audit log, and the next person needs to know why.
  const jobAction = (j: JobListRow, action: 'retry' | 'cancel') =>
    ask(`${action === 'retry' ? 'Retry' : 'Cancel'} ${j.jobType} — why?`, (reason) => { void runJobAction(j, action, reason); }, { minLength: 5, inputLabel: 'Reason', confirmLabel: action === 'retry' ? 'Retry job' : 'Cancel job' });
  const letterAction = (d: EventDeadLetter, action: 'retry' | 'discard') => {
    if (action === 'discard') { confirm(`Discard the failed ${d.event_type} for ${d.consumer_name}? The record is kept for history; the consumer will not run it.`, () => { void runLetterAction(d, action); }, { confirmLabel: 'Discard' }); return; }
    void runLetterAction(d, action);
  };
  const runLetterAction = async (d: EventDeadLetter, action: 'retry' | 'discard') => {
    setBusy(d.id);
    try {
      const r = await (action === 'retry' ? superAdminJobsApi.retryDeadLetter(d.id) : superAdminJobsApi.discardDeadLetter(d.id));
      setNotice(r.ok ? `${d.event_type} → ${d.consumer_name}: ${action === 'retry' ? 'retrying' : 'discarded'}.` : `Not done: ${r.reason ?? 'refused'}.`);
      load();
    } catch (e: any) { setNotice(e?.message || `Could not ${action} the dead letter.`); }
    finally { setBusy(null); }
  };

  return (
    <div className="work">
      <div className="vh"><h1>Jobs &amp; Dead Letters</h1><div className="sub">Background work across every salon · refreshes every 30 s</div></div>
      {askUi}{confirmUi}
      {notice && <div className="panel" role="status" data-testid="notice">{notice}</div>}

      <h2>Job queue</h2>
      {stats === null && <div className="state">Loading the job queue…</div>}
      {stats === 'failed' && <div className="err" role="alert" data-testid="stats-failed">Could not load the job queue — its state is unknown, not empty.</div>}
      {Array.isArray(stats) && (
        <table className="tbl" data-testid="stats">
          <thead><tr><th>Class</th><th>Due</th><th>Running</th><th>Dead</th><th>Done (1 h)</th><th>Oldest due job waiting</th></tr></thead>
          <tbody>{stats.map((c) => (
            <tr key={c.jobClass} data-testid={`class-${c.jobClass}`}>
              <td>{c.jobClass}</td><td>{c.queued}</td><td>{c.running}</td>
              <td style={c.dead ? { color: 'var(--aps-bad, #cf222e)', fontWeight: 600 } : undefined}>{c.dead}</td>
              <td>{c.succeededLastHour}</td><td>{waitLabel(c.oldestQueuedSeconds)}</td>
            </tr>))}</tbody>
        </table>
      )}
      {Array.isArray(stats) && <div className="s">Job types with a handler in this deployment: {handlers.length ? handlers.join(', ') : 'none yet'}.</div>}

      <div style={{ margin: '12px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn ghost" data-testid="self-test" disabled={busy === 'self-test'} onClick={async () => {
          setBusy('self-test');
          try { const r = await superAdminJobsApi.selfTest(5); setNotice(`Self-test: ${r.ids.length} jobs queued — they show as succeeded within seconds while a worker is running.`); load(); }
          catch (e: any) { setNotice(e?.message || 'Could not queue the self-test.'); }
          finally { setBusy(null); }
        }}>Run self-test</button>
        <label>Show <select aria-label="Job status" value={status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select> jobs</label>
      </div>
      {jobs === 'failed' && <div className="err" role="alert" data-testid="jobs-failed">Could not load the jobs.</div>}
      {Array.isArray(jobs) && jobs.length === 0 && <div className="state" data-testid="jobs-empty">No {status} jobs.</div>}
      {Array.isArray(jobs) && jobs.length > 0 && (
        <table className="tbl" data-testid="jobs">
          <thead><tr><th>Type</th><th>Class</th><th>Salon</th><th>Attempts</th><th>Last error</th><th>Created</th><th></th></tr></thead>
          <tbody>{jobs.map((j) => (
            <tr key={j.id} data-testid={`job-${j.id}`}>
              <td>{j.jobType}</td><td>{j.jobClass} · P{j.priority}</td><td>{j.tenantId ?? 'platform'}</td>
              <td>{j.attempts}/{j.maxAttempts}</td><td>{j.lastError ?? '—'}</td><td>{when(j.createdAt)}</td>
              <td>
                {(j.status === 'dead' || j.status === 'canceled') && <button disabled={busy === j.id} onClick={() => jobAction(j, 'retry')}>Retry</button>}
                {(j.status === 'dead' || j.status === 'queued') && <button disabled={busy === j.id} onClick={() => jobAction(j, 'cancel')}>Cancel</button>}
              </td>
            </tr>))}</tbody>
        </table>
      )}

      <h2>Event dead letters</h2>
      {letters === null && <div className="state">Loading dead letters…</div>}
      {letters === 'failed' && <div className="err" role="alert" data-testid="letters-failed">Could not load the event dead letters — this needs the events permission.</div>}
      {Array.isArray(letters) && letters.length === 0 && <div className="state" data-testid="letters-empty">No open dead letters — every consumer is keeping up.</div>}
      {Array.isArray(letters) && letters.length > 0 && (
        <table className="tbl" data-testid="letters">
          <thead><tr><th>Event</th><th>Consumer</th><th>Salon</th><th>Attempts</th><th>Error</th><th>Last failed</th><th></th></tr></thead>
          <tbody>{letters.map((d) => (
            <tr key={d.id} data-testid={`letter-${d.id}`}>
              <td>{d.event_type}</td><td>{d.consumer_name}</td><td>{d.tenant_id ?? 'platform'}</td><td>{d.attempts}</td>
              <td>{[d.error_class, d.last_error_code].filter(Boolean).join(' · ') || '—'}</td><td>{when(d.last_failed_at)}</td>
              <td>
                <button disabled={busy === d.id} onClick={() => letterAction(d, 'retry')}>Retry</button>
                <button disabled={busy === d.id} onClick={() => letterAction(d, 'discard')}>Discard</button>
              </td>
            </tr>))}</tbody>
        </table>
      )}

      {/* TECH QUEUE 15 (round 10): retries / duplicates per event consumer — a duplicate delivery is absorbed (handled once) and counted */}
      <h2>Event consumers — retries &amp; duplicates</h2>
      {health === null && <div className="state">Loading event consumers…</div>}
      {health === 'failed' && <div className="err" role="alert" data-testid="consumers-failed">Could not load the event consumers — this needs the events permission.</div>}
      {health && health !== 'failed' && (
        <table className="tbl" data-testid="consumers">
          <thead><tr><th>Consumer</th><th>Processed (1 h)</th><th>Lag</th><th>Open dead letters</th><th>Duplicates absorbed (24 h)</th></tr></thead>
          <tbody>{health.consumers.map((c) => (
            <tr key={c.consumerName} data-testid={`consumer-${c.consumerName}`}>
              <td>{c.consumerName}{c.critical ? ' · critical' : ''}</td><td>{c.processedLastHour}</td><td>{c.lagSec == null ? '—' : waitLabel(c.lagSec)}</td>
              <td>{Array.isArray(letters) ? letters.filter((d) => d.consumer_name === c.consumerName).length : '—'}</td>
              <td data-testid={`consumer-dups-${c.consumerName}`}>{c.duplicateDeliveries == null ? '—' : c.duplicateDeliveries === 0 ? 'none' : `${c.duplicateDeliveries} repeat(s) of ${c.duplicateEventsLastDay ?? 0} event(s) — handled once`}</td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}
