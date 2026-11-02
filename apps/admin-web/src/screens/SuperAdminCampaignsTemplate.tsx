// CreateTemplateModal — creates a REUSABLE campaign template. Templates are distributed to tenants, who copy and
// customize them and pick their OWN audience + schedule — the template never overwrites a tenant's customized copy.
// Client validation mirrors the server engine (name required, valid channel, some content). Edits are versioned.
import { useState } from 'react';
import { superAdminApi, type McTemplateInput } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };
const TYPES = ['promotional', 'new_client', 're_engagement', 'appointment', 'membership', 'loyalty', 'gift_card', 'educational'];

export function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (msg: string) => void }) {
  const [f, setF] = useState({ name: '', campaignType: 'promotional', channel: 'email', subject: '', body: '', smsContent: '', suggestedAudience: '', suggestedOffer: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const validate = (): string[] => {
    const e: string[] = [];
    if (!f.name.trim()) e.push('A template name is required.');
    const hasContent = f.subject.trim() || f.body.trim() || f.smsContent.trim();
    if (!hasContent) e.push('Provide some content (subject/body or SMS).');
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    const body: McTemplateInput = {
      name: f.name.trim(), campaignType: f.campaignType, channel: f.channel, subject: f.subject.trim() || undefined,
      body: f.body.trim() || undefined, smsContent: f.smsContent.trim() || undefined,
      suggestedAudience: f.suggestedAudience.trim() || undefined, suggestedOffer: f.suggestedOffer.trim() || undefined,
    };
    try {
      const res = await superAdminApi.createTemplate(body);
      if (!res.ok || !res.template) { setErrors(res.errors || ['Could not create the template.']); setBusy(false); return; }
      onCreated(`Reusable template “${res.template.name}” created (${res.template.status}, v${res.template.currentVersion}). Tenants copy and customize it with their own audience — it never overwrites their campaigns.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Create reusable template" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(560px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Create Reusable Template</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>A reusable template is distributed to tenants. They customize permitted fields and choose their own eligible audience and schedule. Edits are versioned; prior versions are preserved.</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        <label style={lab}>Template name *<input className="inp" style={fld} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Type<select className="inp" style={fld} value={f.campaignType} onChange={(e) => setF({ ...f, campaignType: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></label>
          <label style={lab}>Channel<select className="inp" style={fld} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['email', 'sms', 'push', 'in_app', 'multi'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        </div>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Subject<input className="inp" style={fld} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Email body<textarea className="inp" style={{ ...fld, height: 60, paddingTop: 8 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>SMS content<input className="inp" style={fld} value={f.smsContent} onChange={(e) => setF({ ...f, smsContent: e.target.value })} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Suggested audience<input className="inp" style={fld} value={f.suggestedAudience} onChange={(e) => setF({ ...f, suggestedAudience: e.target.value })} placeholder="e.g. Returning customers" /></label>
          <label style={lab}>Suggested offer<input className="inp" style={fld} value={f.suggestedOffer} onChange={(e) => setF({ ...f, suggestedOffer: e.target.value })} placeholder="e.g. 20% off" /></label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create template'}</button>
        </div>
      </div>
    </div>
  );
}
