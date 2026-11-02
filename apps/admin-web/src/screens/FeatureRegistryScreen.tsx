// FeatureRegistryScreen — Constitution 7 §30–§33: every platform feature, its status (not one boolean), the kill switch
// that covers it, and "why is this on/off for salon X?" answered by the server's layered resolver.
// Phase 11 (Constitution 4 §76): each feature's ROLLOUT — percentage, selected salons allowed / denied, and a per-flag
// kill — edited with a reason (the server adds step-up, audits, and refuses a stale version).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface Feature { feature_key: string; name: string; category: string; status: string; requires_configuration: boolean; platform_kill_switch_supported: boolean; kill_switch_key: string | null }
const STATUSES = ['AVAILABLE', 'BETA', 'DISABLED', 'DEPRECATED'];
interface Rollout { flagKey: string; rolloutPercent: number; allowTenantIds: string[]; denyTenantIds: string[]; killed: boolean; reason: string | null; version: number }
interface RolloutEdit { key: string; percent: string; allow: string; deny: string; killed: boolean; reason: string; version: number | null }
const ids = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
export const rolloutLabel = (r: Rollout | undefined) => !r ? 'everyone (no policy)' : r.killed ? 'KILLED' : `${r.rolloutPercent}% · allow ${r.allowTenantIds.length} · deny ${r.denyTenantIds.length}`;

