import { useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerTicketsApi, type OwnerTicketListResp, type OwnerTicketHistoryResp } from '../api/ownerApi';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// OwnerTicketOversightScreen — read-only ticket oversight for the owner. The server scopes every row to the session's
// tenant AND this owner's branch access (a passed branchId outside that access is rejected); nothing here can mutate a
// ticket. Tapping a ticket loads its permanent history: the money snapshot, service lines, and the append-only revision
// timeline, plus the Service Done lock + removed flags. All values are real (GET /owner/tickets[/:id/history]).

const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);
const dt = (s: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const CHIPS: { v: string; l: string }[] = [{ v: '', l: 'All' }, { v: 'serving', l: 'Serving' }, { v: 'service_done', l: 'Service Done' }, { v: 'paid', l: 'Paid' }, { v: 'cancelled', l: 'Cancelled' }];
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymdLocal(d); };
const DATE_PRESETS: { l: string; range: () => [string, string] }[] = [
  { l: 'Today', range: () => [ymdLocal(new Date()), ymdLocal(new Date())] },
  { l: '7d', range: () => [daysAgo(6), ymdLocal(new Date())] },
  { l: '30d', range: () => [daysAgo(29), ymdLocal(new Date())] },
];
const statusColor = (s: string) => s === 'paid' ? 'var(--owner-success)' : s === 'cancelled' ? 'var(--owner-danger)' : s === 'service_done' ? 'var(--owner-primary)' : 'var(--owner-text-muted)';
const niceStatus = (s: string) => s.replace(/_/g, ' ');
const actionLabel = (a: string) => a.replace(/_/g, ' ');

