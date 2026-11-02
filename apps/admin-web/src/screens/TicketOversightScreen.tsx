import { useEffect, useRef, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';
import { money, dt, dd, NotConnected } from './_chartkit';

// TicketOversightScreen.tsx — Super Admin › Ticket Oversight. READ-ONLY, platform-wide view of every ticket and its full
// revision history across all tenants. Data: GET /super-admin/tickets (list, filterable) + GET /super-admin/tickets/:id/history
// (snapshot + service lines + the append-only revision timeline + Service Done lock + removed flag). All values are the real
// cross-tenant aggregate — nothing is fabricated. The status chips drive the query, so each shown total is the real filtered count.

type Row = {
  ticketId: string; ticketNumber: string | null; tenantId: string; tenantName: string | null; status: string;
  customerName: string | null; technicianName: string | null; totalCents: number; version: number;
  serviceDoneLocked: boolean; lockedAt: string | null; createdAt: string; paidAt: string | null; removedAt: string | null;
};
type Detail = Row & { subtotalCents: number; taxCents: number; discountCents: number; tipCents: number; servingStartedAt: string | null; serviceDoneAt: string | null; lockedByUserId: string | null; lockedTotalCents: number | null };
type Line = { serviceName: string; priceCents: number; lineTotalCents: number; technicianName: string | null; status: string; isAddOn: boolean };
type Rev = { version: number; action: string; serviceLineId: string | null; actorUserId: string | null; actorRole: string | null; before: any; after: any; summary: string | null; createdAt: string };

const STATUS_TONE: Record<string, string> = { serving: '#3C7FB6', service_done: '#A96F22', paid: '#3E8F57', cancelled: '#B85B4D', open: '#7B5BB6', voided: '#8A8175' };
const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const CHIPS: { v: string; l: string }[] = [{ v: '', l: 'All' }, { v: 'serving', l: 'Serving' }, { v: 'service_done', l: 'Service Done' }, { v: 'paid', l: 'Paid' }, { v: 'cancelled', l: 'Cancelled' }];
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymdLocal(d); };
const DATE_PRESETS: { l: string; range: () => [string, string] }[] = [
  { l: 'Today', range: () => [ymdLocal(new Date()), ymdLocal(new Date())] },
  { l: '7d', range: () => [daysAgo(6), ymdLocal(new Date())] },
  { l: '30d', range: () => [daysAgo(29), ymdLocal(new Date())] },
];