export function FeatureRegistryScreen() {
  const [rows, setRows] = useState<Feature[] | 'error' | null>(null);
  const [edit, setEdit] = useState<{ key: string; status: string; reason: string } | null>(null);
  const [probe, setProbe] = useState<{ key: string; tenantId: string; result?: any } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rollouts, setRollouts] = useState<Record<string, Rollout>>({});
  const [ro, setRo] = useState<RolloutEdit | null>(null);
  const load = useCallback(() => {
    api.get<Feature[]>('/super-admin/features').then(setRows).catch(() => setRows('error'));
    api.get<Rollout[]>('/super-admin/features/rollouts').then((l) => setRollouts(Object.fromEntries((l || []).map((r) => [r.flagKey, r])))).catch(() => setRollouts({}));
  }, []);
  const openRollout = (key: string) => { const r = rollouts[key]; setMsg(null); setRo({ key, percent: String(r?.rolloutPercent ?? 100), allow: (r?.allowTenantIds ?? []).join('\n'), deny: (r?.denyTenantIds ?? []).join('\n'), killed: !!r?.killed, reason: '', version: r ? r.version : null }); };
  const saveRollout = async () => {
    if (!ro) return; setMsg(null);
    const body: Record<string, unknown> = { rolloutPercent: Number(ro.percent), allowTenantIds: ids(ro.allow), denyTenantIds: ids(ro.deny), killed: ro.killed, reason: ro.reason.trim() };
    if (ro.version !== null) body.expectedVersion = ro.version;
    try { await api.put(`/super-admin/features/${ro.key}/rollout`, body); setRo(null); load(); } catch (e: any) { setMsg(e?.message || 'Could not save the rollout.'); }
  };
  useEffect(load, [load]);
  const save = async () => { if (!edit) return; setMsg(null); try { await api.patch(`/super-admin/features/${edit.key}`, { status: edit.status, reason: edit.reason.trim() }); setEdit(null); load(); } catch (e: any) { setMsg(e?.message || 'Could not change the status.'); } };
  const check = async () => { if (!probe) return; try { setProbe({ ...probe, result: await api.get(`/super-admin/features/${probe.key}/resolve`, { tenantId: probe.tenantId.trim() }) }); } catch (e: any) { setProbe({ ...probe, result: { error: e?.message || 'Could not resolve.' } }); } };
  return (
    <div className="screen">
      <div className="panel" data-testid="feature-registry">
        <div className="phead"><h2>Feature Registry</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>platform status · plans and overrides still decide entitlement · emergency stops live in Kill Switches</span></div>
        {msg ? <div className="error" role="alert">{msg}</div> : null}
        {rows === null ? <div className="state">Loading…</div> : rows === 'error' ? <div className="state">The registry could not be loaded.</div> : (
          <table className="table">
            <thead><tr><th>Feature</th><th>Category</th><th>Status</th><th>Rollout</th><th>Kill switch</th><th /></tr></thead>
            <tbody>{rows.map((f) => (
              <tr key={f.feature_key}>
                <td><b>{f.name}</b><div className="muted" style={{ fontSize: 11 }}>{f.feature_key}{f.requires_configuration ? ' · needs configuration' : ''}</div></td>
                <td>{f.category}</td>
                <td><span className="badge">{f.status}</span></td>
                <td style={{ fontSize: 12 }}>{rolloutLabel(rollouts[f.feature_key])}</td>
                <td>{f.kill_switch_key ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" onClick={() => setEdit({ key: f.feature_key, status: f.status === 'EMERGENCY_DISABLED' ? 'AVAILABLE' : f.status, reason: '' })}>Status…</button>
                  <button className="btn ghost" onClick={() => openRollout(f.feature_key)}>Rollout…</button>
                  <button className="btn ghost" onClick={() => setProbe({ key: f.feature_key, tenantId: '' })}>Check a salon…</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {edit ? (
          <div className="panel" data-testid="feature-status" style={{ marginTop: 10 }}>
            <b>{edit.key}</b>
            <select aria-label="Feature status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <input aria-label="Status reason" placeholder="Reason (required)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} style={{ minWidth: 220 }} />
            <button className="btn" disabled={edit.reason.trim().length < 10} onClick={save}>Save</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        ) : null}
        {ro ? (
          <div className="panel" data-testid="feature-rollout" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <b>Rollout — {ro.key}</b>
            <span className="muted" style={{ fontSize: 11 }}>Kill beats the deny list, the deny list beats the allow list, the allow list beats the percentage. A salon's place in the percentage never changes, so raising it only adds salons.</span>
            <label>Percent of salons <input aria-label="Rollout percent" type="number" min={0} max={100} value={ro.percent} onChange={(e) => setRo({ ...ro, percent: e.target.value })} style={{ width: 80 }} /></label>
            <label>Always on for (salon ids) <textarea aria-label="Allow salons" rows={2} value={ro.allow} onChange={(e) => setRo({ ...ro, allow: e.target.value })} /></label>
            <label>Never on for (salon ids) <textarea aria-label="Deny salons" rows={2} value={ro.deny} onChange={(e) => setRo({ ...ro, deny: e.target.value })} /></label>
            <label><input type="checkbox" aria-label="Kill this flag" checked={ro.killed} onChange={(e) => setRo({ ...ro, killed: e.target.checked })} /> Kill — off for every salon</label>
            <input aria-label="Rollout reason" placeholder="Reason (required)" value={ro.reason} onChange={(e) => setRo({ ...ro, reason: e.target.value })} />
            <div><button className="btn" disabled={ro.reason.trim().length < 10 || !/^\d{1,3}$/.test(ro.percent) || Number(ro.percent) > 100} onClick={saveRollout}>Save rollout</button>
              <button className="btn ghost" onClick={() => setRo(null)}>Cancel</button></div>
          </div>
        ) : null}
        {probe ? (
          <div className="panel" data-testid="feature-probe" style={{ marginTop: 10 }}>
            <b>Is {probe.key} active for a salon?</b>
            <input aria-label="Salon id" placeholder="Salon (tenant) id" value={probe.tenantId} onChange={(e) => setProbe({ ...probe, tenantId: e.target.value, result: undefined })} style={{ minWidth: 280 }} />
            <button className="btn" disabled={!probe.tenantId.trim()} onClick={check}>Check</button>
            {probe.result ? <div role="status" style={{ marginTop: 6 }}>{probe.result.error ? probe.result.error : probe.result.active ? `Active (${probe.result.status}, from ${probe.result.source})` : `Not active — ${probe.result.reason}: ${probe.result.detail}`}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
