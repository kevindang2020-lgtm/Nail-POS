// System Operations → Capacity — BUILD_PLAN Phase 11 (Constitution 4 §35/§113 noisy neighbour, §96/§171 cost,
// §160 quotas, §173–175 webhooks).
//   • Load: the 10 salons using the most database time over the window, their share, slow queries; a banner when one
//     salon is over half the platform's load (the same rule that raises the alert).
//   • Cost: daily estimates per provider and per salon from the usage ledgers × the unit prices set here. A price never
//     set is shown as UNKNOWN — the page never fills in a number of its own. Editing prices needs a reason (+ step-up).
//   • Quotas: look up a salon's effective limits (and where each comes from) and set its override (reason + step-up).
//   • Webhooks: received / verified / rejected / duplicate / processed per provider (this API process since start).
// §332 no fake green: a section that fails to load says so; it never shows zeros for a failed read.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

type LoadRow = { tenantId: string; tenantName: string | null; requests: number; dbMs: number; slowQueries: number; requestShare: number; dbShare: number };
export type Load = { windowMinutes: number; totals: { requests: number; dbMs: number; activeTenants: number }; top: LoadRow[]; dominant: LoadRow | null };
type Agg = { quantity: number; estimatedMicros: number; unknownQuantity: number; status: 'ESTIMATED' | 'PARTIAL' | 'UNKNOWN' };
export type Cost = { from: string; to: string; days: number; prices: { key: string; label: string; usd: number; unknown: boolean }[];
  perProvider: (Agg & { provider: string; unit: string })[]; perTenant: (Agg & { tenantId: string; tenantName: string | null })[]; note: string };
type Webhooks = { since: string; scope: string; providers: { provider: string; received: number; verified: number; rejected: number; duplicate: number; processed: number }[] };
type Quota = { tenantId: string; tenantName: string | null; limits: { kind: string; limit: number | null; source: string }[]; usage: Record<string, number> };

const pct = (x: number) => `${Math.round(x * 100)}%`;
export const usd = (micros: number) => `$${(micros / 1e6).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)}`;
export const costCell = (a: Agg) => (a.status === 'UNKNOWN' ? 'Unknown — no price set' : a.status === 'PARTIAL' ? `${usd(a.estimatedMicros)} + unknown part` : usd(a.estimatedMicros));
const EDITABLE = ['api_requests_per_min', 'jobs_in_flight', 'storage_bytes'];

function useLoad<T>(path: string): [T | 'failed' | null, () => void] {
  const [v, setV] = useState<T | 'failed' | null>(null);
  const load = useCallback(() => { api.get<T>(path).then(setV).catch(() => setV('failed')); }, [path]);
  useEffect(load, [load]);
  return [v, load];
}

