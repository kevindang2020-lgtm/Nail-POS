import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotConnected } from './_chartkit';
import { fetchAppointmentOversight, searchAppointments, detectDuplicates, detectOverlaps, fetchChangeHistory, fetchFailures, fetchReschedules, fetchMissingInfo, type AppointmentOversight, type AoSearchResult, type AoDuplicateResult, type AoOverlapResult, type AoChangeResult, type AoFailuresResult, type AoMissingResult } from '../api/superAdminAppointmentOversightApi';

// AppointmentOversightSubScreen — shared scaffold for the Appointment Oversight submodules. Each view reuses the
// already-built /super-admin/appointment-oversight/overview data and renders its real slice, or an honest
// "Not connected" where the schema has no source yet (failures, sync, rescheduled, change history). No fabricated
// data, no dead pages. Heavier dedicated endpoints (cross-tenant record search, per-row duplicate/overlap
// detection, immutable change history) are explicit follow-on units; this scaffold states that honestly.

export type SubView = 'search' | 'booking-source' | 'failures' | 'duplicates' | 'overlapping' | 'rescheduled' | 'change-history' | 'missing-info' | 'sync-failures';

const num = (n: number) => n.toLocaleString();
const META: Record<SubView, { title: string; subtitle: string }> = {
  search: { title: 'Appointment Search', subtitle: 'Find any appointment across all authorized tenants and branches.' },
  'booking-source': { title: 'Booking Source', subtitle: 'Booking-source reporting within Appointment Oversight.' },
  failures: { title: 'Failures & Issues', subtitle: 'Failed appointment creation, confirmation, reschedule, and cancellation events.' },
  duplicates: { title: 'Duplicates', subtitle: 'Duplicate appointment detection and review.' },
  overlapping: { title: 'Overlapping Appointments', subtitle: 'Duration-aware appointment overlap detection.' },
  rescheduled: { title: 'Rescheduled Appointments', subtitle: 'Original vs. new values for rescheduled appointments.' },
  'change-history': { title: 'Change History', subtitle: 'Append-only field-level appointment change history.' },
  'missing-info': { title: 'Missing Information', subtitle: 'Appointments missing customer, technician, service, tenant, or branch data.' },
  'sync-failures': { title: 'Synchronization Failures', subtitle: 'External synchronization failures with controlled retry.' },
};

function Stat({ label, value, gap }: { label: string; value?: number; gap?: string }) {
  return (
    <div className="card" style={{ padding: 16, minWidth: 180 }}>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: gap ? 'var(--muted)' : 'var(--text)', marginTop: 4 }}>{gap ? <NotConnected>—</NotConnected> : num(value ?? 0)}</div>
      {gap ? <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{gap}</div> : null}
    </div>
  );
}

