import { useEffect, useState } from 'react';
import {
  listApprovedProviders, createConnection, beginOAuth, completeOAuth, configureApiKey, testConnectionLive,
  type ApprovedProvider,
} from '../api/superAdminIntegrationsApi';

// AddIntegrationWizard — the controlled onboarding flow behind "+ Add Integration" and marketplace "Connect".
// Wired to the real lifecycle endpoints: create → authenticate (OAuth authorize/exchange or API key) → test →
// activate. No secret/token is ever displayed; OAuth returns only an authorization URL + state, and the operator
// pastes back the provider's code. Cream/gold, matches the screen's design tokens.

const G7 = 'var(--g7)', OK = 'var(--ok)', DANGER = 'var(--danger)', MUTED = 'var(--muted)';
type Step = 'provider' | 'ownership' | 'auth' | 'test' | 'done';

export function AddIntegrationWizard({ preselect, onClose, onActivated }: { preselect?: string; onClose: () => void; onActivated: () => void }) {
  const [providers, setProviders] = useState<ApprovedProvider[]>([]);
  const [providerKey, setProviderKey] = useState(preselect ?? '');
  const [ownership, setOwnership] = useState('platform_tenant');
  const [tenantId, setTenantId] = useState('');
  const [step, setStep] = useState<Step>(preselect ? 'ownership' : 'provider');
  const [connId, setConnId] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'oauth2' | 'api_key' | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [oauth, setOauth] = useState<{ url: string; state: string } | null>(null);
  const [code, setCode] = useState('');
  const [authDone, setAuthDone] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { listApprovedProviders().then((r) => setProviders(r.providers)).catch(() => setProviders([])); }, []);
  const prov = providers.find((p) => p.key === providerKey);
  const redirectUri = (typeof window !== 'undefined' ? window.location.origin : 'https://admin.aipowersalon.com') + '/integrations/oauth/callback';

  async function guard(fn: () => Promise<void>) { setBusy(true); setErr(null); try { await fn(); } catch (e: any) { setErr(e?.message ?? 'Request failed.'); } finally { setBusy(false); } }

  const createAndAdvance = () => guard(async () => {
    const r = await createConnection({ providerKey, ownershipType: ownership, tenantId: ownership === 'platform_shared' ? null : (tenantId || null) });
    setConnId(r.connection.id);
    const method = (prov?.authMethods.includes('oauth2') ? 'oauth2' : prov?.authMethods.includes('api_key') ? 'api_key' : null) as any;
    setAuthMethod(method); setStep('auth');
  });
  const doBeginOAuth = () => guard(async () => { if (!connId) return; const r = await beginOAuth(connId, { redirectUri }); setOauth({ url: r.authorizationUrl, state: r.state }); });
  const doCompleteOAuth = () => guard(async () => { if (!connId || !oauth) return; await completeOAuth(connId, { state: oauth.state, code }); setAuthDone(true); setStep('test'); });
  const doApiKey = () => guard(async () => { if (!connId) return; await configureApiKey(connId, apiKey); setAuthDone(true); setStep('test'); });
  const doTest = () => guard(async () => { if (!connId) return; const r = await testConnectionLive(connId); setTestResult(r.result.succeeded ? `Connection succeeded — ${r.result.providerAccount ?? 'account verified'} (${r.result.latencyMs ?? '—'} ms, ${r.result.apiVersion ?? 'v?'}).` : `Test failed — ${r.result.errorCategory ?? 'check credentials'}.`); });

  const box: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
  const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, width: 'min(560px, 94vw)', maxHeight: '90vh', overflow: 'auto', padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' };
  const label: React.CSSProperties = { fontSize: 11, color: MUTED, display: 'block', marginBottom: 3 };

  return (
    <div style={box} role="dialog" aria-modal="true" aria-label="Add Integration" onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Add Integration</h2>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>Step: {step === 'provider' ? '1 · Select provider' : step === 'ownership' ? '2 · Ownership' : step === 'auth' ? '3 · Authenticate' : step === 'test' ? '4 · Test' : '5 · Activated'}</div>
        {err && <div className="card" style={{ padding: 8, fontSize: 12, border: `1px solid ${DANGER}`, color: DANGER, marginBottom: 10 }}>{err}</div>}

        {step === 'provider' && (
          <div>
            <label style={label}>Provider (approved only)</label>
            <select className="inp" value={providerKey} onChange={(e) => setProviderKey(e.target.value)} style={{ width: '100%' }}>
              <option value="">Select a provider…</option>
              {providers.map((p) => <option key={p.key} value={p.key}>{p.name} — {p.category}</option>)}
            </select>
            <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn primary" disabled={!providerKey} onClick={() => setStep('ownership')}>Next</button></div>
          </div>
        )}

        {step === 'ownership' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{prov?.name ?? providerKey} <span style={{ fontSize: 11, color: MUTED }}>· {prov?.category}</span></div>
            <label style={label}>Connection ownership</label>
            <select className="inp" value={ownership} onChange={(e) => setOwnership(e.target.value)} style={{ width: '100%' }}>
              <option value="platform_shared">Platform-managed shared</option>
              <option value="platform_tenant">Platform-managed tenant</option>
              <option value="tenant_owned">Tenant-owned</option>
              <option value="enterprise">Dedicated enterprise</option>
            </select>
            {ownership !== 'platform_shared' && (<div style={{ marginTop: 8 }}><label style={label}>Tenant ID (optional)</label><input className="inp" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant uuid" style={{ width: '100%' }} /></div>)}
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
              {!preselect ? <button className="btn" onClick={() => setStep('provider')}>Back</button> : <span />}
              <button className="btn primary" disabled={busy} onClick={createAndAdvance}>Create &amp; continue</button>
            </div>
          </div>
        )}

        {step === 'auth' && (
          <div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>Authentication method: <b>{authMethod === 'oauth2' ? 'OAuth 2.0' : authMethod === 'api_key' ? 'API key' : 'None'}</b></div>
            {authMethod === 'oauth2' && (
              <div>
                {!oauth ? <button className="btn primary" disabled={busy} onClick={doBeginOAuth}>Begin authorization</button> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, color: MUTED }}>Open this authorization URL, approve access, then paste the returned code. Tokens are never shown.</div>
                    <a href={oauth.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: G7, wordBreak: 'break-all' }}>{oauth.url}</a>
                    <input className="inp" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Authorization code from provider" />
                    <div style={{ textAlign: 'right' }}><button className="btn primary" disabled={busy || !code} onClick={doCompleteOAuth}>Complete authorization</button></div>
                  </div>
                )}
              </div>
            )}
            {authMethod === 'api_key' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={label}>API key (stored encrypted; shown masked after saving)</label>
                <input className="inp" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste the provider API key" />
                <div style={{ textAlign: 'right' }}><button className="btn primary" disabled={busy || !apiKey} onClick={doApiKey}>Save credential</button></div>
              </div>
            )}
            {!authMethod && <div style={{ textAlign: 'right' }}><button className="btn primary" onClick={() => { setAuthDone(true); setStep('test'); }}>Continue</button></div>}
          </div>
        )}

        {step === 'test' && (
          <div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>{authDone ? 'Credential saved. Run a non-destructive connection test.' : 'Run a connection test.'}</div>
            <button className="btn" disabled={busy} onClick={doTest}>Test connection</button>
            {testResult && <div className="card" style={{ padding: 8, fontSize: 12, marginTop: 10, border: `1px solid ${testResult.startsWith('Connection succeeded') ? OK : DANGER}` }}>{testResult}</div>}
            <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn primary" onClick={() => { setStep('done'); onActivated(); }}>Finish</button></div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 28, color: OK }}>✓</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{prov?.name ?? providerKey} connection activated</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>It now appears under Managed Connections. Credentials are stored encrypted and masked.</div>
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
