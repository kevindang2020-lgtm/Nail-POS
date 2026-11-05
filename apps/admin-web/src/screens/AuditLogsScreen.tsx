// AuditLogsScreen.tsx — platform-wide audit trail reader (spec §18). Filters: action (substring), entity/module,
// tenant id, date range; paged 50/page newest-first. Reads the same audit_logs every module writes — including every
// action taken in this console.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

export function AuditLogsScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // The overview's filter bar hands its search over in the URL (?action=…); the other keys are the ones this browser filters on.
  const [sp] = useSearchParams();
  const [f, setF] = useState<any>(() => Object.fromEntries(['action', 'entityType', 'tenantId', 'from', 'to'].map((k) => [k, sp.get(k) ?? '']).filter(([, v]) => v)));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // load takes explicit overrides: Apply/Clear were calling a stale closure (old filters / old page) via setState +
  // setTimeout, so "Clear" silently re-sent the previous filters and "Apply" could request a stale page (bug #13).
  const load = (filters: Record<string, any> = f, p: number = page) => {
    setLoading(true);
    superAdminApi.auditLogs({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: p, pageSize: 50 })
      .then((r: any) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load audit logs.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page]);
  const pages = Math.max(1, Math.ceil(total / 50));

  // One-tap filters for the highest-traffic action families (each just sets the `action` substring and applies). Makes
  // the console's own gated actions — support access, user management, sessions, invites, merges, privacy — discoverable
  // without typing. Toggling an active chip clears it.
  const QUICK: { label: string; q: string }[] = [
    { label: 'Support access', q: 'support_access' },
    { label: 'User mgmt', q: 'super_admin_user_' },
    { label: 'Sessions', q: 'session_revoked' },
    { label: 'Invites', q: 'invit' },
    { label: 'Merges', q: 'merged' },
    { label: 'Privacy', q: 'privacy' },
  ];
  const applyQuick = (q: string) => { const next = { ...f, action: f.action === q ? '' : q }; setF(next); setPage(1); load(next, 1); };

  return (
    <div className="work" style={{ display: 'grid', gridTemplateRows: 'auto auto auto auto minmax(0,1fr) auto', height: '100%' }}>
      <div className="vh"><h1>Audit Logs</h1><div className="sub">Every important platform action · {total} entries</div></div>
      <div className="fieldrow" style={{ margin: '12px 0 6px', flexWrap: 'wrap', gap: 6 }}>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 11.5 }}>Quick filters:</span>
        {QUICK.map((c) => (
          <button key={c.q} className="btn ghost" onClick={() => applyQuick(c.q)} style={f.action === c.q ? { background: 'var(--g7,#F97316)', color: '#fff', borderColor: 'transparent' } : undefined}>{c.label}</button>
        ))}
      </div>
      <div className="fieldrow" style={{ margin: '0 0 12px' }}>
        <input placeholder="Action contains… (e.g. support_access)" value={f.action || ''} onChange={(e) => setF({ ...f, action: e.target.value })} style={{ minWidth: 220 }} />
        <input placeholder="Module / entity type" value={f.entityType || ''} onChange={(e) => setF({ ...f, entityType: e.target.value })} />
        <input placeholder="Tenant id" value={f.tenantId || ''} onChange={(e) => setF({ ...f, tenantId: e.target.value })} />
        <input type="date" value={f.from || ''} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input type="date" value={f.to || ''} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <button className="btn" onClick={() => { setPage(1); load(f, 1); }}>Apply Filters</button>
        <button className="btn ghost" onClick={() => { setF({}); setPage(1); load({}, 1); }}>Clear</button>
      </div>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : <div />}
      <section
        className="panel"
        style={{ minHeight: 0, overflowY: 'auto' }}
      >
        {loading ? (
          <div className="state">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="state">No audit entries match these filters.</div>
        ) : (
          <div className="w-full min-w-0 overflow-x-auto">
            <div className="list min-w-[900px]" style={{ maxHeight: 'none' }}>
              {rows.map((a: any) => (
                <div key={a.id} className="row">
                  <div className="min-w-[900px]">
                    <div className="t mb-2">
                      {a.action_type}{' '}
                      {a.entity_type ? (
                        <span className="pill ml-1.5">{a.entity_type}</span>
                      ) : null}
                    </div>

                    <div className="s">
                      {new Date(a.created_at).toLocaleString()} · {a.role || '—'}
                      {a.user_id
                        ? ` · user ${String(a.user_id).slice(0, 8)}…`
                        : ''}
                      {a.tenant_id
                        ? ` · tenant ${String(a.tenant_id).slice(0, 8)}…`
                        : ' · platform'}
                      {a.entity_id
                        ? ` · ${String(a.entity_id).slice(0, 12)}…`
                        : ''}
                      {a.metadata_json && Object.keys(a.metadata_json).length
                        ? ` · ${JSON.stringify(a.metadata_json).slice(0, 90)}`
                        : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className="fieldrow" style={{ marginTop: 10, justifyContent: 'center' }}>
        <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span className="muted" style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
        <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
