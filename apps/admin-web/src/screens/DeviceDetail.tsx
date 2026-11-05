// DeviceDetailDrawer — the full view of a managed device (§14). Shows identity, assignment, software, connectivity,
// security/session, and maintenance. Never displays device secrets, tokens, or private keys; IP is masked.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi, type DmDeviceDetail } from '../api/superAdminApi';

const statusTone = (s: string) => (/(online|active|compliant|unlocked|up to date)/i.test(s) ? 'ok' : /(offline|revoked|locked|non-compliant|compromised|failed)/i.test(s) ? 'bad' : 'warn');

export function DeviceDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<DmDeviceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null); setD(null);
    superAdminApi.deviceMgmtDevice(id).then((r) => { if (r.ok && r.device) setD(r.device); else setErr((r.errors || ['Device not found.']).join(' ')); }).catch((e: any) => setErr(e?.message || 'Failed to load.'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const Field = ({ label, value, badge }: { label: string; value: React.ReactNode; badge?: boolean }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F3ECE1' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{badge && typeof value === 'string' ? <span className={'pill ' + statusTone(value)}>{value}</span> : value}</span>
    </div>
  );
  const Group = ({ title }: { title: string }) => <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g7,#A96F22)', marginTop: 12, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>;

  return (
    <div role="dialog" aria-modal="true" aria-label="Device details" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 60 }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(460px, 96vw)', height: '100vh', overflowY: 'auto', background: '#fff', borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Device Details</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {err ? <div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div>
          : !d ? <div className="state">Loading…</div>
          : (
            <>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{d.type} · {d.id}</div>

              <Group title="Identity" />
              <Field label="Serial number" value={<span style={{ fontFamily: 'monospace' }}>{d.serial}</span>} />
              <Field label="Ownership" value={d.ownershipType} />
              <Field label="Manufacturer" value={d.manufacturer} />
              <Field label="Model" value={d.model} />

              <Group title="Assignment" />
              <Field label="Tenant" value={d.tenant} />
              <Field label="Branch" value={d.branch} />
              <Field label="Assigned user" value={d.assignedUser} />
              <Field label="Merchant terminal" value={<span style={{ fontFamily: 'monospace' }}>{d.merchantTerminalId}</span>} />

              <Group title="Software" />
              <Field label="Operating system" value={`${d.os}`} />
              <Field label="App version" value={d.appVersion} />
              <Field label="Min required" value={d.minRequiredVersion} />
              <Field label="Config version" value={d.configVersion} />
              <Field label="Update status" value={d.updateStatus} badge />

              <Group title="Connectivity" />
              <Field label="Connection" value={d.connectionStatus} badge />
              <Field label="Last heartbeat" value={d.lastHeartbeat} />
              <Field label="IP address" value={<span style={{ fontFamily: 'monospace' }}>{d.ipMasked}</span>} />
              <Field label="Network" value={d.networkType} />

              <Group title="Security & Session" />
              <Field label="Security status" value={d.securityStatus} badge />
              <Field label="Session" value={d.sessionStatus} badge />
              <Field label="Lock status" value={d.lockStatus} badge />
              <Field label="Certificate" value={d.certificateStatus} />

              <Group title="Maintenance" />
              <Field label="Maintenance" value={d.maintenanceStatus} />

              <div className="panel" style={{ marginTop: 12, borderLeft: '4px solid #3B82C4', background: '#EFF6FC', fontSize: 11.5 }}>{d.note}</div>
            </>
          )}
      </div>
    </div>
  );
}
