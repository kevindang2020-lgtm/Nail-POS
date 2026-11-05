// UsageLimitsScreen.tsx — per-tenant usage counters (spec: Usage Limits), bound to the CANONICAL tenant_usage_limits
// table (tenant × metric, limit_value/used_value — the same counters tenants/state aggregates). Inline limit edits,
// validated + audited server-side.
import { useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

const METRICS = ['customers', 'technicians', 'ai_calls', 'sms'];

export function UsageLimitsScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({}); // key: tenantId|metric
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    superAdminApi.usageLimits()
      .then((r: any) => { setRows(Array.isArray(r) ? r : []); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load usage limits.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async (tenantId: string, metric: string) => {
    const k = `${tenantId}|${metric}`;
    const raw = (edit[k] ?? '').trim();
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) { setErr('Enter a whole number of 0 or more for the limit.'); return; }
    setBusy(k); setErr(null);
    try { await superAdminApi.setUsageLimit(tenantId, metric, v); setEdit((e) => { const n = { ...e }; delete n[k]; return n; }); load(); }
    catch (e: any) { setErr(e?.message || 'Could not save the limit.'); }
    finally { setBusy(null); }
  };
  const cell = (t: any, metric: string) => {
    const m = (t.metrics || []).find((x: any) => x.metric === metric);
    const k = `${t.tenantId}|${metric}`;
    const pct = m?.limitValue ? Math.min(100, Math.round((m.usedValue / m.limitValue) * 100)) : null;
    return (
      <div key={metric} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="s" style={{ minWidth: 86 }}>{metric.replace('_', ' ')}: <b>{m ? `${m.usedValue}/${m.limitValue}` : '—'}</b>{pct != null ? ` ${pct}%` : ''}</span>
        <input value={edit[k] ?? ''} placeholder={m ? String(m.limitValue) : 'set limit'} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} style={{ width: 92, minHeight: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '6px 8px', fontFamily: 'inherit', background: '#FFFDF8' }} />
        <button className="btn ghost" style={{ minHeight: 40, padding: '6px 10px' }} disabled={busy === k || edit[k] === undefined || edit[k] === ''} onClick={() => save(t.tenantId, metric)}>{busy === k ? '…' : 'Set'}</button>
      </div>
    );
  };

  return (
    <div className="work">
      <div className="vh"><h1>Usage Limits</h1><div className="sub">Per-tenant counters — used vs limit per metric; edits are validated and audit-logged</div></div>
      {err ? <div className="err" style={{ margin: '10px 0' }}>{err}</div> : null}
      {loading ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No tenants yet.</div> : (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="w-full min-w-0 overflow-x-auto">
            <div className="list min-w-[1280px]" style={{ maxHeight: 'none' }}>
            {rows.map((t) => (
              <div key={t.tenantId} className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 180 }}><div className="t">{t.tenantName}</div><div className="s muted">{t.tenantCode}</div></div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginLeft: 'auto' }}>{METRICS.map((m) => cell(t, m))}</div>
              </div>
            ))}
          </div>
          </div>
        </section>
      )}
    </div>
  );
}
