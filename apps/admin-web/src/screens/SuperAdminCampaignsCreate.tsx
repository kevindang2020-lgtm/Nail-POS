// CreateAnnouncementModal — creates a PLATFORM announcement (a platform-owned campaign). It targets tenant users of
// all or selected tenants — never a tenant's own customers, preserving the platform/tenant boundary. Client
// validation mirrors the server engine (title required, targets required for selected-tenants, future schedule).
import { useState } from 'react';
import { superAdminApi, type McAnnouncementInput } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };

export function CreateAnnouncementModal({ tenantOptions, onClose, onCreated }: { tenantOptions: { id: string; name: string }[]; onClose: () => void; onCreated: (msg: string) => void }) {
  const [f, setF] = useState({ title: '', body: '', channel: 'email', scope: 'all_tenants' as 'all_tenants' | 'selected_tenants', scheduledAt: '' });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const chosen = tenantOptions.filter((t) => selected[t.id]).map((t) => t.id);

  const validate = (): string[] => {
    const e: string[] = [];
    if (!f.title.trim()) e.push('A title is required.');
    if (f.scope === 'selected_tenants' && chosen.length === 0) e.push('Select at least one tenant for a selected-tenants announcement.');
    if (f.scheduledAt) { const t = Date.parse(f.scheduledAt); if (Number.isNaN(t)) e.push('Scheduled time is not a valid date.'); else if (t < Date.now()) e.push('Scheduled time must be in the future.'); }
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    const body: McAnnouncementInput = {
      title: f.title.trim(), body: f.body.trim() || undefined, channel: f.channel, audienceScope: f.scope,
      tenantIds: f.scope === 'selected_tenants' ? chosen : [], scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
    };
    try {
      const res = await superAdminApi.createAnnouncement(body);
      if (!res.ok || !res.announcement) { setErrors(res.errors || ['Could not create the announcement.']); setBusy(false); return; }
      onCreated(`Platform announcement “${res.announcement.title}” created as ${res.announcement.status} (audience ≈ ${res.announcement.audienceSize.toLocaleString()}). It targets tenant users only.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Create platform announcement" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(560px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Create Platform Announcement</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>A platform announcement is sent to tenant users of the selected (or all) tenants. It is never a tenant customer campaign — that boundary is enforced.</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        <label style={lab}>Title *<input className="inp" style={fld} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Message<textarea className="inp" style={{ ...fld, height: 64, paddingTop: 8 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Channel<select className="inp" style={fld} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['email', 'sms', 'push', 'in_app'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={lab}>Audience<select className="inp" style={fld} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as any })}><option value="all_tenants">All tenants</option><option value="selected_tenants">Selected tenants</option></select></label>
        </div>

        {f.scope === 'selected_tenants' ? (
          <div style={{ marginTop: 10 }}>
            <div style={lab}>Tenants</div>
            <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginTop: 4 }}>
              {tenantOptions.length === 0 ? <div className="muted">No tenants available.</div> : tenantOptions.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '2px 0' }}>
                  <input type="checkbox" checked={!!selected[t.id]} onChange={() => setSelected((s) => ({ ...s, [t.id]: !s[t.id] }))} /> {t.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Schedule (optional)<input className="inp" style={fld} type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create announcement'}</button>
        </div>
      </div>
    </div>
  );
}