export function SystemOpsCapacity() {
  const [load] = useLoad<Load>('/super-admin/system/load');
  const [cost, reloadCost] = useLoad<Cost>('/super-admin/system/cost');
  const [hooks] = useLoad<Webhooks>('/super-admin/system/webhooks');
  const [prices, setPrices] = useState<Record<string, string> | null>(null);
  const [priceReason, setPriceReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [quota, setQuota] = useState<Quota | 'failed' | null>(null);
  const [qEdit, setQEdit] = useState<Record<string, string>>({});
  const [qReason, setQReason] = useState('');

  const savePrices = async () => {
    if (!prices) return; setMsg(null);
    try {
      await api.put('/super-admin/system/cost/prices', { prices: Object.entries(prices).map(([key, v]) => ({ key, usd: Number(v) })), reason: priceReason.trim() });
      setPrices(null); setPriceReason(''); reloadCost();
    } catch (e: any) { setMsg(e?.message || 'Could not save the prices.'); }
  };
  const lookup = async () => { setQuota(null); try { const q = await api.get<Quota>(`/super-admin/system/quotas/tenants/${encodeURIComponent(tenantId.trim())}`); setQuota(q); setQEdit({}); } catch { setQuota('failed'); } };
  const saveQuota = async () => {
    if (!quota || quota === 'failed') return; setMsg(null);
    const body: Record<string, unknown> = { reason: qReason.trim() };
    for (const k of EDITABLE) body[k] = qEdit[k] === undefined ? (quota.limits.find((l) => l.kind === k && l.source === 'tenant')?.limit ?? null) : qEdit[k] === '' ? null : Number(qEdit[k]);
    try { setQuota(await api.put<Quota>(`/super-admin/system/quotas/tenants/${encodeURIComponent(quota.tenantId)}`, body)); setQReason(''); setQEdit({}); }
    catch (e: any) { setMsg(e?.message || 'Could not save the quota.'); }
  };

  return (
    <div data-testid="capacity">
      {msg ? <div className="err" role="alert">{msg}</div> : null}
      <h2>Load by salon</h2>
      <div data-testid="load-section">
        {load === null ? <div className="state">Loading…</div> : load === 'failed' ? <div className="err" data-testid="load-failed">Could not load per-salon load — this is not the same as "no load".</div> : (
          <>
            {load.dominant ? <div className="err" role="alert" data-testid="noisy-banner">{load.dominant.tenantName ?? load.dominant.tenantId} is {pct(Math.max(load.dominant.dbShare, load.dominant.requestShare))} of platform load over the last {load.windowMinutes} minutes.</div> : null}
            <div className="sub">{load.totals.activeTenants} active salons · {load.totals.requests.toLocaleString()} requests · {Math.round(load.totals.dbMs / 1000).toLocaleString()} s database time · last {load.windowMinutes} min</div>
            <table className="tbl"><thead><tr><th>Salon</th><th>Requests</th><th>DB time</th><th>Share of DB</th><th>Slow queries</th></tr></thead>
              <tbody>{load.top.length === 0 ? <tr><td colSpan={5}>No salon traffic in this window.</td></tr> : load.top.map((r) => (
                <tr key={r.tenantId}><td>{r.tenantName ?? r.tenantId}</td><td>{r.requests.toLocaleString()} ({pct(r.requestShare)})</td><td>{Math.round(r.dbMs / 1000)} s</td><td>{pct(r.dbShare)}</td><td>{r.slowQueries}</td></tr>))}</tbody></table>
          </>
        )}
      </div>

      <h2>Cost estimates</h2>
      <div data-testid="cost-section">
        {cost === null ? <div className="state">Loading…</div> : cost === 'failed' ? <div className="err" data-testid="cost-failed">Could not load cost estimates.</div> : (
          <>
            <div className="sub">{cost.from} – {cost.to} · {cost.note}</div>
            <table className="tbl"><thead><tr><th>Provider</th><th>Quantity</th><th>Estimate</th></tr></thead>
              <tbody>{cost.perProvider.map((p) => <tr key={`${p.provider}|${p.unit}`}><td>{p.provider}</td><td>{p.quantity.toLocaleString()} {p.unit}</td><td data-testid={`cost-${p.provider}`}>{costCell(p)}</td></tr>)}</tbody></table>
            <table className="tbl"><thead><tr><th>Salon</th><th>Estimate</th></tr></thead>
              <tbody>{cost.perTenant.slice(0, 10).map((t) => <tr key={t.tenantId}><td>{t.tenantName ?? t.tenantId}</td><td>{costCell(t)}</td></tr>)}</tbody></table>
            {prices === null ? <button className="btn ghost" onClick={() => setPrices(Object.fromEntries(cost.prices.map((p) => [p.key, String(p.usd)])))}>Unit prices…</button> : (
              <div className="panel" data-testid="price-editor">
                {cost.prices.map((p) => <label key={p.key} style={{ display: 'block' }}>{p.label} (USD) <input aria-label={p.key} type="number" min={0} step="any" value={prices[p.key] ?? ''} onChange={(e) => setPrices({ ...prices, [p.key]: e.target.value })} /></label>)}
                <input aria-label="Price change reason" placeholder="Reason — e.g. from the provider invoice (required)" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} />
                <button className="btn" disabled={priceReason.trim().length < 10} onClick={savePrices}>Save prices</button>
                <button className="btn ghost" onClick={() => setPrices(null)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </div>

      <h2>Salon quotas</h2>
      <div data-testid="quota-section">
        <input aria-label="Quota salon id" placeholder="Salon (tenant) id" value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ minWidth: 280 }} />
        <button className="btn" disabled={!tenantId.trim()} onClick={lookup}>Look up</button>
        {quota === 'failed' ? <div className="err">That salon's quotas could not be read.</div> : quota ? (
          <>
            <table className="tbl"><thead><tr><th>Quota</th><th>Limit</th><th>From</th><th>Used</th><th>Override</th></tr></thead>
              <tbody>{quota.limits.map((l) => (
                <tr key={l.kind}><td>{l.kind.replace(/_/g, ' ')}</td><td>{l.limit === null ? 'Unlimited' : l.limit.toLocaleString()}</td><td>{l.source}</td><td>{quota.usage[l.kind] ?? '—'}</td>
                  <td>{EDITABLE.includes(l.kind) ? <input aria-label={`Override ${l.kind}`} placeholder="inherit" value={qEdit[l.kind] ?? (l.source === 'tenant' ? String(l.limit) : '')} onChange={(e) => setQEdit({ ...qEdit, [l.kind]: e.target.value })} style={{ width: 120 }} /> : 'set elsewhere'}</td></tr>))}</tbody></table>
            <input aria-label="Quota change reason" placeholder="Reason (required)" value={qReason} onChange={(e) => setQReason(e.target.value)} />
            <button className="btn" disabled={qReason.trim().length < 10} onClick={saveQuota}>Save quota</button>
          </>
        ) : null}
      </div>

      <h2>Provider webhooks</h2>
      <div data-testid="webhooks-section">
        {hooks === null ? <div className="state">Loading…</div> : hooks === 'failed' ? <div className="err">Could not load webhook counters.</div> : (
          <>
            <div className="sub">{hooks.scope}, since {new Date(hooks.since).toLocaleString()} · platform-wide series: aipowersalon_webhook_events_total at /metrics</div>
            <table className="tbl"><thead><tr><th>Provider</th><th>Received</th><th>Verified</th><th>Rejected</th><th>Duplicate</th><th>Processed</th></tr></thead>
              <tbody>{hooks.providers.length === 0 ? <tr><td colSpan={6}>No webhooks received by this process yet.</td></tr> : hooks.providers.map((p) => (
                <tr key={p.provider}><td>{p.provider}</td><td>{p.received}</td><td>{p.verified}</td><td>{p.rejected}</td><td>{p.duplicate}</td><td>{p.processed}</td></tr>))}</tbody></table>
          </>
        )}
      </div>
    </div>
  );
}
