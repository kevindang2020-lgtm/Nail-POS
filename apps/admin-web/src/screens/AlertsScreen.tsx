// AlertsScreen.tsx — full Super-Admin Alerts page (opened from Overview → Recent Alerts → View All). Summary KPIs,
// search + severity/type/status filters, backend pagination, detail panel with mark read/unread, resolve/dismiss
// (confirmed), add note, mark-all-read, and Sync (materialize alerts from real platform signals).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi, type SaAlert, type SaAlertsSummary, type SaAlertDetail } from '../api/superAdminApi';

const SEVS = ['low', 'medium', 'high', 'critical'];
const TYPES = ['tenant', 'payment', 'hardware', 'support', 'application', 'security', 'system', 'billing', 'ai_package', 'usage_limit'];
const STATUSES = ['unread', 'read', 'resolved', 'dismissed'];
const cap = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const sevBadge = (s: string) => s === 'critical' ? { background: '#FBE3E0', color: '#B23B2E' } : s === 'high' ? { background: '#FBEFE9', color: '#B85B4D' } : s === 'medium' ? { background: '#FFF6E5', color: '#D09A36' } : { background: '#EAF2FB', color: '#3C7FB6' };
const statBadge = (s: string) => s === 'resolved' ? { background: '#EAF5EE', color: '#3E8F57' } : s === 'dismissed' ? { background: '#EEEAE3', color: '#8A8076' } : s === 'read' ? { background: '#F0ECF8', color: '#7B5BB6' } : { background: '#EAF2FB', color: '#3C7FB6' };
const ago = (iso?: string) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return 'just now'; const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`; const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`; return `${Math.floor(h / 24)}d ago`; };

