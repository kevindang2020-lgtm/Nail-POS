// LeadsScreen.tsx — Website Leads (spec §11): demo requests / contact / free package / newsletter tabs, status
// actions, Convert to Application (carries contact fields, links back), + Add Lead (also reachable from the header).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const KINDS = [['', 'All'], ['demo_request', 'Demo Requests'], ['contact', 'Contact Messages'], ['free_package', 'Free Package'], ['newsletter', 'Newsletter']] as const;
const STATUSES = ['new', 'contacted', 'demo_scheduled', 'converted_to_application', 'archived', 'spam'];
const label = (s: string) => s.replace(/_/g, ' ');

export function LeadsScreen() {
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const [form, setForm] = useState<any>({ kind: 'contact' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    superAdminApi.leads(kind ? { kind } : {})
      .then((r: any) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load leads.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [kind]);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr(null);
    try { await fn(); load(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const doCreate = () => act('create', async () => {
    await superAdminApi.createLead(form);
    setForm({ kind: 'contact' }); setCreateOpen(false);
    if (params.get('create')) { params.delete('create'); setParams(params, { replace: true }); }
  });

  return (
    <div className="work">
      <div className="vh" style={{ display: 'flex', alignItems: 'center' }}>
        <div><h1>Website Leads</h1><div className="sub">Demo requests, contact messages, free-package applications · {total} total</div></div>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setCreateOpen((v) => !v)}>{createOpen ? 'Close' : '+ Add Lead'}</button>
      </div>
      {createOpen ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="fieldrow">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input placeholder="Name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Salon" value={form.salon_name || ''} onChange={(e) => setForm({ ...form, salon_name: e.target.value })} />
            <input placeholder="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input placeholder="Email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="City" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input placeholder="State" value={form.state || ''} onChange={(e) => setForm({ ...form, state: e.target.value })} style={{ width: 90 }} />
            <button className="btn" disabled={busy === 'create'} onClick={doCreate}>{busy === 'create' ? 'Saving…' : 'Save Lead'}</button>
          </div>
        </section>
      ) : null}
      <div className="tabs">{KINDS.map(([k, l]) => <button key={k} className={'tab' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}</div>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      {loading ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No leads here yet. Website forms will create them automatically.</div> : (
        <section className="panel">
          <div className="list" style={{ maxHeight: 'none' }}>
            {rows.map((l) => (
              <div key={l.id} className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="t">{l.name || '—'} {l.salon_name ? <span className="muted">· {l.salon_name}</span> : null} <span className="pill" style={{ marginLeft: 6 }}>{label(l.kind)}</span></div>
                  <div className="s">{[l.city, l.state].filter(Boolean).join(', ')} · {l.phone || '—'} · {l.email || '—'}{l.source_page ? ` · from ${l.source_page}` : ''}{l.message ? ` · “${String(l.message).slice(0, 80)}”` : ''}</div>
                </div>
                <span className="pill" style={{ marginLeft: 'auto' }}>{label(l.status)}</span>
                {l.status === 'new' ? <button className="btn ghost" disabled={!!busy} onClick={() => act('c' + l.id, () => superAdminApi.leadStatus(l.id, 'contacted'))}>Mark Contacted</button> : null}
                {l.status !== 'converted_to_application' && l.status !== 'spam' ? <button className="btn" disabled={!!busy} onClick={() => act('v' + l.id, () => superAdminApi.leadConvert(l.id))}>Convert to Application</button> : null}
                {l.status !== 'spam' && l.status !== 'converted_to_application' ? <button className="btn ghost" disabled={!!busy} onClick={() => act('s' + l.id, () => superAdminApi.leadStatus(l.id, 'spam'))}>Spam</button> : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
