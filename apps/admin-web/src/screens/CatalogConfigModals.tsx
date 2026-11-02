import { useEffect, useState, type CSSProperties } from 'react';
import { superAdminApi, type CatalogCategoryRow, type CatalogTemplateRow } from '../api/superAdminApi';

// CatalogConfigModals.tsx — Organize Categories (create/rename/reorder/archive) and Configure Suggested Duration
// (quick per-template duration editor). Both go through the permission-gated + audited catalog endpoints.

const inp = (): CSSProperties => ({ height: 32, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', padding: '0 8px', fontSize: 12.5, color: 'var(--text)', boxSizing: 'border-box' });

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,24,16,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '40px 16px', overflow: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', width: 560, maxWidth: '100%', padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function OrganizeCategoriesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [cats, setCats] = useState<CatalogCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => superAdminApi.catalogCategories().then((d) => setCats(d as CatalogCategoryRow[])).catch((e: any) => setErr(e?.message || 'Failed to load')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const wrap = async (fn: () => Promise<any>): Promise<boolean> => { setBusy(true); setErr(null); try { const d = await fn(); setCats(d); onChanged(); return true; } catch (e: any) { setErr(e?.message || 'Action failed'); return false; } finally { setBusy(false); } };
  const add = () => { if (!newName.trim()) return; wrap(() => superAdminApi.catalogCategoryCreate({ name: newName.trim() })).then((ok) => { if (ok) setNewName(''); }); };   // SCAN (Oct 12): a failed create keeps the typed name (it used to be cleared)
  const rename = (code: string) => { if (!editName.trim()) return; wrap(() => superAdminApi.catalogCategoryUpdate(code, { name: editName.trim() })).then((ok) => { if (ok) setEditCode(null); }); };
  const setStatus = (code: string, status: string) => wrap(() => superAdminApi.catalogCategoryUpdate(code, { status }));
  const move = (idx: number, dir: -1 | 1) => {
    const a = cats[idx]; const b = cats[idx + dir]; if (!a || !b) return;
    wrap(async () => { await superAdminApi.catalogCategoryUpdate(a.code, { displayOrder: b.displayOrder }); return superAdminApi.catalogCategoryUpdate(b.code, { displayOrder: a.displayOrder }); });
  };

  return (
    <Overlay title="Organize Categories" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...inp(), flex: 1, height: 34 }} placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add} disabled={busy || !newName.trim()}>+ Add</button>
      </div>
      {loading ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 5, maxHeight: 340, overflow: 'auto' }}>
          {cats.map((c, i) => (
            <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 9, border: '1px solid var(--line)', background: c.status === 'archived' ? '#F7F3EC' : '#fff', opacity: c.status === 'archived' ? 0.7 : 1 }}>
              <div style={{ display: 'grid', gap: 1 }}>
                <button className="btn ghost" style={{ height: 15, padding: 0, width: 20, lineHeight: 1 }} disabled={i === 0 || busy} onClick={() => move(i, -1)}>▲</button>
                <button className="btn ghost" style={{ height: 15, padding: 0, width: 20, lineHeight: 1 }} disabled={i === cats.length - 1 || busy} onClick={() => move(i, 1)}>▼</button>
              </div>
              {editCode === c.code ? (
                <>
                  <input style={{ ...inp(), flex: 1 }} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                  <button className="btn" style={{ height: 30 }} onClick={() => rename(c.code)} disabled={busy}>Save</button>
                  <button className="btn ghost" style={{ height: 30 }} onClick={() => setEditCode(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{c.name} <span className="muted" style={{ fontWeight: 400 }}>· {c.templateCount} template{c.templateCount === 1 ? '' : 's'}{c.status === 'archived' ? ' · archived' : ''}</span></div>
                  <button className="btn ghost" style={{ height: 28 }} onClick={() => { setEditCode(c.code); setEditName(c.name); }} disabled={busy}>Rename</button>
                  {c.status === 'archived'
                    ? <button className="btn ghost" style={{ height: 28 }} onClick={() => setStatus(c.code, 'active')} disabled={busy}>Restore</button>
                    : <button className="btn ghost" style={{ height: 28 }} onClick={() => setStatus(c.code, 'archived')} disabled={busy}>Archive</button>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={onClose}>Done</button></div>
    </Overlay>
  );
}

export function ConfigureDurationModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<CatalogTemplateRow[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    superAdminApi.catalogTemplates({ pageSize: 100 }).then((d: any) => { setRows(d.rows); setVals(Object.fromEntries(d.rows.map((r: CatalogTemplateRow) => [r.id, String(r.durationMinutes)]))); })
      .catch((e: any) => setErr(e?.message || 'Failed to load')).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setErr(null); setOk(null);
    const changed = rows.filter((r) => (parseInt(vals[r.id], 10) || 0) !== r.durationMinutes);
    if (changed.length === 0) { setErr('No duration changes to save.'); return; }
    for (const r of changed) { const d = parseInt(vals[r.id], 10); if (!Number.isInteger(d) || d < 0) { setErr(`Invalid duration for ${r.name}.`); return; } }
    setBusy(true);
    try {
      for (const r of changed) await superAdminApi.catalogUpdate(r.id, { durationMinutes: parseInt(vals[r.id], 10), changeNote: 'Suggested duration adjusted' });
      setOk(`Updated ${changed.length} template duration(s).`); onChanged();
      const d: any = await superAdminApi.catalogTemplates({ pageSize: 100 }); setRows(d.rows);
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Configure Suggested Duration" onClose={onClose}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Adjust the suggested duration (minutes) for any template. Each change bumps the template version.</div>
      {loading ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 5, maxHeight: 360, overflow: 'auto' }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <div style={{ flex: 1 }}>{r.name} <span className="muted">· {r.categoryName ?? '—'}</span></div>
              <input style={{ ...inp(), width: 80 }} value={vals[r.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [r.id]: e.target.value }))} inputMode="numeric" />
              <span className="muted" style={{ width: 28 }}>min</span>
            </div>
          ))}
        </div>
      )}
      {ok && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Durations'}</button>
      </div>
    </Overlay>
  );
}

// Small picker: choose a template, then the parent opens the edit form (which manages add-ons).
export function TemplatePickerModal({ title, hint, onPick, onClose }: { title: string; hint: string; onPick: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<CatalogTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  useEffect(() => { superAdminApi.catalogTemplates({ pageSize: 100 }).then((d: any) => setRows(d.rows)).catch(() => {}).finally(() => setLoading(false)); }, []);
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Overlay title={title} onClose={onClose}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{hint}</div>
      <input style={{ ...inp(), width: '100%', height: 34, marginBottom: 10 }} placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 4, maxHeight: 340, overflow: 'auto' }}>
          {filtered.map((r) => (
            <button key={r.id} className="btn ghost" style={{ height: 34, justifyContent: 'space-between', fontSize: 12.5 }} onClick={() => onPick(r.id)}>
              <span>{r.name}</span><span className="muted">{r.addonCount} add-on{r.addonCount === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Overlay>
  );
}