export function AlertsScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [sev, setSev] = useState(params.get('severity') || '');
  const [type, setType] = useState(params.get('type') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SaAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [sum, setSum] = useState<SaAlertsSummary | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaAlertDetail | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'resolved' | 'dismissed' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = () => superAdminApi.alertsSummary().then(setSum).catch(() => {});
  const load = () => {
    setLoading(true);
    superAdminApi.alerts({ ...(sev ? { severity: sev } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) })
      .then((r) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Unable to load alerts.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [sev, type, status, search]);
  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { if (!openId) { setDetail(null); return; } superAdminApi.alert(openId).then(setDetail).catch(() => setDetail(null)); }, [openId]);

  const refreshAll = () => { load(); loadSummary(); if (openId) superAdminApi.alert(openId).then(setDetail).catch(() => {}); };
  const setStatusAct = async (id: string, s: string) => {
    setBusy(id + s); setErr(null); setConfirm(null);
    try { const r = await superAdminApi.alertStatus(id, s); if ((r as any)?.ok === false) { setErr((r as any).error || 'Could not update alert.'); return; } setToast(`Alert ${cap(s)}.`); refreshAll(); }
    catch (e: any) { setErr(e?.message || 'Could not update alert.'); } finally { setBusy(null); }
  };
  const addNote = async (id: string) => {
    if (!note.trim()) return; setBusy(id + 'note');
    try { const r = await superAdminApi.alertNote(id, note.trim()); if ((r as any)?.ok === false) { setErr((r as any).error || 'Could not add note.'); return; } setNote(''); setToast('Note added.'); refreshAll(); }
    catch (e: any) { setErr(e?.message || 'Could not add note.'); } finally { setBusy(null); }
  };
  const markAll = async () => { setBusy('all'); try { const r = await superAdminApi.alertsMarkAllRead(); setToast(`${r.count} alert(s) marked read.`); refreshAll(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); } };
  const sync = async () => { setBusy('sync'); try { const r = await superAdminApi.alertsSync(); setToast(`Synced ${r.created} new alert(s) from platform signals.`); refreshAll(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); } };

  const KPIS = sum ? [
    { l: 'Total Alerts', v: sum.total }, { l: 'Unread', v: sum.unread }, { l: 'Critical', v: sum.critical }, { l: 'High Priority', v: sum.high },
    { l: 'Payment', v: sum.payment }, { l: 'System', v: sum.system }, { l: 'Security', v: sum.security }, { l: 'Support', v: sum.support },
  ] : [];

  return (
    <div className="work">
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" >
        <div> <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>Alerts <span style={{ color: '#DCB056' }} aria-hidden>★</span></h1><div className="sub">Monitor platform, tenant, payment, hardware, support, security, and system alerts · {total} total</div></div>
        <div className="flex gap-2 items-center flex-wrap">

        <input placeholder="Search title, message, tenant…" value={search} onChange={(e) => setSearch(e.target.value)} style={{  minWidth: 240, height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }} />
        <button className="btn ghost !min-h-9 !h-9 flex items-center" disabled={busy === 'all'} onClick={markAll}>Mark All Read</button>
          <button className="btn !min-h-9 !h-9 flex items-center" disabled={busy === 'sync'} onClick={sync}>{busy === 'sync' ? 'Syncing…' : 'Sync'} </button>
        </div>
      </div>

      {toast ? <div className="toast" onClick={() => setToast(null)}>{toast}</div> : null}

      <div className="kpis k6" style={{ marginBottom: 12 }}>
        {KPIS.map((k) => (<div className="kpi" key={k.l}><div className="top"><div className="l">{k.l}</div></div><div className="v">{k.v ?? '—'}</div></div>))}
      </div>

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        <select value={sev} onChange={(e) => setSev(e.target.value)} className="tab"><option value="">All severities</option>{SEVS.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="tab"><option value="">All types</option>{TYPES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="tab"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        {(sev || type || status) ? <button className="linkbtn" onClick={() => { setSev(''); setType(''); setStatus(''); }}>Clear filters</button> : null}
      </div>

      {err ? <div className="err" style={{ marginBottom: 10 }}>{err} <button className="btn ghost" onClick={refreshAll} style={{ marginLeft: 8 }}>Retry</button></div> : null}
      {loading ? <div className="state">Loading…</div> : rows.length === 0 ? (
        <div className="state">No alerts{sev || type || status || search ? ' match these filters' : ' yet'}. Click <b>Sync</b> to materialize alerts from current platform signals.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 360px' : '1fr', gap: 12, alignItems: 'start' }}>
          <section className="panel">
            <div className="list" style={{ maxHeight: 'none' }}>
              {rows.map((a) => { const sb = sevBadge(a.severity); const tb = statBadge(a.status); return (
                <div key={a.id} className="row" style={{ cursor: 'pointer', fontWeight: a.status === 'unread' ? 600 : 400 }} onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  {a.status === 'unread' ? <span className="sevdot" style={{ background: sb.color }} /> : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="t">{a.title} <span className="muted">· {cap(a.type)}</span></div>
                    <div className="s">{a.tenantName || 'Platform'} · {a.message}</div>
                  </div>
                  <span className="badge" style={{ ...sb }}>{cap(a.severity)}</span>
                  <span className="badge" style={{ marginLeft: 6, ...tb }}>{cap(a.status)}</span>
                  <span className="aage" style={{ marginLeft: 8 }}>{ago(a.createdAt)}</span>
                </div>
              ); })}
            </div>
          </section>

          {detail ? (
            <aside className="panel" style={{ position: 'sticky', top: 12 }}>
              <div className="phead"><h2 style={{ fontSize: 15 }}>{detail.title}</h2><button className="linkbtn" onClick={() => setOpenId(null)}>Close</button></div>
              <div className="dkv"><span>Type</span><span>{cap(detail.type)}</span></div>
              <div className="dkv"><span>Severity</span><span className="badge" style={{ ...sevBadge(detail.severity) }}>{cap(detail.severity)}</span></div>
              <div className="dkv"><span>Status</span><span className="badge" style={{ ...statBadge(detail.status) }}>{cap(detail.status)}</span></div>
              {detail.tenantName ? <div className="dkv"><span>Tenant</span><span>{detail.tenantName}</span></div> : null}
              <div className="dkv"><span>Created</span><span>{ago(detail.createdAt)}</span></div>
              <p className="am" style={{ margin: '8px 0' }}>{detail.message}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {detail.status !== 'read' ? <button className="btn ghost" disabled={!!busy} onClick={() => setStatusAct(detail.id, 'read')}>Mark Read</button> : <button className="btn ghost" disabled={!!busy} onClick={() => setStatusAct(detail.id, 'unread')}>Mark Unread</button>}
                {detail.status !== 'resolved' ? <button className="btn" disabled={!!busy} onClick={() => setConfirm({ id: detail.id, action: 'resolved' })}>Resolve</button> : null}
                {detail.status !== 'dismissed' ? <button className="btn ghost" disabled={!!busy} onClick={() => setConfirm({ id: detail.id, action: 'dismissed' })}>Dismiss</button> : null}
                {detail.relatedModule ? <button className="btn ghost" onClick={() => nav(detail.relatedModule!)}>Open Related</button> : null}
                {detail.tenantId ? <button className="btn ghost" onClick={() => nav(`/tenants?focus=${encodeURIComponent(detail.tenantId!)}`)}>Open Tenant</button> : null}
              </div>
              <div className="fieldrow" style={{ marginBottom: 8 }}>
                <input placeholder="Add internal note…" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                <button className="btn ghost" disabled={!note.trim() || !!busy} onClick={() => addNote(detail.id)}>Add Note</button>
              </div>
              {(detail.notes || []).length > 0 ? (
                <div>{detail.notes.map((n) => (<div key={n.id} className="s" style={{ padding: '4px 0' }}>• {n.note} <span className="muted">— {ago(n.createdAt)}</span></div>))}</div>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}

      {confirm ? (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="phead"><h2>{confirm.action === 'resolved' ? 'Resolve Alert' : 'Dismiss Alert'}</h2><button className="linkbtn" onClick={() => setConfirm(null)}>Close</button></div>
            <p className="am" style={{ marginTop: 0 }}>Are you sure you want to {confirm.action === 'resolved' ? 'resolve' : 'dismiss'} this alert?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn" disabled={!!busy} onClick={() => setStatusAct(confirm.id, confirm.action)}>{confirm.action === 'resolved' ? 'Resolve' : 'Dismiss'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