function HistoryPanel({ h }: { h: OwnerTicketHistoryResp }) {
  const d = h.ticket;
  return (
    <div className="owner-drill">
      <div className="dh">Ticket {d.ticketNumber || d.ticketId.slice(0, 8)} · {money(d.totalCents)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 10 }}>
        <Field k="Subtotal" v={money(d.subtotalCents)} />
        <Field k="Tax" v={money(d.taxCents)} />
        <Field k="Discount" v={money(d.discountCents)} />
        <Field k="Tip" v={money(d.tipCents)} />
        <Field k="Serving started" v={dt(d.servingStartedAt)} />
        <Field k="Service done" v={dt(d.serviceDoneAt)} />
        <Field k="Paid" v={dt(d.paidAt)} />
        <Field k="Version" v={`v${d.version}`} />
      </div>

      <div className="dh">Service Lines{h.lines.length ? ` (${h.lines.length})` : ''}</div>
      {h.lines.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No service lines recorded.</div>}
      {h.lines.map((l, i) => (
        <div className="owner-drillrow" key={i}>
          <div><div className="nm">{l.serviceName}{l.isAddOn ? ' · add-on' : ''}</div><div className="mt">{l.technicianName || 'Unassigned'} · {niceStatus(l.status)}</div></div>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{money(l.lineTotalCents)}</span>
        </div>
      ))}

      <div className="dh" style={{ marginTop: 10 }}>Revision Timeline{h.revisions.length ? ` (${h.revisions.length})` : ''}</div>
      {h.revisions.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No revisions recorded.</div>}
      {h.revisions.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: i ? '1px solid var(--owner-border)' : 'none' }}>
          <span style={{ fontWeight: 800, fontSize: 11, color: 'var(--owner-primary)', minWidth: 30 }}>v{r.version}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize' }}>{actionLabel(r.action)}{r.actorRole ? <span className="muted" style={{ fontWeight: 400 }}> · {r.actorRole}</span> : null}</div>
            {r.summary ? <div className="muted" style={{ fontSize: 12 }}>{r.summary}</div> : null}
            <div className="muted" style={{ fontSize: 11 }}>{dt(r.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div className="muted" style={{ fontSize: 10.5 }}>{k}</div><div style={{ fontWeight: 600 }}>{v}</div></div>;
}

export function OwnerTicketOversightScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [resp, setResp] = useState<OwnerTicketListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hist, setHist] = useState<OwnerTicketHistoryResp | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    ownerTicketsApi.list({ branchId: effectiveBranchId, status: status || undefined, search: search || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, pageSize })
      .then(setResp)
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to ticket oversight.' : e?.message || 'Unable to load tickets.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status, search, dateFrom, dateTo, page, effectiveBranchId]);
  useEffect(() => { setPage(1); }, [effectiveBranchId]);

  const openHistory = (id: string) => {
    if (openId === id) { setOpenId(null); setHist(null); return; }
    setOpenId(id); setHist(null); setHistErr(null);
    ownerTicketsApi.history(id).then(setHist).catch((e: any) => setHistErr(e?.message || 'Unable to load history.'));
  };
  const submitSearch = () => { setSearch(searchInput.trim()); setPage(1); };

  const tickets = resp?.tickets ?? [];
  const total = resp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Ticket Oversight</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs" style={{ flexWrap: 'wrap' }}>
        {CHIPS.map((c) => (
          <button key={c.v || 'all'} className={`owner-tab ${status === c.v ? 'active' : ''}`} onClick={() => { setStatus(c.v); setPage(1); }}>{c.l}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
        <input className="owner-input" placeholder="Search ticket #, customer, or staff" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }} style={{ flex: 1 }} />
        <button className="owner-btn" onClick={submitSearch}>Search</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px' }}>
        {DATE_PRESETS.map((p) => { const [f, t] = p.range(); const on = dateFrom === f && dateTo === t; return <button key={p.l} className={`owner-tab ${on ? 'active' : ''}`} style={{ flex: 1, fontSize: 12 }} onClick={() => { setDateFrom(f); setDateTo(t); setPage(1); }}>{p.l}</button>; })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 12px' }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Created</span>
        <input className="owner-input" type="date" value={dateFrom} max={dateTo || new Date().toISOString().split('T')[0]} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="Created from" style={{ flex: 1, minWidth: 0 }} />
        <span className="muted">–</span>
        <input className="owner-input" type="date" max={new Date().toISOString().split('T')[0]}  value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="Created to" style={{ flex: 1, minWidth: 0 }} />
        {(dateFrom || dateTo) ? <button className="owner-btn" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>Clear</button> : null}
      </div>

      {loading && !tickets ? (
        <div style={{ padding: '0 16px 24px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div className="owner-chartcard" key={i} style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="owner-skel" style={{ width: 100, height: 16 }} />
                <div className="owner-skel" style={{ width: 60, height: 16 }} />
              </div>
              <div className="owner-skel" style={{ width: '60%', height: 14 }} />
            </div>
          ))}
        </div>
      ) : err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load tickets</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : total === 0 ? (
        <div className="owner-state"><div className="big owner-serif">No tickets found</div><div className="muted">{search || status ? 'Try a different filter or search.' : 'No tickets for this branch yet.'}</div></div>
      ) : (
        <div style={{ padding: '0 16px 24px' }}>
          {tickets.map((t) => (
            <div className="owner-chartcard" key={t.ticketId} style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
              <div className="owner-drillrow" role="button" aria-expanded={openId === t.ticketId} onClick={() => openHistory(t.ticketId)} style={{ padding: 14, cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="nm" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{t.ticketNumber || t.ticketId.slice(0, 8)}</span>
                    {t.serviceDoneLocked ? <span title="Service Done locked" style={{ fontSize: 10, fontWeight: 800, color: 'var(--owner-primary)', background: 'var(--owner-panel)', borderRadius: 999, padding: '2px 7px' }}>🔒 Locked</span> : null}
                    {t.removedAt ? <span title="Removed" style={{ fontSize: 10, fontWeight: 800, color: 'var(--owner-danger)', background: 'var(--owner-panel)', borderRadius: 999, padding: '2px 7px' }}>Removed</span> : null}
                  </div>
                  <div className="mt">{t.customerName || 'Walk-in'} · {t.technicianName || 'Unassigned'} · {dt(t.createdAt)}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{money(t.totalCents)}</div>
                  <span className="owner-statusbadge" style={{ background: 'var(--owner-panel)', color: statusColor(t.status) }}>{niceStatus(t.status)}</span>
                </div>
              </div>
              {openId === t.ticketId && (
                <div style={{ padding: '0 14px 14px' }}>
                  {!hist && !histErr && <div className="muted" style={{ fontSize: 12 }}>Loading history…</div>}
                  {histErr && <div className="muted" style={{ fontSize: 12, color: 'var(--owner-danger)' }}>{histErr}</div>}
                  {hist && <HistoryPanel h={hist} />}
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="owner-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ opacity: page <= 1 ? 0.5 : 1 }}>Prev</button>
            <div className="muted" style={{ fontSize: 12 }}>Page {page} of {totalPages} · {total} ticket{total === 1 ? '' : 's'}</div>
            <button className="owner-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={{ opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}
