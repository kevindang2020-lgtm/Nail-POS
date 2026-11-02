// Super-Admin → Deals Oversight — BUILD_PLAN Phase 5 (deals_engine).
//
// The marketplace across salons: how many deals are live, what they gave away (net of refunds), what is sitting unpaid
// on tickets, and every deal with filters. Suspending a deal needs a reason (the salon sees it), is audited, and stops it
// everywhere — including deals customers had already booked (bug 17). Per salon: switch deals off (step-up + reason) and
// set the live-deal limit. The platform-wide kill switch is on the Kill Switches panel.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminDealsApi as dApi, type DealsOverview, type AdminDealRow, type DealsTenantRow } from '../api/superAdminDealsApi';

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DealsOversightScreen() {
  const [overview, setOverview] = useState<DealsOverview | 'failed' | null>(null);
  const [rows, setRows] = useState<AdminDealRow[] | 'failed' | null>(null);
  const [tenants, setTenants] = useState<DealsTenantRow[] | 'failed' | null>(null);
  const [f, setF] = useState({ status: '', kind: '', q: '', suspended: false });
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => {
    dApi.overview().then(setOverview).catch(() => setOverview('failed'));
    dApi.list({ ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.q.trim() ? { q: f.q.trim() } : {}), ...(f.suspended ? { suspended: true } : {}) })
      .then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows('failed'));
    dApi.tenants().then((r) => setTenants(Array.isArray(r) ? r : [])).catch(() => setTenants('failed'));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const suspend = (d: AdminDealRow) => ask(`Suspend “${d.title}” at ${d.salonName ?? 'this salon'} — the salon sees this reason. Why?`, (reason) => {
    void dApi.suspend(d.id, reason).then((r) => { setNotice(`Suspended. ${r.releasedPlaces} booked place(s) and ${r.releasedApplications} unpaid ticket(s) no longer carry it.`); load(); })
      .catch((e: any) => setNotice(e?.message || 'Not suspended.'));
  }, { minLength: 12, inputLabel: 'Reason', confirmLabel: 'Suspend deal' });
  const switchTenant = (t: DealsTenantRow) => (t.platformDisabled
    ? ask(`Switch deals back on for ${t.salonName ?? 'this salon'}? Say why.`, (reason) => { void dApi.setTenant(t.tenantId, { disabled: false, reason }).then(() => { setNotice('Deals are on again.'); load(); }).catch((e: any) => setNotice(e?.message || 'Not changed.')); }, { minLength: 8, inputLabel: 'Reason', confirmLabel: 'Switch on' })
    : ask(`Switch deals OFF for ${t.salonName ?? 'this salon'} — nothing will book, apply or show. Why?`, (reason) => { void dApi.setTenant(t.tenantId, { disabled: true, reason }).then(() => { setNotice('Deals switched off for that salon.'); load(); }).catch((e: any) => setNotice(e?.message || 'Not changed.')); }, { minLength: 12, inputLabel: 'Reason', confirmLabel: 'Switch off' }));
  const setLimit = (t: DealsTenantRow) => ask(`Live-deal limit for ${t.salonName ?? 'this salon'} (blank = no limit)`, (v) => {
    const n = v.trim() === '' ? null : Number(v);
    if (n !== null && (!Number.isInteger(n) || n < 0)) { setNotice('The limit is a whole number (or blank for no limit).'); return; }
    void dApi.setTenant(t.tenantId, { maxActiveDeals: n }).then(() => { setNotice('Limit saved.'); load(); }).catch((e: any) => setNotice(e?.message || 'Not saved.'));
  }, { optional: true, inputLabel: 'Limit', confirmLabel: 'Save', defaultValue: t.platformMaxActiveDeals == null ? '' : String(t.platformMaxActiveDeals) });

  const o = overview && overview !== 'failed' ? overview : null;
  const cards: [string, string][] = o ? [['Live deals', String(o.active)], ['Awaiting approval', String(o.pendingApproval)], ['Suspended', String(o.suspended)], ['Redemptions', String(o.totalRedemptions)],
    ['Given (net, all time)', money(o.totalDiscountedCents)], ['Given (30 days)', money(o.discountedLast30DaysCents)], ['Reversed by refunds', String(o.reversedRedemptions)], ['Unpaid on tickets', String(o.openApplications)],
    ['Salons with deals', String(o.tenantsWithDeals)], ['Salons switched off', String(o.tenantsSwitchedOff)]] : [];

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18 }} data-testid="deals-oversight">
      <h1 style={{ margin: 0, fontSize: 22 }}>Deals Oversight</h1>
      {notice && <div role="status" style={{ padding: 10, background: '#F3F0E8', borderRadius: 8 }}>{notice}</div>}
      {askUi}
      {overview === 'failed' ? <div role="alert">Could not load the overview.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {cards.map(([l, v]) => <div key={l} style={{ border: '1px solid #e5e1d8', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: '#6b7280' }}>{l}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{v}</div></div>)}
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 16 }}>Deals</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input aria-label="Search deals" placeholder="Deal or salon" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option>{['active', 'scheduled', 'pending_approval', 'paused', 'sold_out', 'expired', 'canceled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          <select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Any kind</option><option value="deal">Deals</option><option value="coupon">Coupons</option><option value="automatic">Automatic</option><option value="announcement">Announcements</option></select>
          <label><input type="checkbox" aria-label="Suspended only" checked={f.suspended} onChange={(e) => setF({ ...f, suspended: e.target.checked })} /> Suspended only</label>
        </div>
        {rows === 'failed' ? <div role="alert">Could not load deals.</div> : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th align="left">Deal</th><th align="left">Salon</th><th align="left">Kind</th><th align="left">Status</th><th align="right">Redeemed</th><th align="right">Budget</th><th /></tr></thead>
            <tbody>{(rows ?? []).map((d) => (
              <tr key={d.id} data-testid="oversight-deal">
                <td>{d.title}{d.suspendedReason ? <div style={{ color: '#B85B4D', fontSize: 12 }}>Suspended: {d.suspendedReason}</div> : null}</td>
                <td>{d.salonName ?? d.tenantId.slice(0, 8)}</td><td>{d.kind}</td><td>{d.status}</td>
                <td align="right">{d.redemptionCount}{d.maxRedemptions ? ` / ${d.maxRedemptions}` : ''}</td>
                <td align="right">{d.budgetCents ? `${money(d.budgetReservedCents)} / ${money(d.budgetCents)}` : '—'}</td>
                <td>{!d.suspendedAt && !['canceled', 'archived', 'expired'].includes(d.status) ? <button onClick={() => suspend(d)}>Suspend…</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Salons</h2>
        {tenants === 'failed' ? <div role="alert">Could not load salons.</div> : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th align="left">Salon</th><th align="left">Deals</th><th align="left">Policy</th><th align="right">Live</th><th align="right">Limit</th><th align="right">Given (30d)</th><th /></tr></thead>
            <tbody>{(tenants ?? []).map((t) => (
              <tr key={t.tenantId} data-testid="oversight-tenant">
                <td>{t.salonName ?? t.tenantId.slice(0, 8)}</td>
                <td>{t.platformDisabled ? <span style={{ color: '#B85B4D' }}>Off by platform — {t.platformDisabledReason}</span> : t.dealsEnabled ? 'On' : 'Off (salon)'}</td>
                <td>{t.stackingPolicy.replace('_', ' ')}</td><td align="right">{t.activeDeals}</td><td align="right">{t.platformMaxActiveDeals ?? '—'}</td><td align="right">{money(t.discountedLast30DaysCents)}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button onClick={() => switchTenant(t)}>{t.platformDisabled ? 'Switch on…' : 'Switch off…'}</button> <button onClick={() => setLimit(t)}>Limit…</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
