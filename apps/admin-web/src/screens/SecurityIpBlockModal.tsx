import { useEffect, useState, useCallback } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the IP-block engine. Preview (protected-source safety check) → confirm block → unblock. The Block
// button stays disabled unless the preview says the target is valid AND not protected, mirroring the server's refusal to
// block loopback/reserved/allowlisted/protected sources.

type BlockRow = { id: string; target: string; threatType: string | null; status: string; blockedAt: string | null };
type Preview = { valid: boolean; reason?: string; protected?: boolean; protectedReason?: string; wouldBlock?: boolean };
const THREATS = ['brute_force', 'credential_stuffing', 'malware', 'known_bot', 'suspicious_proxy', 'abuse_source', 'manual_block'];

export function SecurityIpBlockModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [target, setTarget] = useState('');
  const [threat, setThreat] = useState('manual_block');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { (superAdminApi.securityIpBlocks() as Promise<BlockRow[]>).then(setRows).catch((e: any) => setError(e?.message || 'Failed to load blocks.')); }, []);
  useEffect(() => { load(); }, [load]);

  const doPreview = async () => {
    setError(null); setPreview(null);
    try { setPreview((await superAdminApi.securityIpBlockPreview({ target })) as Preview); }
    catch (e: any) { setError(e?.message || 'Preview failed.'); }
  };
  const doBlock = async () => {
    if (!preview?.wouldBlock) return;
    setBusy(true); setError(null);
    try { await superAdminApi.securityIpBlock({ target, threatType: threat, reason }); setTarget(''); setReason(''); setPreview(null); load(); }
    catch (e: any) { setError(e?.message || 'Block failed.'); }
    finally { setBusy(false); }
  };
  const doUnblock = async (id: string) => {
    setBusy(true); setError(null);
    try { await superAdminApi.securityIpUnblock(id); load(); }
    catch (e: any) { setError(e?.message || 'Unblock failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Block IP addresses" style={{ width: 'min(680px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Block IP Addresses &amp; Threat Signals</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Add a block</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
              <label style={{ fontSize: 10.5 }} className="muted">IP address or CIDR
                <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }} placeholder="203.0.113.45 or 203.0.113.0/24" />
              </label>
              <button className="btn ghost" onClick={doPreview} disabled={!target.trim()}>Preview</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 10.5 }} className="muted">Threat type
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={threat} onChange={(e) => setThreat(e.target.value)}>{THREATS.map((t) => <option key={t} value={t}>{t.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')}</option>)}</select>
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Reason
                <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional note" />
              </label>
            </div>
            {preview && (
              <div style={{ marginTop: 8, fontSize: 11.5 }}>
                {!preview.valid ? <span style={{ color: '#C0392B' }}>Invalid: {preview.reason}</span>
                  : preview.protected ? <span style={{ color: '#B7791F' }}>⚠ Protected source — cannot be blocked ({preview.protectedReason}). This prevents locking out trusted access.</span>
                  : <span style={{ color: '#1F9254' }}>✓ Valid and not protected — safe to block.</span>}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={doBlock} disabled={busy || !preview?.wouldBlock} style={{ background: preview?.wouldBlock ? '#C0392B' : undefined, borderColor: preview?.wouldBlock ? '#C0392B' : undefined }}>Block this source</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Current blocks</div>
            {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
              : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No IP blocks recorded.</div>
              : (
                <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>IP / CIDR</th><th>Threat</th><th>Status</th><th></th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.target}</td>
                      <td className="muted">{r.threatType ? r.threatType.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '—'}</td>
                      <td><span style={{ fontWeight: 600, color: r.status === 'blocked' ? '#C0392B' : '#6B7280' }}>{r.status}</span></td>
                      <td>{r.status === 'blocked' ? <button className="linkbtn" style={{ fontSize: 10.5 }} disabled={busy} onClick={() => doUnblock(r.id)}>Unblock</button> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