function Badge({ status }: { status: string }) {
  const c = STATUS_TONE[status] || '#7B5BB6';
  return <span style={{ fontSize: 10.5, fontWeight: 800, color: c, background: c + '1A', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{label(status)}</span>;
}

export function TicketOversightScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const pageSize = 25;
  const debounce = useRef<any>(null);

  const load = useEventCallback((p = page, st = status, q = search, df = dateFrom, dt = dateTo) => {
    setError(null);
    (superAdminApi.tickets({ page: p, pageSize, status: st || undefined, search: q || undefined, dateFrom: df || undefined, dateTo: dt || undefined }) as Promise<any>)
      .then((r) => { setRows(r.tickets || []); setTotal(Number(r.total || 0)); })
      .catch((e: any) => setError(e?.message || 'Couldn’t load tickets. Retry, or check the platform API.'));
  });

  // `load` reads the current status/search/date filters itself (its defaults), so each effect fires only on the filter it watches.
  useEffect(() => { load(1); setPage(1); }, [status, load]);
  useEffect(() => { load(1); setPage(1); }, [dateFrom, dateTo, load]);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { load(1); setPage(1); }, 350);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [search, load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => { const np = Math.min(totalPages, Math.max(1, p)); setPage(np); load(np, status, search); };

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="phead" style={{ alignItems: 'flex-start' }}>
        <div className="vh">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Ticket Oversight
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#D09A36" stroke="#D09A36" strokeWidth="1.5" aria-hidden><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" /></svg>
          </h1>
          <div className="sub">Read-only, platform-wide view of every ticket and its full revision history across all tenants. Removed tickets remain searchable and are flagged.</div>
        </div>
      </div>

      {/* honest stat strip — the active filter's real total drives this */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label={status ? `${label(status)} Tickets` : 'Total Tickets'} value={total.toLocaleString()} />
        <Stat label="Showing" value={`${rows?.length ?? 0}`} />
        <Stat label="Page" value={`${page} / ${totalPages}`} />
      </div>

      {/* filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CHIPS.map((c) => (
            <button key={c.v} onClick={() => setStatus(c.v)} className="btn ghost" style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 700, ...(status === c.v ? { background: 'var(--grad,#A96F22)', color: '#2C2118', borderColor: 'transparent' } : {}) }}>{c.l}</button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket #, customer, technician, or tenant…" style={{ flex: 1, minWidth: 220, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card,#fff)', fontSize: 12.5 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>Created</span>
          {DATE_PRESETS.map((p) => { const [f, t] = p.range(); const on = dateFrom === f && dateTo === t; return <button key={p.l} onClick={() => { setDateFrom(f); setDateTo(t); }} className="btn ghost" style={{ height: 28, padding: '0 9px', fontSize: 11, fontWeight: 700, ...(on ? { background: 'var(--grad,#A96F22)', color: '#2C2118', borderColor: 'transparent' } : {}) }}>{p.l}</button>; })}
          <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} aria-label="Created from" style={{ height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card,#fff)', fontSize: 12 }} />
          <span style={{ color: 'var(--muted)' }}>–</span>
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} aria-label="Created to" style={{ height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card,#fff)', fontSize: 12 }} />
          {(dateFrom || dateTo) ? <button className="btn ghost" style={{ height: 30, padding: '0 8px', fontSize: 11 }} onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button> : null}
        </div>
      </div>

      {/* table */}
      <section className="panel" style={{ padding: 0, minHeight: 0 }}>
        {error ? (
          <div className="state" style={{ padding: 24, fontSize: 12.5 }}>{error} <button className="btn ghost" style={{ marginLeft: 8, height: 26 }} onClick={() => load()}>Retry</button></div>
        ) : rows == null ? (
          <div className="state" style={{ padding: 24, fontSize: 12.5 }}>Loading tickets…</div>
        ) : rows.length === 0 ? (
          <div className="state" style={{ padding: 24, fontSize: 12.5 }}>No tickets match this filter.</div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                {['Ticket', 'Tenant', 'Status', 'Customer', 'Technician', 'Total', 'Ver', 'Flags', 'Created'].map((h) => <th key={h} style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticketId} onClick={() => setSelected(r)} role="button" tabIndex={0} title="View ticket history" style={{ cursor: 'pointer', borderBottom: '1px solid var(--line)', opacity: r.removedAt ? 0.62 : 1 }}>
                    <td style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.ticketNumber || r.ticketId.slice(0, 8)}</td>
                    <td style={{ padding: '9px 12px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tenantName || '—'}</td>
                    <td style={{ padding: '9px 12px' }}><Badge status={r.status} /></td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{r.customerName || '—'}</td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{r.technicianName || '—'}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(r.totalCents)}</td>
                    <td style={{ padding: '9px 12px', color: 'var(--muted)' }}>v{r.version}</td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      {r.serviceDoneLocked ? <span title="Service Done locked" style={{ fontSize: 10.5, fontWeight: 800, color: '#A96F22', background: '#A96F221A', borderRadius: 999, padding: '2px 8px', marginRight: 4 }}>🔒 Locked</span> : null}
                      {r.removedAt ? <span title="Removed from active workflows" style={{ fontSize: 10.5, fontWeight: 800, color: '#B85B4D', background: '#B85B4D1A', borderRadius: 999, padding: '2px 8px' }}>Removed</span> : null}
                      {!r.serviceDoneLocked && !r.removedAt ? <span className="muted">—</span> : null}
                    </td>
                    <td style={{ padding: '9px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{dd(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* pagination */}
      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
          <div className="muted">{total.toLocaleString()} ticket{total === 1 ? '' : 's'}{status ? ` · ${label(status)}` : ''}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" style={{ height: 30 }} disabled={page <= 1} onClick={() => go(page - 1)}>Prev</button>
            <button className="btn ghost" style={{ height: 30 }} disabled={page >= totalPages} onClick={() => go(page + 1)}>Next</button>
          </div>
        </div>
      )}

      {selected && <TicketHistoryDrawer row={selected} onClose={() => setSelected(null)} onRemoved={() => { load(); setSelected((s) => (s ? { ...s, removedAt: new Date().toISOString() } : s)); }} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ padding: '12px 16px', minWidth: 150 }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line)' }}><span className="muted" style={{ fontSize: 11.5 }}>{k}</span><span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{v}</span></div>;
}

function TicketHistoryDrawer({ row, onClose, onRemoved }: { row: Row; onClose: () => void; onRemoved: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [revs, setRevs] = useState<Rev[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (superAdminApi.ticketHistory(row.ticketId) as Promise<any>)
      .then((r) => { if (!alive) return; setDetail(r.ticket); setLines(r.lines || []); setRevs(r.revisions || []); })
      .catch((e: any) => { if (alive) setErr(e?.message || 'Couldn’t load ticket history.'); });
    return () => { alive = false; };
  }, [row.ticketId]);

  const d = detail;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ticket history" style={{ width: 'min(460px, 94vw)', height: '100vh', background: 'var(--card, #fff)', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>{row.ticketNumber || row.ticketId.slice(0, 8)} <Badge status={row.status} />{row.removedAt ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#B85B4D', background: '#B85B4D1A', borderRadius: 999, padding: '2px 8px' }}>Removed</span> : null}</div>
            <div className="muted" style={{ fontSize: 11 }}>{row.tenantName || '—'} · read-only oversight</div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {err ? <div className="state" style={{ fontSize: 12.5 }}>{err}</div> : !d ? <div className="state" style={{ fontSize: 12.5 }}>Loading history…</div> : (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)', margin: '2px 0 6px' }}>Snapshot</div>
              <Field k="Status" v={<Badge status={d.status} />} />
              <Field k="Customer" v={d.customerName || '—'} />
              <Field k="Technician" v={d.technicianName || '—'} />
              <Field k="Subtotal" v={money(d.subtotalCents)} />
              <Field k="Discount" v={money(d.discountCents)} />
              <Field k="Tax" v={money(d.taxCents)} />
              <Field k="Tip" v={money(d.tipCents)} />
              <Field k="Total" v={<b>{money(d.totalCents)}</b>} />
              <Field k="Version" v={`v${d.version}`} />
              <Field k="Created" v={dt(d.createdAt)} />
              <Field k="Serving started" v={dt(d.servingStartedAt)} />
              <Field k="Service done" v={dt(d.serviceDoneAt)} />
              <Field k="Paid" v={dt(d.paidAt)} />
              {d.serviceDoneLocked && <Field k="Locked" v={`${dt(d.lockedAt)}${d.lockedTotalCents != null ? ` · ${money(d.lockedTotalCents)}` : ''}`} />}
              {d.removedAt && <Field k="Removed" v={dt(d.removedAt)} />}

              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)', margin: '14px 0 6px' }}>Service Lines</div>
              {lines.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No service lines.</div> : lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.serviceName}{l.isAddOn ? <span className="muted" style={{ fontWeight: 600 }}> · add-on</span> : ''}</div><div className="muted" style={{ fontSize: 11 }}>{l.technicianName || '—'} · {label(l.status)}</div></div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{money(l.lineTotalCents)}</div>
                </div>
              ))}

              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)', margin: '14px 0 6px' }}>Revision Timeline</div>
              {revs.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No revisions recorded. <NotConnected>append-only</NotConnected></div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {revs.map((rv, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ width: 30, flexShrink: 0, textAlign: 'center' }}><span style={{ fontSize: 10.5, fontWeight: 800, color: '#A96F22' }}>v{rv.version}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label(rv.action)}</div>
                        {rv.summary ? <div className="muted" style={{ fontSize: 11.5 }}>{rv.summary}</div> : null}
                        <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>{dt(rv.createdAt)}{rv.actorRole ? ` · ${rv.actorRole}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!d.removedAt && <RemovalPanel ticketId={row.ticketId} onRemoved={onRemoved} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RemovalPanel({ ticketId, onRemoved }: { ticketId: string; onRemoved: () => void }) {
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'gen' | 'reveal' | 'remove' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const gen = async () => {
    setBusy('gen'); setErr(null); setMsg(null);
    try { await superAdminApi.generateDeletionCode(ticketId); setArmed(true); setMsg('Authorization code generated and encrypted. Reveal it or enter it below.'); }
    catch (e: any) { setErr(e?.message || 'Couldn’t generate the code.'); } finally { setBusy(null); }
  };
  const reveal = async () => {
    setBusy('reveal'); setErr(null);
    try { const r = await superAdminApi.revealDeletionCode(ticketId); setRevealed(r.code); }
    catch (e: any) { setErr(e?.message || 'Couldn’t reveal the code.'); } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy('remove'); setErr(null); setMsg(null);
    try { await superAdminApi.removeTicket(ticketId, { code: code.trim(), reason: reason.trim() }); setDone(true); onRemoved(); }
    catch (e: any) { setErr(e?.message || 'Couldn’t remove the ticket.'); } finally { setBusy(null); }
  };

  const canRemove = armed && /^\d{6}$/.test(code.trim()) && reason.trim().length >= 5 && busy == null;

  if (done) return (
    <div style={{ marginTop: 16, border: '1px solid #3E8F5755', background: '#3E8F570F', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: '#2F6F44' }}>Ticket removed</div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Removed from active workflows and recorded in the permanent revision timeline. Financial and audit records are preserved; the ticket remains searchable here, flagged as Removed.</div>
    </div>
  );

  return (
    <div style={{ marginTop: 16, border: '1px solid #B85B4D55', background: '#B85B4D0D', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, color: '#9A3F32', textTransform: 'uppercase', letterSpacing: 0.4 }}>Danger Zone · Remove Ticket</div>
      <div className="muted" style={{ fontSize: 11.5, margin: '4px 0 10px' }}>Logical removal only — receipts, payments, payroll, tax and audit records are never destroyed. Requires a six-digit authorization code and a reason; the reveal and removal are audited.</div>
      {!armed ? (
        <button className="btn ghost" disabled={busy != null} onClick={gen} style={{ height: 32, borderColor: '#B85B4D80', color: '#9A3F32' }}>{busy === 'gen' ? 'Generating…' : 'Generate authorization code'}</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" disabled={busy != null} onClick={reveal} style={{ height: 30 }}>{busy === 'reveal' ? 'Revealing…' : 'Reveal code'}</button>
            {revealed && <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 18, letterSpacing: 3, color: '#9A3F32', background: '#fff', border: '1px solid #B85B4D55', borderRadius: 8, padding: '3px 12px' }}>{revealed}</span>}
            {revealed && <span className="muted" style={{ fontSize: 10.5 }}>(audited)</span>}
          </div>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Enter 6-digit code" style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card,#fff)', fontSize: 14, letterSpacing: 2, fontFamily: 'ui-monospace, monospace' }} />
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for removal (required, recorded in the audit)" rows={2} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card,#fff)', fontSize: 12.5, resize: 'vertical' }} />
          <button className="btn" disabled={!canRemove} onClick={remove} style={{ height: 34, background: canRemove ? '#B85B4D' : undefined, color: canRemove ? '#fff' : undefined, borderColor: 'transparent', fontWeight: 800 }}>{busy === 'remove' ? 'Removing…' : 'Remove ticket'}</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 11.5, color: '#2F6F44', marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 11.5, color: '#9A3F32', marginTop: 8 }}>{err}</div>}
    </div>
  );
}
