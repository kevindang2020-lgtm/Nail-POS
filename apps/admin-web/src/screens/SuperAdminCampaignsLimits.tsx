// CampaignLimitsModal — configure platform campaign limits (max sends/day, max campaigns/day, quiet hours, minimum
// hours between sends). Prefills from the active limits; validation mirrors the server engine (non-negative, hours
// 0–23). Applies to platform sending policy.
import { useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };
const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Math.trunc(Number(v)));

export function CampaignLimitsModal({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ maxSendsPerDay: '', maxCampaignsPerDay: '', quietHoursStart: '', quietHoursEnd: '', minHoursBetween: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.getCampaignLimits().then((l) => {
      if (l) setF({
        maxSendsPerDay: l.maxSendsPerDay?.toString() ?? '', maxCampaignsPerDay: l.maxCampaignsPerDay?.toString() ?? '',
        quietHoursStart: l.quietHoursStart?.toString() ?? '', quietHoursEnd: l.quietHoursEnd?.toString() ?? '', minHoursBetween: l.minHoursBetween?.toString() ?? '',
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const validate = (): string[] => {
    const e: string[] = [];
    const nn = (v: string, label: string) => { if (v.trim() !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0)) e.push(`${label} must be a non-negative whole number.`); };
    const hr = (v: string, label: string) => { if (v.trim() !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 23)) e.push(`${label} must be an hour 0–23.`); };
    nn(f.maxSendsPerDay, 'Max sends per day'); nn(f.maxCampaignsPerDay, 'Max campaigns per day'); nn(f.minHoursBetween, 'Minimum hours between sends');
    hr(f.quietHoursStart, 'Quiet hours start'); hr(f.quietHoursEnd, 'Quiet hours end');
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.setCampaignLimits({
        maxSendsPerDay: numOrNull(f.maxSendsPerDay), maxCampaignsPerDay: numOrNull(f.maxCampaignsPerDay),
        quietHoursStart: numOrNull(f.quietHoursStart), quietHoursEnd: numOrNull(f.quietHoursEnd), minHoursBetween: numOrNull(f.minHoursBetween),
      });
      if (!res.ok) { setErrors(res.errors || ['Could not save limits.']); setBusy(false); return; }
      onSaved('Campaign limits saved. New sends are governed by these platform limits.');
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Configure campaign limits" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Configure Campaign Limits</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Platform-level sending policy. Leave a field blank for no limit.</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        {loading ? <div className="state">Loading current limits…</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lab}>Max sends / day<input className="inp" style={fld} inputMode="numeric" value={f.maxSendsPerDay} onChange={(e) => setF({ ...f, maxSendsPerDay: e.target.value })} /></label>
              <label style={lab}>Max campaigns / day<input className="inp" style={fld} inputMode="numeric" value={f.maxCampaignsPerDay} onChange={(e) => setF({ ...f, maxCampaignsPerDay: e.target.value })} /></label>
              <label style={lab}>Quiet hours start (0–23)<input className="inp" style={fld} inputMode="numeric" value={f.quietHoursStart} onChange={(e) => setF({ ...f, quietHoursStart: e.target.value })} /></label>
              <label style={lab}>Quiet hours end (0–23)<input className="inp" style={fld} inputMode="numeric" value={f.quietHoursEnd} onChange={(e) => setF({ ...f, quietHoursEnd: e.target.value })} /></label>
              <label style={lab}>Min hours between sends<input className="inp" style={fld} inputMode="numeric" value={f.minHoursBetween} onChange={(e) => setF({ ...f, minHoursBetween: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save limits'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
