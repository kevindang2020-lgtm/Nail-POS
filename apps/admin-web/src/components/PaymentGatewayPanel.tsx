// PaymentGatewayPanel.tsx — Super Admin per-tenant payment gateway configuration (admin-web).
// Drives the real, isolated routes: GET/POST /super-admin/tenants/:id/payment-gateway (+ /test-connection).
// Shows only the MASKED gateway; credential inputs are write-only (never pre-filled, cleared after save). Matches the
// admin-web cream/gold design tokens + existing classes (.panel/.btn/.pill/.s). Renders inside the Tenants Manage drawer.
import { useCallback, useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import type { CSSProperties } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { BranchMerchantAccountsPanel, type BranchOption } from './BranchMerchantAccountsPanel';

type Masked = { processorType: string; environment: string; merchantIdMasked: string; status: string; setupRequired: boolean; onboardingStatus?: string; terminalConfigured?: boolean; terminalBaseUrl?: string | null; tapToPayMerchantIdMasked?: string; tapToPayConfigured?: boolean };

const inputStyle: CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', background: '#FFFDF8', outline: 'none', width: '100%', boxSizing: 'border-box' };
const labelStyle: CSSProperties = { fontSize: 11, color: 'var(--soft)', marginBottom: 3, display: 'block' };

const PROCESSORS = ['fiserv', 'cardpointe', 'clover', 'none']; // backend UpsertGatewayInput union (no 'manual')
const ENVS = ['sandbox', 'production'];
const STATUSES = ['pending', 'active', 'disabled'];
// Merchant-application / underwriting status — the real value behind the detail panel's "Underwriting Approved" step.
// Normally driven by the processor's application webhook; editable here so Super Admin can record/correct it manually.
const ONBOARDING = ['not_started', 'submitted', 'under_review', 'approved', 'declined'];
const ONBOARDING_LABEL: Record<string, string> = { not_started: 'Not started', submitted: 'Submitted', under_review: 'Under review', approved: 'Approved', declined: 'Declined' };
const tone = (s: string) => (s === 'active' ? 'var(--ok)' : s === 'error' ? 'var(--danger)' : 'var(--warn)');
// Map a tenant's (possibly non-editable) gateway status onto the editable options. A gateway that isn't live yet
// (not_configured / error / unknown) edits as 'pending', so opening the form never silently presents 'active' — and
// because the Save body always carries `status`, this stops an edit from flipping a not-yet-live or disabled gateway on.
const STATUS_OPTIONS = new Set(STATUSES);
const editableStatus = (s?: string): string => (s && STATUS_OPTIONS.has(s) ? s : 'pending');

export function PaymentGatewayPanel({ tenantId, branches }: { tenantId: string; branches?: BranchOption[] }) {
  const [gw, setGw] = useState<Masked | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [processorType, setProcessorType] = useState('fiserv');
  const [environment, setEnvironment] = useState('sandbox');
  const [status, setStatus] = useState('pending');
  const [onboardingStatus, setOnboardingStatus] = useState('not_started');
  const [baseUrl, setBaseUrl] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [boltBaseUrl, setBoltBaseUrl] = useState('');
  const [boltApiKey, setBoltApiKey] = useState('');
  const [ttpMerchantId, setTtpMerchantId] = useState('');
  const [ttpTerminalId, setTtpTerminalId] = useState('');
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);          // shown once after a rotate
  const [settlements, setSettlements] = useState<Array<{ id: string; settlementId: string | null; grossCents: number; feeCents: number; netCents: number; currency: string; status: string; settledAt: string | null }> | null>(null);
  const [webhooks, setWebhooks] = useState<{ events: Array<{ id: string; eventType: string | null; processorType: string; signatureValid: boolean; matched: boolean; receivedAt: string | null }>; health: { received: number; signatureFailures: number; lastReceivedAt: string | null; status: 'healthy' | 'failing' | 'none' } } | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    (superAdminApi.getGateway(tenantId) as Promise<Masked>)
      .then((m) => { setGw(m); if (m.processorType && m.processorType !== 'none') setProcessorType(m.processorType); if (m.environment) setEnvironment(m.environment); setStatus(editableStatus(m.status)); if (m.onboardingStatus) setOnboardingStatus(m.onboardingStatus); })
      .catch((e: any) => setError(e?.message || 'Failed to load gateway'))
      .finally(() => setLoading(false));
  }, [tenantId]);
  useEffect(load, [load]);

  const save = async () => {
    setBusy('save'); setNote(null); setError(null);
    const body: Record<string, unknown> = { processorType, environment, status, onboardingStatus };
    if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
    if (merchantId.trim()) body.merchantId = merchantId.trim();
    if (apiUsername.trim()) body.apiUsername = apiUsername.trim();
    if (apiPassword.trim()) body.apiPassword = apiPassword.trim();
    if (webhookSecret.trim()) body.webhookSecret = webhookSecret.trim();
    if (boltBaseUrl.trim()) body.boltBaseUrl = boltBaseUrl.trim();
    if (boltApiKey.trim()) body.boltApiKey = boltApiKey.trim();
    if (ttpMerchantId.trim()) body.ttpMerchantId = ttpMerchantId.trim();
    if (ttpTerminalId.trim()) body.ttpTerminalId = ttpTerminalId.trim();
    try {
      const m = await (superAdminApi.setGateway(tenantId, body) as Promise<Masked>);
      setGw(m);
      if (m.processorType && m.processorType !== 'none') setProcessorType(m.processorType);
      if (m.environment) setEnvironment(m.environment);
      setStatus(editableStatus(m.status)); // keep the form in sync with the saved status
      if (m.onboardingStatus) setOnboardingStatus(m.onboardingStatus);
      setNote('Saved — credentials encrypted at rest, shown masked.');
      setMerchantId(''); setApiUsername(''); setApiPassword(''); setWebhookSecret(''); setTtpMerchantId(''); setTtpTerminalId(''); // clear write-only fields
      setOpen(false);
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setBusy(null); }
  };

  const test = async () => {
    setBusy('test'); setNote(null); setError(null);
    try { const r: any = await superAdminApi.testGateway(tenantId); setNote((r?.ok ? '✓ ' : '· ') + (r?.note || 'tested')); }
    catch (e: any) { setError(e?.message || 'Test failed'); }
    finally { setBusy(null); }
  };

  const verify = async () => {
    setBusy('verify'); setNote(null); setError(null);
    try { const r = await superAdminApi.verifyGateway(tenantId); setNote((r.ok ? '✓ ' : '· ') + r.note); }
    catch (e: any) { setError(e?.message || 'Verify failed'); }
    finally { setBusy(null); }
  };

  const sync = async () => {
    setBusy('sync'); setNote(null); setError(null);
    try {
      const r = await superAdminApi.syncGatewayStatus(tenantId);
      setNote(`Underwriting: ${ONBOARDING_LABEL[r.onboardingStatus] || r.onboardingStatus} · ${r.note}`);
      setGw((g) => (g ? { ...g, onboardingStatus: r.onboardingStatus } : g));
    } catch (e: any) { setError(e?.message || 'Sync failed'); }
    finally { setBusy(null); }
  };

  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const rotateSecret = () => askConfirm('Rotate the webhook signing secret? The new secret is shown ONCE — you must set it in the processor dashboard or webhook signatures will start failing.', () => { void doRotateSecret(); }, { confirmLabel: 'Rotate secret' });
  const doRotateSecret = async () => {
    setBusy('rotate'); setNote(null); setError(null); setRotatedSecret(null);
    try { const r = await superAdminApi.rotateWebhookSecret(tenantId); setRotatedSecret(r.secretOnce); setNote('Webhook secret rotated — copy it now (shown once).'); }
    catch (e: any) { setError(e?.message || 'Rotate failed'); }
    finally { setBusy(null); }
  };

  const loadSettlements = async () => {
    setBusy('settle'); setError(null);
    try { const r = await superAdminApi.gatewaySettlements(tenantId); setSettlements(r.settlements); }
    catch (e: any) { setError(e?.message || 'Could not load settlements'); }
    finally { setBusy(null); }
  };

  const loadWebhooks = async () => {
    setBusy('hooks'); setError(null);
    try { const r = await superAdminApi.gatewayWebhooks(tenantId); setWebhooks(r); }
    catch (e: any) { setError(e?.message || 'Could not load webhook events'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8' }}>
      {confirmUi}
      <div className="s" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Payment gateway</span>
        {gw ? <span className="pill" style={{ color: tone(gw.status) }}>{gw.status}</span> : null}
        {gw?.setupRequired ? <span className="pill" style={{ color: 'var(--warn)' }}>setup required</span> : null}
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={verify} disabled={!!busy || loading}>{busy === 'verify' ? 'Verifying…' : 'Verify credentials'}</button>
        <button className="btn ghost" onClick={sync} disabled={!!busy || loading}>{busy === 'sync' ? 'Syncing…' : 'Sync status'}</button>
        <button className="btn ghost" onClick={test} disabled={!!busy || loading}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        <button className="btn" onClick={() => { setOpen((v) => !v); setNote(null); setError(null); }} disabled={loading}>{open ? 'Cancel' : gw?.setupRequired ? 'Configure' : 'Edit'}</button>
      </div>

      {loading ? <div className="muted">Loading gateway…</div> : null}
      {error ? <div className="err" style={{ marginBottom: 8 }}>{error}</div> : null}
      {note ? <div className="s" style={{ color: 'var(--ok)', marginBottom: 8 }}>{note}</div> : null}

      {!loading && gw ? (
        <div className="s" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--soft)' }}>
          <span>Processor: <b style={{ color: 'var(--text)' }}>{gw.processorType}</b></span>
          <span>Environment: <b style={{ color: 'var(--text)' }}>{gw.environment}</b></span>
          <span>Merchant: <b style={{ color: 'var(--text)' }}>{gw.merchantIdMasked || '—'}</b></span>
          <span>Underwriting: <b style={{ color: 'var(--text)' }}>{ONBOARDING_LABEL[gw.onboardingStatus || 'not_started'] || 'Not started'}</b></span>
        </div>
      ) : null}

      {!loading && gw && !gw.setupRequired ? (
        <div className="s" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={loadSettlements} disabled={!!busy}>{busy === 'settle' ? 'Loading…' : 'View settlements'}</button>
          <button className="btn ghost" onClick={loadWebhooks} disabled={!!busy}>{busy === 'hooks' ? 'Loading…' : 'Webhook events'}</button>
          <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={rotateSecret} disabled={!!busy}>{busy === 'rotate' ? 'Rotating…' : 'Rotate webhook secret'}</button>
        </div>
      ) : null}

      {rotatedSecret ? (
        <div style={{ marginTop: 8, border: '1px solid var(--gold)', background: '#FBF4E6', borderRadius: 8, padding: 10 }}>
          <div className="s" style={{ fontWeight: 700, marginBottom: 4 }}>New webhook signing secret — copy now (shown once)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{rotatedSecret}</code>
            <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(rotatedSecret); }}>Copy</button>
            <button className="btn ghost" onClick={() => setRotatedSecret(null)}>Done</button>
          </div>
          <div className="s" style={{ color: 'var(--muted)', marginTop: 4 }}>Set this as the webhook signing secret in your processor dashboard, or signature verification will fail.</div>
        </div>
      ) : null}

      {settlements ? (
        <div style={{ marginTop: 8 }}>
          <div className="s" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>Settlements <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setSettlements(null)}>Hide</button></div>
          {settlements.length === 0 ? <div className="muted s">No settlements recorded yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--soft)' }}><th style={{ padding: '4px 6px' }}>Date</th><th style={{ padding: '4px 6px' }}>Gross</th><th style={{ padding: '4px 6px' }}>Fee</th><th style={{ padding: '4px 6px' }}>Net</th><th style={{ padding: '4px 6px' }}>Status</th></tr></thead>
              <tbody>{settlements.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 6px' }}>{s.settledAt ? new Date(s.settledAt).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '4px 6px' }}>${(s.grossCents / 100).toFixed(2)}</td>
                  <td style={{ padding: '4px 6px' }}>${(s.feeCents / 100).toFixed(2)}</td>
                  <td style={{ padding: '4px 6px', fontWeight: 600 }}>${(s.netCents / 100).toFixed(2)}</td>
                  <td style={{ padding: '4px 6px' }}>{s.status}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ) : null}

      {webhooks ? (
        <div style={{ marginTop: 8 }}>
          <div className="s" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            Webhook events
            <span className="pill" style={{ color: webhooks.health.status === 'healthy' ? 'var(--ok)' : webhooks.health.status === 'failing' ? 'var(--danger)' : 'var(--muted)' }}>
              {webhooks.health.status === 'none' ? 'none yet' : webhooks.health.status === 'failing' ? `${webhooks.health.signatureFailures} signature failure(s)` : 'healthy'}
            </span>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setWebhooks(null)}>Hide</button>
          </div>
          {webhooks.events.length === 0 ? <div className="muted s">No webhook events received yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--soft)' }}><th style={{ padding: '4px 6px' }}>When</th><th style={{ padding: '4px 6px' }}>Event</th><th style={{ padding: '4px 6px' }}>Signature</th><th style={{ padding: '4px 6px' }}>Matched</th></tr></thead>
              <tbody>{webhooks.events.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 6px' }}>{e.receivedAt ? new Date(e.receivedAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: '4px 6px' }}>{e.eventType || '—'}</td>
                  <td style={{ padding: '4px 6px', color: e.signatureValid ? 'var(--ok)' : 'var(--danger)' }}>{e.signatureValid ? '✓ verified' : '✗ failed'}</td>
                  <td style={{ padding: '4px 6px' }}>{e.matched ? '✓' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ) : null}

      {open ? (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          <div><label style={labelStyle}>Processor</label><select aria-label="Processor" value={processorType} onChange={(e) => setProcessorType(e.target.value)} style={inputStyle}>{PROCESSORS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Environment</label><select aria-label="Environment" value={environment} onChange={(e) => setEnvironment(e.target.value)} style={inputStyle}>{ENVS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Status</label><select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>{STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Underwriting status</label><select aria-label="Underwriting status" value={onboardingStatus} onChange={(e) => setOnboardingStatus(e.target.value)} style={inputStyle}>{ONBOARDING.map((p) => <option key={p} value={p}>{ONBOARDING_LABEL[p]}</option>)}</select></div>
          <div><label style={labelStyle}>Base URL</label><input aria-label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={processorType === 'clover' ? 'https://scl.clover.com' : 'https://<site>.cardconnect.com'} style={inputStyle} /></div>
          <div><label style={labelStyle}>Merchant ID</label><input aria-label="Merchant ID" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="MID / account id" style={inputStyle} /></div>
          <div><label style={labelStyle}>{processorType === 'clover' ? 'API token' : 'API password'}</label><input aria-label={processorType === 'clover' ? 'API token' : 'API password'} type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          {(processorType === 'fiserv' || processorType === 'cardpointe') ? <div><label style={labelStyle}>API username</label><input aria-label="API username" value={apiUsername} onChange={(e) => setApiUsername(e.target.value)} placeholder="write-only" style={inputStyle} /></div> : null}
          <div><label style={labelStyle}>Webhook secret</label><input aria-label="Webhook secret" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          <div><label style={labelStyle}>Terminal API base (Bolt)</label><input aria-label="Terminal API base" value={boltBaseUrl} onChange={(e) => setBoltBaseUrl(e.target.value)} placeholder={gw?.terminalBaseUrl || 'https://bolt-uat.cardpointe.com/api'} style={inputStyle} /></div>
          <div><label style={labelStyle}>Terminal Authorization key{gw?.terminalConfigured ? ' (stored)' : ''}</label><input aria-label="Terminal Authorization key" value={boltApiKey} onChange={(e) => setBoltApiKey(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          <div><label style={labelStyle}>Tap to Pay merchant ID{gw?.tapToPayConfigured ? ` (${gw.tapToPayMerchantIdMasked})` : ''}</label><input aria-label="Tap to Pay merchant ID" value={ttpMerchantId} onChange={(e) => setTtpMerchantId(e.target.value)} placeholder="CommerceHub MID (salon default)" style={inputStyle} /></div>
          <div><label style={labelStyle}>Tap to Pay terminal ID</label><input aria-label="Tap to Pay terminal ID" value={ttpTerminalId} onChange={(e) => setTtpTerminalId(e.target.value)} placeholder="optional" style={inputStyle} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save gateway'}</button>
            <span className="s" style={{ color: 'var(--muted)' }}>Secrets are encrypted at rest; only a masked view is ever returned.</span>
          </div>
        </div>
      ) : null}

      {/* wave 3 PAYI §7/§10: per-location merchant accounts (the salon default above is what every other location uses) */}
      {!loading ? <BranchMerchantAccountsPanel tenantId={tenantId} branches={branches} /> : null}
    </div>
  );
}