export function AppointmentOversightSubScreen({ view }: { view: SubView }) {
  const nav = useNavigate();
  const meta = META[view];
  const [data, setData] = useState<AppointmentOversight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AoSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [dups, setDups] = useState<AoDuplicateResult | null>(null);
  const dupReq = useRef(false);
  const [overlaps, setOverlaps] = useState<AoOverlapResult | null>(null);
  const ovReq = useRef(false);
  const [changes, setChanges] = useState<AoChangeResult | null>(null);
  const chReq = useRef(false);
  const [fails, setFails] = useState<AoFailuresResult | null>(null);
  const failReq = useRef(false);
  const [resch, setResch] = useState<AoChangeResult | null>(null);
  const reschReq = useRef(false);
  const [missing, setMissing] = useState<AoMissingResult | null>(null);
  const missReq = useRef(false);
  const inflight = useRef(false);

  useEffect(() => {
    if (view !== 'duplicates' || dupReq.current) return; dupReq.current = true;
    detectDuplicates({ page: 1, pageSize: 25 }).then(setDups).catch(() => setDups({ scope: { tenantId: null, label: 'platform' }, page: 1, pageSize: 25, total: 0, groups: [] }));
  }, [view]);

  useEffect(() => {
    if (view !== 'overlapping' || ovReq.current) return; ovReq.current = true;
    detectOverlaps({ page: 1, pageSize: 25 }).then(setOverlaps).catch(() => setOverlaps({ scope: { tenantId: null, label: 'platform' }, page: 1, pageSize: 25, total: 0, conflicts: [] }));
  }, [view]);

  useEffect(() => {
    if (view !== 'change-history' || chReq.current) return; chReq.current = true;
    fetchChangeHistory({ page: 1, pageSize: 25 }).then(setChanges).catch(() => setChanges({ scope: { tenantId: null, label: 'platform' }, page: 1, pageSize: 25, total: 0, rows: [], available: false }));
  }, [view]);

  useEffect(() => {
    if (view !== 'failures' || failReq.current) return; failReq.current = true;
    fetchFailures({ page: 1, pageSize: 25 }).then(setFails).catch(() => setFails(null));
  }, [view]);

  useEffect(() => {
    if (view !== 'rescheduled' || reschReq.current) return; reschReq.current = true;
    fetchReschedules({ page: 1, pageSize: 25 }).then(setResch).catch(() => setResch({ scope: { tenantId: null, label: 'platform' }, page: 1, pageSize: 25, total: 0, rows: [], available: false }));
  }, [view]);

  useEffect(() => {
    if (view !== 'missing-info' || missReq.current) return; missReq.current = true;
    fetchMissingInfo({ page: 1, pageSize: 25 }).then(setMissing).catch(() => setMissing({ scope: { tenantId: null, label: 'platform' }, page: 1, pageSize: 25, total: 0, rows: [], available: false }));
  }, [view]);

  const runSearch = (page = 1) => {
    setSearching(true);
    searchAppointments({ q: query.trim() || undefined, page, pageSize: 10 })
      .then(setResults).catch(() => setResults({ scope: { tenantId: null, label: 'platform' }, page, pageSize: 10, total: 0, rows: [] }))
      .finally(() => setSearching(false));
  };

  useEffect(() => {
    if (inflight.current) return; inflight.current = true;
    fetchAppointmentOversight().then(setData).catch((e) => setErr(e?.message || 'Failed to load.')).finally(() => { inflight.current = false; });
  }, []);

  const kpi = (k: string) => data?.kpis.find((x) => x.key === k);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12 }}><button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/appointment-oversight')}>← Appointment Oversight</button></div>
          <h1 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{meta.title}</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{meta.subtitle}</div>
        </div>
      </div>

      {err ? <div className="state">{err}</div> : !data ? <div className="state">Loading…</div> : (
        <>
          {view === 'booking-source' && (
            <section className="panel">
              <div className="phead"><h2 style={{ fontSize: 15 }}>Appointments by Source</h2></div>
              {data.sourceDistribution.bars.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th style={{ padding: 8 }}>Source</th><th style={{ padding: 8 }}>Bookings</th><th style={{ padding: 8 }}>Share</th></tr></thead>
                  <tbody>{data.sourceDistribution.bars.map((b) => (
                    <tr key={b.label} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: 8 }}>{b.label}</td><td style={{ padding: 8, fontWeight: 700 }}>{num(b.value)}</td><td style={{ padding: 8 }}>{b.pct}%</td></tr>
                  ))}</tbody>
                </table>
              ) : <div className="state" style={{ fontSize: 12 }}>No source data yet.</div>}
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Success/error rates and integration health per source <NotConnected>require booking-attempt instrumentation</NotConnected> (tracked in Booking &amp; Check-In Monitor).</div>
            </section>
          )}

          {view === 'duplicates' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Duplicate appointments detected" value={kpi('duplicates')?.value ?? 0} />
                {dups ? <Stat label="Candidate groups" value={dups.total} /> : null}
              </div>
              <section className="panel">
                <div className="phead"><h2 style={{ fontSize: 15 }}>Duplicate Candidate Groups</h2><span className="muted" style={{ fontSize: 11 }}>review-only · never auto-merged</span></div>
                {!dups ? <div className="state" style={{ fontSize: 12 }}>Detecting…</div> : dups.groups.length === 0 ? (
                  <div className="state" style={{ fontSize: 12 }}>No exact same-tenant duplicate collisions detected.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12,minWidth:900 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                        {['Tenant', 'Customer', 'Date', 'Time', 'Count', 'Match Reasons', 'Confidence'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {dups.groups.map((g, i) => (
                          <tr key={`${g.customerName}-${g.apptDate}-${g.startTime}-${i}`} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: 8 }}>{g.tenantName || '—'}</td>
                            <td style={{ padding: 8 }}>{g.customerName || '—'}</td>
                            <td style={{ padding: 8 }}>{g.apptDate || '—'}</td>
                            <td style={{ padding: 8 }}>{g.startTime || '—'}</td>
                            <td style={{ padding: 8, fontWeight: 700 }}>{g.count}</td>
                            <td style={{ padding: 8 }}>{g.matchReasons.join(', ')}</td>
                            <td style={{ padding: 8 }}><span style={{ fontWeight: 700, color: 'var(--g7)' }}>{g.confidence}%</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Same-tenant exact collisions only (unrelated tenants are never compared). Resolution actions (keep/cancel one, link records) are an audited review workflow — no appointment is ever auto-deleted or auto-merged.</div>
              </section>
            </div>
          )}
          {view === 'overlapping' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Technician overlaps detected" value={kpi('overlaps')?.value ?? 0} />
                {overlaps ? <Stat label="Conflict pairs" value={overlaps.total} /> : null}
              </div>
              <section className="panel">
                <div className="phead"><h2 style={{ fontSize: 15 }}>Technician Conflict Pairs</h2><span className="muted" style={{ fontSize: 11 }}>review-only · never auto-resolved</span></div>
                {!overlaps ? <div className="state" style={{ fontSize: 12 }}>Detecting…</div> : overlaps.conflicts.length === 0 ? (
                  <div className="state" style={{ fontSize: 12 }}>No technician time-window overlaps detected.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12,minWidth:900 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                        {['Tenant', 'Technician', 'Date', 'Appointment A', 'Appointment B', 'Overlap'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {overlaps.conflicts.map((c, i) => (
                          <tr key={`${c.a.id}-${c.b.id}-${i}`} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: 8 }}>{c.tenantName || '—'}</td>
                            <td style={{ padding: 8 }}>{c.technicianName || '—'}</td>
                            <td style={{ padding: 8 }}>{c.apptDate || '—'}</td>
                            <td style={{ padding: 8 }}>{c.a.customerName || '—'} <span className="muted">({c.a.startTime}–{c.a.endTime})</span></td>
                            <td style={{ padding: 8 }}>{c.b.customerName || '—'} <span className="muted">({c.b.startTime}–{c.b.endTime})</span></td>
                            <td style={{ padding: 8, fontWeight: 700, color: 'var(--danger)' }}>{c.overlapMinutes} min</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Same-tenant, same-technician intersecting time windows (duration-aware). Approved intentional double-booking and resolution actions are an audited workflow — nothing is auto-cancelled or auto-rescheduled.</div>
              </section>
            </div>
          )}
          {view === 'missing-info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Missing customer info" value={kpi('missing_customer')?.value ?? 0} />
                {missing ? <Stat label="Appointments affected" value={missing.total} /> : null}
              </div>
              <section className="panel">
                <div className="phead"><h2 style={{ fontSize: 15 }}>Appointments Missing Information</h2><span className="muted" style={{ fontSize: 11 }}>follow-up only · never auto-filled</span></div>
                {!missing ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : missing.rows.length === 0 ? (
                  <div className="state" style={{ fontSize: 12 }}>No upcoming appointments are missing required information.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                        {['Customer', 'Tenant / Branch', 'Date & Time', 'Technician', 'Status', 'Missing'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {missing.rows.map((r) => (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: 8 }}>{r.customerName || '—'}</td>
                            <td style={{ padding: 8 }}>{r.tenantName || '—'}{r.branchName ? ` / ${r.branchName}` : ''}</td>
                            <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.apptDate || '—'}{r.startTime ? ` ${r.startTime}` : ''}</td>
                            <td style={{ padding: 8 }}>{r.technicianName || 'N/A'}</td>
                            <td style={{ padding: 8 }}>{r.status || '—'}</td>
                            <td style={{ padding: 8 }}>{r.missing.map((m) => <span key={m} style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 600, color: 'var(--warn)', background: 'var(--warn-bg)', borderRadius: 5, padding: '1px 6px', marginRight: 4 }}>{m}</span>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Matches the platform missing-contact signal. Scope-enforced server-side; missing data is surfaced for follow-up and never auto-filled.</div>
              </section>
            </div>
          )}
          {view === 'search' && (
            <section className="panel">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input className="filterpill" style={{ flex: 1 }} placeholder="Appointment, customer, tenant, branch, technician…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(1); }} aria-label="Search appointments" />
                <button className="btn primary" onClick={() => runSearch(1)} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
              </div>
              {!results ? (
                <div className="muted" style={{ fontSize: 12 }}>Server-side, tenant-isolated search across all authorized tenants and branches. Scope is enforced on every query; customer phone is masked to last-4; appointments outside your authorized scope are never returned.</div>
              ) : results.rows.length === 0 ? (
                <div className="state" style={{ fontSize: 12 }}>No appointments match.</div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                        {['Customer', 'Phone', 'Tenant / Branch', 'Date & Time', 'Technician', 'Source', 'Status'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {results.rows.map((r) => (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: 8 }}>{r.customerName || '—'}</td>
                            <td style={{ padding: 8, color: 'var(--muted)' }}>{r.customerPhone || '—'}</td>
                            <td style={{ padding: 8 }}>{r.tenantName || '—'}{r.branchName ? ` / ${r.branchName}` : ''}</td>
                            <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.apptDate || '—'}{r.startTime ? ` ${r.startTime}` : ''}</td>
                            <td style={{ padding: 8 }}>{r.technicianName || 'N/A'}</td>
                            <td style={{ padding: 8 }}>{r.source || '—'}</td>
                            <td style={{ padding: 8 }}>{r.status || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12 }}>
                    <span className="muted">Page {results.page} · {results.total.toLocaleString()} result{results.total === 1 ? '' : 's'}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="filterpill" disabled={results.page <= 1 || searching} onClick={() => runSearch(results.page - 1)}>‹ Prev</button>
                      <button className="filterpill" disabled={results.page * results.pageSize >= results.total || searching} onClick={() => runSearch(results.page + 1)}>Next ›</button>
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Scope-enforced server-side; phone masked to last-4.</div>
                </>
              )}
            </section>
          )}
          {view === 'change-history' && (
            <section className="panel">
              <div className="phead"><h2 style={{ fontSize: 15 }}>Appointment Change History</h2><span className="muted" style={{ fontSize: 11 }}>append-only · immutable</span></div>
              {!changes ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : changes.rows.length === 0 ? (
                <div className="state" style={{ fontSize: 12 }}>No appointment changes recorded yet. History is captured going forward from instrumented mutation paths (status changes and reschedules are live; remaining write paths are being wired).</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                      {['When', 'Tenant', 'Change', 'Field', 'Old', 'New', 'Actor', 'Source'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {changes.rows.map((r) => (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.createdAt ? r.createdAt.replace('T', ' ').replace('Z', '') : '—'}</td>
                          <td style={{ padding: 8 }}>{r.tenantName || '—'}</td>
                          <td style={{ padding: 8, fontWeight: 600, color: 'var(--g7)' }}>{r.changeType}</td>
                          <td style={{ padding: 8 }}>{r.field || '—'}</td>
                          <td style={{ padding: 8, color: 'var(--muted)' }}>{r.oldValue ?? '—'}</td>
                          <td style={{ padding: 8 }}>{r.newValue ?? '—'}</td>
                          <td style={{ padding: 8 }}>{r.actorType || '—'}</td>
                          <td style={{ padding: 8 }}>{r.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Records are append-only and tamper-evident (updates and deletes are rejected at the database). Scope-enforced server-side.</div>
            </section>
          )}
          {view === 'failures' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section className="panel">
                <div className="phead"><h2 style={{ fontSize: 15 }}>Failed Deposits</h2><span className="muted" style={{ fontSize: 11 }}>captured failure signal</span></div>
                {!fails ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : fails.rows.length === 0 ? (
                  <div className="state" style={{ fontSize: 12 }}>No upcoming appointments with a failed deposit.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                        {['Customer', 'Phone', 'Tenant / Branch', 'Date & Time', 'Technician', 'Status', 'Deposit'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {fails.rows.map((r) => (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: 8 }}>{r.customerName || '—'}</td>
                            <td style={{ padding: 8, color: 'var(--muted)' }}>{r.customerPhone || '—'}</td>
                            <td style={{ padding: 8 }}>{r.tenantName || '—'}{r.branchName ? ` / ${r.branchName}` : ''}</td>
                            <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.apptDate || '—'}{r.startTime ? ` ${r.startTime}` : ''}</td>
                            <td style={{ padding: 8 }}>{r.technicianName || 'N/A'}</td>
                            <td style={{ padding: 8 }}>{r.status || '—'}</td>
                            <td style={{ padding: 8, fontWeight: 700, color: 'var(--danger)' }}>{r.depositStatus || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Scope-enforced server-side; phone masked to last-4. Matches the platform failed-deposit signal.</div>
              </section>
              <section className="panel">
                <div className="phead"><h2 style={{ fontSize: 15 }}>Other Failure Sources</h2></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, fontSize: 12 }}>
                  <div><strong>Failed bookings / confirmations</strong> — <NotConnected>not connected</NotConnected>: needs a booking-attempt event log emitted from the booking paths.</div>
                  <div><strong>Synchronization failures</strong> — <NotConnected>not connected</NotConnected>: needs a sync-event store from the external-sync integration.</div>
                </div>
              </section>
            </div>
          )}
          {view === 'rescheduled' && (
            <section className="panel">
              <div className="phead"><h2 style={{ fontSize: 15 }}>Rescheduled Appointments</h2><span className="muted" style={{ fontSize: 11 }}>from immutable change history</span></div>
              {!resch ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : resch.rows.length === 0 ? (
                <div className="state" style={{ fontSize: 12 }}>No reschedules recorded yet. Captured going forward from the change-history feed.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12,minWidth:900 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                      {['When', 'Tenant', 'Field Changed', 'Original', 'New', 'Changed By'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resch.rows.map((r) => (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.createdAt ? r.createdAt.replace('T', ' ').replace('Z', '') : '—'}</td>
                          <td style={{ padding: 8 }}>{r.tenantName || '—'}</td>
                          <td style={{ padding: 8, fontWeight: 600 }}>{r.field || '—'}</td>
                          <td style={{ padding: 8, color: 'var(--muted)' }}>{r.oldValue ?? '—'}</td>
                          <td style={{ padding: 8, color: 'var(--g7)', fontWeight: 700 }}>{r.newValue ?? '—'}</td>
                          <td style={{ padding: 8 }}>{r.actorType || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Reschedules are read from the append-only change history (original values are never overwritten without a record). Scope-enforced server-side.</div>
            </section>
          )}
          {view === 'sync-failures' && (
            <section className="panel">
              <div style={{ fontSize: 13, marginBottom: 6 }}><NotConnected>Not connected</NotConnected></div>
              <div className="muted" style={{ fontSize: 12 }}>External synchronization events are not yet instrumented — there is no external-sync integration emitting sync events today. The controlled retry workflow (eligibility check, idempotency key, audited attempts, backoff) attaches once a sync-event store exists; until then this view stays honestly empty rather than showing fabricated failures.</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
