// AiProviderModal — add or update an approved AI provider. The API key is write-only from the UI's perspective: it is
// submitted once, encrypted server-side, and only the mask + fingerprint come back. The full key is never displayed
// after saving. Leaving the key blank on an existing provider keeps the stored key unchanged.
import { useState } from 'react';
import { superAdminApi, type AiProviderPublic } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };
const PROVIDERS = [['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['google', 'Google'], ['retell', 'Retell'], ['azure_openai', 'Azure OpenAI'], ['mistral', 'Mistral'], ['custom', 'Custom']];

export function AiProviderModal({ existing, onClose, onSaved }: { existing?: AiProviderPublic | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ providerKey: existing?.providerKey || 'openai', displayName: existing?.displayName || '', apiKey: '', defaultModel: existing?.defaultModel || '', status: existing?.status || 'active' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const isEdit = !!existing;

  const submit = async () => {
    const e: string[] = [];
    if (!f.providerKey) e.push('A provider is required.');
    if (!f.displayName.trim()) e.push('A display name is required.');
    if (!isEdit && !f.apiKey.trim()) e.push('An API key is required.');
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.saveAiProvider({ providerKey: f.providerKey, displayName: f.displayName.trim(), apiKey: f.apiKey.trim() || undefined, defaultModel: f.defaultModel.trim() || undefined, status: f.status });
      if (!res.ok || !res.provider) { setErrors(res.errors || ['Could not save provider.']); setBusy(false); return; }
      onSaved(`${res.provider.displayName} saved. Key stored encrypted${res.provider.apiKeyMasked ? ` (${res.provider.apiKeyMasked})` : ''} — the full key is never displayed again.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Configure AI provider" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(500px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>{isEdit ? 'Update Provider' : 'Add Approved Provider'}</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>API keys are encrypted (AES-256-GCM) on save and never displayed in full afterward. {isEdit ? 'Leave the key blank to keep the current key.' : ''}</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        <label style={lab}>Provider<select className="inp" style={fld} value={f.providerKey} disabled={isEdit} onChange={(e) => setF({ ...f, providerKey: e.target.value })}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Display name<input className="inp" style={fld} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>API key {isEdit ? <span className="muted">(blank = unchanged)</span> : null}
          <input className="inp" style={fld} type="password" autoComplete="off" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} placeholder={isEdit && existing?.apiKeyMasked ? existing.apiKeyMasked : 'sk_live_…'} />
        </label>
        {isEdit && existing?.apiKeyFingerprint ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Stored key fingerprint: {existing.apiKeyFingerprint}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Default model<input className="inp" style={fld} value={f.defaultModel} onChange={(e) => setF({ ...f, defaultModel: e.target.value })} placeholder="e.g. GPT-4.1" /></label>
          <label style={lab}>Status<select className="inp" style={fld} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['active', 'inactive', 'disabled', 'error'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save provider'}</button>
        </div>
      </div>
    </div>
  );
}
