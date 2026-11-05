// HardwareScreen.tsx — Hardware Package Tracker (spec §8): the free iMac / Clover Flex / check-in display offer.
// Status pipeline (delivered/activated stamp timestamps server-side), serials, agreement + payment-setup state,
// tenant assignment.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const STATUSES = ['not_started', 'pending_approval', 'ordered', 'ready', 'delivered', 'installed', 'activated', 'on_hold', 'cancelled'];
const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
// Status badge colour (matches the spec's status palette over the real pipeline vocabulary).
const hwStatusBadge = (s: string): { bg: string; fg: string } => {
  const v = (s || '').toLowerCase();
  if (/installed|activated|complete|ready/.test(v)) return { bg: '#EAF5EE', fg: '#3E8F57' };   // green
  if (/delivered/.test(v)) return { bg: '#EFE9FB', fg: '#7B5BB6' };                              // purple/blue
  if (/ordered|shipped/.test(v)) return { bg: '#EAF2FB', fg: '#3C7FB6' };                        // blue
  if (/pending|processing/.test(v)) return { bg: '#FFF6E5', fg: '#D09A36' };                     // amber
  if (/on_hold|hold/.test(v)) return { bg: '#FBF0E5', fg: '#C77A2A' };                           // orange
  if (/cancel|return/.test(v)) return { bg: '#FBEFE9', fg: '#B85B4D' };                          // red
  return { bg: '#EEEAE3', fg: '#8A8076' };                                                       // gray (not_started)
};
// Payment-setup badge colour.
const paySetupBadge = (s: string): { bg: string; fg: string } => {
  const v = (s || '').toLowerCase();
  if (/complete|paid/.test(v)) return { bg: '#EAF5EE', fg: '#3E8F57' };
  if (/in_progress|partial|financ/.test(v)) return { bg: '#FBF0E5', fg: '#C77A2A' };
  return { bg: '#FBEFE9', fg: '#B85B4D' };   // pending/unpaid → red
};

