import { useEffect, useState, useCallback } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the data-retention engine. Set per-class retention (with the compliance-minimum floor shown), and run
// a NON-DESTRUCTIVE dry-run purge preview (count only — nothing deleted). A retention below the floor is rejected by the
// server and the error is surfaced. Physical purge is a data-plane integration and is intentionally not offered here.

type RuleRow = { id: string; dataClass: string; version: number; status: string; retentionDays: number; action: string };
type Preview = { dataClass: string; action: string; cutoff: string; eligibleCount: number; netToProcess: number; message: string };
const DATA_CLASSES = ['audit_events', 'login_attempts', 'report_exports', 'notifications', 'customer_privacy_requests', 'session_history', 'device_heartbeats'];
const ACTIONS = ['delete', 'anonymize', 'archive'];
// Compliance floors (days) — mirrors retention-core MIN_RETENTION_DAYS (shown as guidance).
const FLOORS: Record<string, number> = { audit_events: 365, login_attempts: 90, report_exports: 180, customer_privacy_requests: 365, notifications: 30, session_history: 30, device_heartbeats: 7 };
const cap = (s: string) => s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : s;

export function SecurityRetentionModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [dataClass, setDataClass] = useState('audit_events');
  const [retentionDays, setRetentionDays] = useState<string>('');
  const [action, setAction] = useState('archive');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => { (superAdminApi.securityRetentionRules() as Promise<RuleRow[]>).then(setRows).catch((e: any) => setError(e?.message || 'Failed to load rules.')); }, []);
  useEffect(() => { load(); }, [load]);

  const floor = FLOORS[dataClass] ?? 0;
  const daysNum = Number(retentionDays);
  const belowFloor = retentionDays !== '' && Number.isFinite(daysNum) && daysNum < floor;
  const canSave = retentionDays !== '' && Number.isInteger(daysNum) && daysNum >= 0 && !belowFloor;

  const doSave = async () => {
    setBusy(true); setError(null); setSaved(null);
    try { const r: any = await superAdminApi.securityRetentionRuleSet(dataClass, { retentionDays: daysNum, action }); setSaved(`Saved ${cap(dataClass)} retention v${r?.version ?? ''}: ${r?.retentionDays ?? daysNum}d ${r?.action ?? action}.`); load(); }
    catch (e: any) { setError(e?.message || 'Save failed.'); }
    finally { setBusy(false); }
  };
  const doPreview = async (dc: string) => {
    setBusy(true); setError(null); setPreview(null); setPreviewNote(null);
    try { setPreview((await superAdminApi.securityRetentionPurgePreview(dc)) as Preview); }
    catch (e: any) { setPreviewNote(e?.message || 'Preview not available for this data class.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Data-retention rules" style={{ width: 'min(720px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Data-Retention Rules</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}
          {saved && <div role="status" style={{ fontSize: 12, background: '#E7F5EC', border: '1px solid #B7E0C4', borderRadius: 8, padding: '8px 12px', color: '#1F6B41' }}>{saved}</div>}

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Set a retention rule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <label style={{ fontSize: 10.5 }} className="muted">Data class
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={dataClass} onChange={(e) => { setDataClass(e.target.value); setSaved(null); }}>{DATA_CLASSES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select>
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Retention (days)
                <input className="inp" type="number" style={{ width: '100%', height: 32, marginTop: 2 }} value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} placeholder={`≥ ${floor}`} />
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Action
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={action} onChange={(e) => setAction(e.target.value)}>{ACTIONS.map((a) => <option key={a} value={a}>{cap(a)}</option>)}</select>
              </label>
              <button className="btn" onClick={doSave} disabled={busy || !canSave}>Save rule</button>
            </div>
            <div style={{ fontSize: 10.5, marginTop: 6, color: belowFloor ? '#C0392B' : 'var(--muted)' }}>
              {belowFloor ? `Below the compliance minimum of ${floor} days for ${cap(dataClass)}.` : `Compliance minimum for ${cap(dataClass)}: ${floor} days.`}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Active rules</div>
            {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
              : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No retention rules configured.</div>
              : (
                <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Data class</th><th>Retention</th><th>Action</th><th>Status</th><th></th></tr></thead>
                  <tbody>{rows.filter((r) => r.status === 'active').map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{cap(r.dataClass)}</td>
                      <td>{r.retentionDays}d</td>
                      <td className="muted">{cap(r.action)}</td>
                      <td className="muted">{cap(r.status)} v{r.version}</td>
                      <td><button className="linkbtn" style={{ fontSize: 10.5 }} disabled={busy} onClick={() => doPreview(r.dataClass)}>Preview purge</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>

          {preview && (
            <div role="status" style={{ border: '1px solid #B8CCF0', background: '#EAF1FF', borderRadius: 8, padding: 12, fontSize: 11.5, color: '#274690' }}>
              <b>Dry run — {cap(preview.dataClass)}:</b> {preview.message}
            </div>
          )}
          {previewNote && <div style={{ border: '1px solid #F0D9A8', background: '#FBF0DC', borderRadius: 8, padding: 12, fontSize: 11.5, color: '#8A6D1B' }}>{previewNote}</div>}
          <div className="muted" style={{ fontSize: 10 }}>Preview is a non-destructive dry run (count only). Physical purge is a separate, guarded data-plane operation.</div>
        </div>
      </div>
    </div>
  );
}
