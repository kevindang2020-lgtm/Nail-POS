// AiPromptModal — edit or create a global AI prompt. Editing bumps the version (change record preserved). Client
// validation mirrors the server engine (key lowercase/underscore, name + body required).
import { useState } from 'react';
import { superAdminApi, type AiGlobalPrompt } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };

export function AiPromptModal({ existing, onClose, onSaved }: { existing?: AiGlobalPrompt | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const isEdit = !!existing;
  const [f, setF] = useState({ promptKey: existing?.promptKey || '', name: existing?.name || '', body: existing?.body || '', status: existing?.status || 'active' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: string[] = [];
    if (!f.promptKey.trim()) e.push('A prompt key is required.');
    else if (!/^[a-z0-9_]+$/.test(f.promptKey)) e.push('Prompt key must be lowercase letters, numbers, and underscores.');
    if (!f.name.trim()) e.push('A name is required.');
    if (!f.body.trim()) e.push('Prompt body cannot be empty.');
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.saveAiPrompt({ promptKey: f.promptKey.trim(), name: f.name.trim(), body: f.body, status: f.status });
      if (!res.ok || !res.prompt) { setErrors(res.errors || ['Could not save prompt.']); setBusy(false); return; }
      onSaved(`Prompt “${res.prompt.name}” saved as v${res.prompt.version}. Prior versions are preserved.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit global prompt" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(560px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>{isEdit ? `Edit Prompt · v${existing!.version}` : 'New Global Prompt'}</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Global prompts steer AI features platform-wide. Saving an edit creates a new version; earlier versions are preserved.</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        <label style={lab}>Prompt key<input className="inp" style={{ ...fld, fontFamily: 'monospace' }} value={f.promptKey} disabled={isEdit} onChange={(e) => setF({ ...f, promptKey: e.target.value })} placeholder="smart_reminders" /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Name<input className="inp" style={fld} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Prompt body<textarea className="inp" style={{ ...fld, minHeight: 120 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Status<select className="inp" style={fld} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['active', 'draft', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save prompt'}</button>
        </div>
      </div>
    </div>
  );
}