export function HardwareScreen() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenantId') || '';
  const fromDashboard = params.get('source') === 'tenants-salons-dashboard';
  const [tab, setTab] = useState(params.get('status') && STATUSES.includes(params.get('status')!) ? params.get('status')! : '');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    superAdminApi.hardware({ ...(tab ? { status: tab } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(tenantId ? { tenantId } : {}) })
      .then((r: any) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load hardware packages.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [tab, search, tenantId]);
  const clearTenant = () => { const p = new URLSearchParams(params); p.delete('tenantId'); p.delete('source'); setParams(p, { replace: true }); };

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr(null);
    try { await fn(); load(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const save = (id: string, patch: any) => act('save', () => superAdminApi.updateHardware(id, patch).then(() => { setOpenId(null); setEdit({}); }));

  return (
    <div className="work">
      <div className="vh" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><h1>Hardware Packages</h1><div className="sub">Manage tenant hardware orders, shipping, installation, payment status, and device assignments · {total} total{fromDashboard ? ' · from Tenants / Salons' : ''}</div></div>
        <input
          placeholder="Search iMac color, serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', minWidth: 240, height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
        />
        <button className="btn" disabled={!!busy} onClick={() => act('new', () => superAdminApi.createHardware(tenantId ? { tenant_id: tenantId } : {}))}>+ New Package</button>
      </div>
      {tenantId ? (
        <div className="toast" style={{ background: '#FBF5E9', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'default' }}>
          <span>Filtered to tenant <b>{tenantId.slice(0, 8)}…</b></span>
          <button className="linkbtn" onClick={clearTenant}>Clear</button>
        </div>
      ) : null}
      <div className="tabs">
        <button className={'tab' + (tab === '' ? ' on' : '')} onClick={() => setTab('')}>All</button>
        {STATUSES.map((s) => <button key={s} className={'tab' + (tab === s ? ' on' : '')} onClick={() => setTab(s)}>{label(s)}</button>)}
      </div>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      {loading ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No hardware packages{tab ? ` in "${label(tab)}"` : ''}{tenantId ? ' for this tenant' : ''}. Approving a tenant application opens one automatically.</div> : (
        <section className="panel">
          <div className="list" style={{ maxHeight: 'none' }}>
            {rows.map((h) => (
              <div key={h.id}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{h.tenant_id ? `Tenant ${String(h.tenant_id).slice(0, 8)}…` : h.application_id ? `Application ${String(h.application_id).slice(0, 8)}…` : 'Unassigned'} <span className="muted">· iMac: {h.imac_color || '—'}</span></div>
                    <div className="s">iMac {h.imac_serial || 'no serial'} · Flex {h.clover_flex_serial || 'no serial'} · Display {h.checkin_display_serial || 'no serial'} · agreement {h.agreement_status} · payment {h.payment_setup_status}{h.delivered_at ? ` · delivered ${new Date(h.delivered_at).toLocaleDateString()}` : ''}{h.activated_at ? ` · activated ${new Date(h.activated_at).toLocaleDateString()}` : ''}</div>
                  </div>
                  <span className="badge" style={{ marginLeft: 'auto', ...hwStatusBadge(h.status) }}>{label(h.status)}</span>
                  <span className="badge" style={{ marginLeft: 6, ...paySetupBadge(h.payment_setup_status) }}>pay: {label(h.payment_setup_status || 'pending')}</span>
                  <button className="btn ghost" onClick={() => { setOpenId(openId === h.id ? null : h.id); setEdit({}); }}>{openId === h.id ? 'Close' : 'Update'}</button>
                </div>
                {openId === h.id ? (
                  <div className="panel" style={{ margin: '8px 0 10px', background: '#FFFDF8' }}>
                    <div className="fieldrow" style={{ marginBottom: 10 }}>
                      <select value={edit.status ?? h.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                      <select value={edit.agreement_status ?? h.agreement_status} onChange={(e) => setEdit({ ...edit, agreement_status: e.target.value })}>{['pending', 'sent', 'signed'].map((s) => <option key={s} value={s}>agreement: {s}</option>)}</select>
                      <select value={edit.payment_setup_status ?? h.payment_setup_status} onChange={(e) => setEdit({ ...edit, payment_setup_status: e.target.value })}>{['pending', 'in_progress', 'complete'].map((s) => <option key={s} value={s}>payment: {s}</option>)}</select>
                    </div>
                    <div className="fieldrow" style={{ marginBottom: 10 }}>
                      <input placeholder="Assign tenant id" value={edit.tenant_id ?? h.tenant_id ?? ''} onChange={(e) => setEdit({ ...edit, tenant_id: e.target.value })} style={{ minWidth: 220 }} />
                      <input placeholder="iMac color" value={edit.imac_color ?? h.imac_color ?? ''} onChange={(e) => setEdit({ ...edit, imac_color: e.target.value })} style={{ width: 130 }} />
                      <input placeholder="iMac serial" value={edit.imac_serial ?? h.imac_serial ?? ''} onChange={(e) => setEdit({ ...edit, imac_serial: e.target.value })} />
                      <input placeholder="Clover Flex serial" value={edit.clover_flex_serial ?? h.clover_flex_serial ?? ''} onChange={(e) => setEdit({ ...edit, clover_flex_serial: e.target.value })} />
                      <input placeholder="Check-in display serial" value={edit.checkin_display_serial ?? h.checkin_display_serial ?? ''} onChange={(e) => setEdit({ ...edit, checkin_display_serial: e.target.value })} />
                    </div>
                    <div className="fieldrow">
                      <button className="btn" disabled={busy === 'save'} onClick={() => save(h.id, edit)}>{busy === 'save' ? 'Saving…' : 'Save Changes'}</button>
                      {h.status !== 'delivered' && h.status !== 'activated' ? <button className="btn ghost" disabled={!!busy} onClick={() => save(h.id, { status: 'delivered' })}>Mark Delivered</button> : null}
                      {h.status !== 'activated' ? <button className="btn ghost" disabled={!!busy} onClick={() => save(h.id, { status: 'activated' })}>Mark Activated</button> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
