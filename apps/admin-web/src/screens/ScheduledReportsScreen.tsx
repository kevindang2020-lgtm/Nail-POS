import { useEffect, useState } from 'react';
import { useScope } from '../shell/ScopeContext';
import {
  scheduledReportsApi, useScheduledReports,
  type ScheduleSource, type ScheduleFormat, type ScheduleFrequency, type ScheduleRange, type ScheduleRun,
} from '../api/superAdminScheduledReportsApi';
import { reportBuilderApi, type ReportDefinition } from '../api/superAdminReportBuilderApi';

// ScheduledReportsScreen.tsx — Super Admin › Scheduled Reports. Create schedules that periodically generate an
// export (reusing the analytics export or a saved report definition) and keep a run history with downloadable
// artifacts. Honest about the platform's current limits: there is no in-process cron (runs are triggered when the
// platform scheduler calls run-due), and there is no mailer yet (recipients are stored; artifacts are delivered
// in-app for download here). Rendered in the existing cream/gold system, Mac-fit.

const FORMATS: ScheduleFormat[] = ['csv', 'xlsx', 'pdf'];
const FREQS: ScheduleFrequency[] = ['daily', 'weekly', 'monthly'];
const RANGES: { v: ScheduleRange; label: string }[] = [
  { v: '7d', label: 'Last 7 Days' }, { v: '30d', label: 'Last 30 Days' }, { v: '90d', label: 'Last Quarter' },
  { v: '6m', label: 'Last 6 Months' }, { v: '12m', label: 'Last 12 Months' },
];
const dt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export function ScheduledReportsScreen() {
  const { tenantId, tenantName } = useScope();
  const { schedules, loading, error, reload } = useScheduledReports();
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);

  const [name, setName] = useState('');
  const [source, setSource] = useState<ScheduleSource>('analytics_export');
  const [definitionId, setDefinitionId] = useState('');
  const [format, setFormat] = useState<ScheduleFormat>('csv');
  const [range, setRange] = useState<ScheduleRange>('30d');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly');
  const [recipients, setRecipients] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);

  useEffect(() => { reportBuilderApi.list().then(setDefinitions).catch(() => { /* leave empty */ }); }, []);

  const create = async () => {
    if (!name.trim()) { setMsg('A schedule name is required.'); return; }
    if (source === 'saved_report' && !definitionId) { setMsg('Choose a saved report.'); return; }
    setBusy(true); setMsg(null);
    try {
      await scheduledReportsApi.create({
        name: name.trim(), source, reportDefinitionId: source === 'saved_report' ? definitionId : null, format, range,
        tenantId, frequency, recipients: recipients.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setName(''); setRecipients(''); await reload();
    } catch (e: any) { setMsg(e?.message || 'Create failed.'); }
    finally { setBusy(false); }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => { try { await scheduledReportsApi.update(id, { enabled }); await reload(); } catch { /* no-op */ } };
  const del = async (id: string) => { try { await scheduledReportsApi.remove(id); if (openRuns === id) setOpenRuns(null); await reload(); } catch { /* no-op */ } };
  const runNow = async (id: string) => { setBusy(true); try { await scheduledReportsApi.runNow(id); await reload(); if (openRuns === id) await showRuns(id); } catch (e: any) { setMsg(e?.message || 'Run failed.'); } finally { setBusy(false); } };
  const runDue = async () => { setBusy(true); setMsg(null); try { const r = await scheduledReportsApi.runDue(); setMsg(`Ran ${r.dueCount} due schedule(s).`); await reload(); if (openRuns) await showRuns(openRuns); } catch (e: any) { setMsg(e?.message || 'run-due failed.'); } finally { setBusy(false); } };
  const showRuns = async (id: string) => { setOpenRuns(id); try { setRuns(await scheduledReportsApi.runs(id)); } catch { setRuns([]); } };

  if (error) return <div className="work"><div className="state">{error}</div></div>;
  if (loading) return <div className="work"><div className="state">Loading scheduled reports…</div></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh">
        <h1>Scheduled Reports</h1>
        <div className="sub">Generate exports on a schedule and download them here.{tenantId ? ` · Scoped to ${tenantName ?? 'salon'}` : ''}</div>
      </div>

      <div className="pill warn" style={{ alignSelf: 'flex-start', fontWeight: 700 }}>
        Schedules run when the platform scheduler triggers run-due · email delivery is pending a mailer — artifacts are available for download below
      </div>

      {/* Create */}
      <section className="panel">
        <h2 style={{ fontSize: 13.5, marginBottom: 10 }}>New Schedule</h2>
        <div className="flex gap-2 whitespace-nowrap flex-wrap">
          <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Name
            <input className="font-normal" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly platform revenue" />
          </label>
          <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Source
            <select className="font-normal" value={source} onChange={(e) => setSource(e.target.value as ScheduleSource)}>
              <option value="analytics_export">Analytics export</option>
              <option value="saved_report">Saved report</option>
            </select>
          </label>
          {source === 'saved_report'
            ? <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Saved report
              <select className="font-normal" value={definitionId} onChange={(e) => setDefinitionId(e.target.value)}>
                  <option value="">Choose…</option>
                  {definitions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            : <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Range
                <select className="font-normal" value={range} onChange={(e) => setRange(e.target.value as ScheduleRange)}>
                  {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </label>}
          <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Format
            <select className="font-normal" value={format} onChange={(e) => setFormat(e.target.value as ScheduleFormat)}>
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </label>
          <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Frequency
            <select className="font-normal" value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}>
              {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label  className='whitespace-break-spaces'>Recipients (emails, comma-separated — stored, not yet emailed)
            <input  value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@salon.com, owner@salon.com" />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={create} disabled={busy}>{busy ? 'Working…' : 'Create schedule'}</button>
          <button className="btn ghost" onClick={runDue} disabled={busy}>▶ Run due now</button>
        </div>
        {msg && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}
      </section>

      {/* Schedules */}
      <section className="panel">
        <h2 style={{ fontSize: 13.5, marginBottom: 8 }}>Schedules</h2>
        {schedules.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No schedules yet. Create one above.</div>
          : <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Name</th><th style={{ textAlign: 'left' }}>Definition</th>
              <th style={{ textAlign: 'left' }}>Next run</th><th style={{ textAlign: 'left' }}>Last run</th>
              <th style={{ textAlign: 'left' }}>Status</th><th></th>
            </tr></thead>
            <tbody>{schedules.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td className="muted">{s.source === 'analytics_export' ? `Analytics · ${s.rangeKey}` : 'Saved report'} · {s.format.toUpperCase()} · {s.frequency}</td>
                <td className="muted">{dt(s.nextRunAt)}</td>
                <td className="muted">{dt(s.lastRunAt)}</td>
                <td><span className={`pill ${s.enabled ? 'ok' : 'warn'}`}>{s.enabled ? 'enabled' : 'paused'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => runNow(s.id)} disabled={busy}>Run now</button>{' '}
                  <button className="btn ghost sm" onClick={() => toggleEnabled(s.id, !s.enabled)}>{s.enabled ? 'Pause' : 'Resume'}</button>{' '}
                  <button className="btn ghost sm" onClick={() => (openRuns === s.id ? setOpenRuns(null) : showRuns(s.id))}>Runs</button>{' '}
                  <button className="btn ghost sm" onClick={() => del(s.id)}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>}

        {openRuns && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <h3 style={{ fontSize: 12.5, marginBottom: 6 }}>Run history</h3>
            {runs.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No runs yet.</div>
              : <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>When</th><th style={{ textAlign: 'left' }}>Trigger</th><th style={{ textAlign: 'left' }}>Status</th><th style={{ textAlign: 'left' }}>File</th><th></th></tr></thead>
                <tbody>{runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td className="muted">{dt(r.createdAt)}</td>
                    <td className="muted">{r.trigger}</td>
                    <td><span className={`pill ${r.status === 'success' ? 'ok' : 'warn'}`}>{r.status}</span></td>
                    <td className="muted">{r.status === 'success' ? `${r.filename ?? '—'} (${(r.byteSize / 1024).toFixed(1)} KB)` : (r.error ?? '—')}</td>
                    <td style={{ textAlign: 'right' }}>{r.status === 'success' && <button className="btn ghost sm" onClick={() => scheduledReportsApi.download(r.id)}>⤓ Download</button>}</td>
                  </tr>
                ))}</tbody>
              </table>}
          </div>
        )}
      </section>
    </div>
  );
}
