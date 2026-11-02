// BranchMerchantAccountsPanel.tsx — Super Admin: a multi-location salon's BRANCH merchant accounts (Payments mandate §7 /
// §10 / §51 / §53, wave 3). Drives GET/POST /super-admin/tenants/:id/payment-gateway/branches[/:branchId[/test-connection
// |/status]]. Shows only the MASKED account; credential inputs are write-only (never pre-filled, cleared after save).
// A branch without a row inherits the salon default — that is stated, never faked as "configured".
import { useCallback, useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import type { CSSProperties } from 'react';
import { superAdminApi, type BranchMerchantAccount } from '../api/superAdminApi';

const inputStyle: CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', background: '#FFFDF8', outline: 'none', width: '100%', boxSizing: 'border-box' };
const labelStyle: CSSProperties = { fontSize: 11, color: 'var(--soft)', marginBottom: 3, display: 'block' };
const PROCESSORS = ['fiserv', 'cardpointe', 'clover'];
const ENVS = ['sandbox', 'production'];
const STATUSES = ['pending', 'active', 'disabled'];
const tone = (s: string) => (s === 'active' ? 'var(--ok)' : s === 'error' ? 'var(--danger)' : 'var(--warn)');

export type BranchOption = { id: string; name: string };

export function BranchMerchantAccountsPanel({ tenantId, branches }: { tenantId: string; branches?: BranchOption[] }) {
  const [rows, setRows] = useState<BranchMerchantAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);   // branchId being configured
  const [processorType, setProcessorType] = useState('fiserv');
  const [environment, setEnvironment] = useState('sandbox');
  const [status, setStatus] = useState('pending');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [boltBaseUrl, setBoltBaseUrl] = useState('');
  const [boltApiKey, setBoltApiKey] = useState('');
  const [ttpMerchantId, setTtpMerchantId] = useState('');
  const [ttpTerminalId, setTtpTerminalId] = useState('');
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();

  const load = useCallback(() => {
    setError(null);
    superAdminApi.listBranchMerchants(tenantId).then(setRows).catch((e: any) => { setRows([]); setError(e?.message || 'Could not load branch merchant accounts'); });
  }, [tenantId]);
  useEffect(load, [load]);

  const startEdit = (branchId: string, row?: BranchMerchantAccount) => {
    setEditing(branchId); setNote(null); setError(null);
    setProcessorType(row?.processorType && row.processorType !== 'none' ? row.processorType : 'fiserv');
    setEnvironment(row?.environment || 'sandbox');
    setStatus(row && STATUSES.includes(row.status) ? row.status : 'pending');
    setDisplayName(row?.displayName || '');
    setBaseUrl(''); setMerchantId(''); setApiUsername(''); setApiPassword(''); setWebhookSecret(''); setBoltBaseUrl(''); setBoltApiKey(''); setTtpMerchantId(''); setTtpTerminalId('');
  };

  const save = async () => {
    if (!editing) return;
    setBusy('save'); setNote(null); setError(null);
    const body: Record<string, unknown> = { processorType, environment, status, displayName: displayName.trim() || null };
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
      await superAdminApi.setBranchMerchant(tenantId, editing, body);
      setNote('Saved — credentials encrypted at rest, shown masked.');
      setEditing(null); load();
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setBusy(null); }
  };

  const test = async (branchId: string) => {
    setBusy('test:' + branchId); setNote(null); setError(null);
    try { const r = await superAdminApi.testBranchMerchant(tenantId, branchId); setNote((r.ok ? '✓ ' : '· ') + r.note); load(); }
    catch (e: any) { setError(e?.message || 'Test failed'); }
    finally { setBusy(null); }
  };

  const statusAction = (branchId: string, action: 'pause' | 'resume' | 'disable') => {
    const run = async () => {
      setBusy(action + ':' + branchId); setNote(null); setError(null);
      try { await superAdminApi.branchMerchantStatus(tenantId, branchId, action); setNote(`Merchant account ${action === 'resume' ? 'resumed' : action + 'd'}.`); load(); }
      catch (e: any) { setError(e?.message || 'Could not change status'); }
      finally { setBusy(null); }
    };
    if (action === 'disable') askConfirm('Disable this location\'s merchant account? Card payments at this location stop until it is resumed (they do NOT fall back to the salon default).', () => { void run(); }, { confirmLabel: 'Disable' });
    else void run();
  };

  const known = new Set((rows || []).map((r) => r.branchId));
  const addable = rows === null ? [] : (branches || []).filter((b) => !known.has(b.id));   // only once we know who already has one

  return (
    <div style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8', marginTop: 8 }}>
      {confirmUi}
      <div className="s" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Branch merchant accounts</span>
        <span className="s" style={{ color: 'var(--muted)' }}>A location with its own MID settles separately; every other location uses the salon gateway above.</span>
        {addable.length ? (
          <select aria-label="Add merchant account for location" style={{ ...inputStyle, width: 'auto', marginLeft: 'auto' }} value="" onChange={(e) => { if (e.target.value) startEdit(e.target.value); }} disabled={!!busy}>
            <option value="">Add for location…</option>
            {addable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
      </div>
      {error ? <div className="err" style={{ marginBottom: 8 }}>{error}</div> : null}
      {note ? <div className="s" style={{ color: 'var(--ok)', marginBottom: 8 }}>{note}</div> : null}
      {rows === null ? <div className="muted s">Loading branch merchant accounts…</div> : rows.length === 0 ? (
        <div className="muted s">No location has its own merchant account — every location charges through the salon gateway.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--soft)' }}><th style={{ padding: '4px 6px' }}>Location</th><th style={{ padding: '4px 6px' }}>Processor</th><th style={{ padding: '4px 6px' }}>Merchant</th><th style={{ padding: '4px 6px' }}>Env</th><th style={{ padding: '4px 6px' }}>Status</th><th style={{ padding: '4px 6px' }}>Terminal API</th><th style={{ padding: '4px 6px' }}>Tap to Pay</th><th style={{ padding: '4px 6px' }}>Last test</th><th style={{ padding: '4px 6px' }}></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>{r.branchName || r.branchId.slice(0, 8)}{r.displayName ? <span className="muted"> · {r.displayName}</span> : null}</td>
              <td style={{ padding: '4px 6px' }}>{r.processorType}</td>
              <td style={{ padding: '4px 6px' }}>{r.merchantIdMasked || '—'}{!r.credentialsConfigured ? <span className="pill" style={{ marginLeft: 6, color: 'var(--warn)' }}>credentials missing</span> : null}</td>
              <td style={{ padding: '4px 6px' }}>{r.environment}</td>
              <td style={{ padding: '4px 6px' }}><span className="pill" style={{ color: tone(r.status) }}>{r.status}</span></td>
              <td style={{ padding: '4px 6px' }}>{r.terminalConfigured ? 'Bolt key stored' : '—'}</td>
              <td style={{ padding: '4px 6px' }}>{r.tapToPayConfigured ? r.tapToPayMerchantIdMasked : <span className="muted">not set</span>}</td>
              <td style={{ padding: '4px 6px' }}>{r.lastValidatedAt ? <span style={{ color: 'var(--ok)' }}>✓ {new Date(r.lastValidatedAt).toLocaleString()}</span> : r.lastValidationError ? <span style={{ color: 'var(--danger)' }} title={r.lastValidationError}>✗ failed</span> : 'untested'}</td>
              <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                <button className="btn ghost sm" onClick={() => startEdit(r.branchId, r)} disabled={!!busy}>Edit</button>{' '}
                <button className="btn ghost sm" onClick={() => test(r.branchId)} disabled={!!busy}>{busy === 'test:' + r.branchId ? 'Testing…' : 'Test'}</button>{' '}
                {r.status === 'active' ? <button className="btn ghost sm" onClick={() => statusAction(r.branchId, 'pause')} disabled={!!busy}>Pause</button> : null}
                {r.status === 'paused' || r.status === 'disabled' ? <button className="btn ghost sm" onClick={() => statusAction(r.branchId, 'resume')} disabled={!!busy}>Resume</button> : null}{' '}
                {r.status !== 'disabled' ? <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => statusAction(r.branchId, 'disable')} disabled={!!busy}>Disable</button> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}

      {editing ? (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }} className="s"><b>{(branches || []).find((b) => b.id === editing)?.name || rows?.find((r) => r.branchId === editing)?.branchName || 'Location'}</b> — merchant account</div>
          <div><label style={labelStyle}>Processor</label><select aria-label="Branch processor" value={processorType} onChange={(e) => setProcessorType(e.target.value)} style={inputStyle}>{PROCESSORS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Environment</label><select aria-label="Branch environment" value={environment} onChange={(e) => setEnvironment(e.target.value)} style={inputStyle}>{ENVS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Status</label><select aria-label="Branch merchant status" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>{STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={labelStyle}>Display name</label><input aria-label="Branch merchant display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Cherry Hill merchant" style={inputStyle} /></div>
          <div><label style={labelStyle}>Base URL</label><input aria-label="Branch base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={processorType === 'clover' ? 'https://scl.clover.com' : 'https://<site>.cardconnect.com'} style={inputStyle} /></div>
          <div><label style={labelStyle}>Merchant ID</label><input aria-label="Branch merchant ID" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="MID (write-only)" style={inputStyle} /></div>
          <div><label style={labelStyle}>{processorType === 'clover' ? 'API token' : 'API password'}</label><input aria-label="Branch API password" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          {processorType !== 'clover' ? <div><label style={labelStyle}>API username</label><input aria-label="Branch API username" value={apiUsername} onChange={(e) => setApiUsername(e.target.value)} placeholder="write-only" style={inputStyle} /></div> : null}
          <div><label style={labelStyle}>Webhook secret</label><input aria-label="Branch webhook secret" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          <div><label style={labelStyle}>Terminal API base (Bolt)</label><input aria-label="Branch terminal API base" value={boltBaseUrl} onChange={(e) => setBoltBaseUrl(e.target.value)} placeholder="https://bolt-uat.cardpointe.com/api" style={inputStyle} /></div>
          <div><label style={labelStyle}>Terminal Authorization key</label><input aria-label="Branch terminal Authorization key" value={boltApiKey} onChange={(e) => setBoltApiKey(e.target.value)} placeholder="write-only" style={inputStyle} /></div>
          <div><label style={labelStyle}>Tap to Pay merchant ID</label><input aria-label="Branch Tap to Pay merchant ID" value={ttpMerchantId} onChange={(e) => setTtpMerchantId(e.target.value)} placeholder="CommerceHub MID for this location" style={inputStyle} /></div>
          <div><label style={labelStyle}>Tap to Pay terminal ID</label><input aria-label="Branch Tap to Pay terminal ID" value={ttpTerminalId} onChange={(e) => setTtpTerminalId(e.target.value)} placeholder="optional" style={inputStyle} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save merchant account'}</button>
            <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy === 'save'}>Cancel</button>
            <span className="s" style={{ color: 'var(--muted)' }}>Secrets are encrypted at rest; only a masked view is ever returned.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
