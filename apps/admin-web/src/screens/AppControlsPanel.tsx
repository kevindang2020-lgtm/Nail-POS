// AppControlsPanel.tsx — per-tenant App Controls (build doc §26), inside the Tenants → Manage panel.
// Six flags from GET /super-admin/platform/app-flags/:tenantId; toggles POST explicit overrides; "Reset" sends
// null to revert to the platform default. Discovery flags (public listing / show on map) default OFF — opt-in.
import { useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { useCan } from '../auth/useCan';

const LABELS: Record<string, string> = {
  public_listing: 'Public listing in Customer App search',
  show_on_map: 'Show salon on customer map',
  customer_app_booking: 'Customer App booking',
  technician_app: 'Technician App',
  customer_service_progress: 'Customer can view service progress',
  tech_live_ticket_edit: 'Tech live ticket edit',
};

type Flag = { key: string; default: boolean; override: boolean | null; enabled: boolean };

export function AppControlsPanel({ tenantId }: { tenantId: string }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mayRead = useCan()('super_admin.plans.view');   // app flags are a Plans & Feature Limits read
  const load = () => !mayRead ? (setErr('App controls need the Plans permission (super_admin.plans.view).'), Promise.resolve()) : superAdminApi.appFlags(tenantId).then((r: any) => setFlags(r.flags)).catch((e: any) => setErr(e?.message || 'Could not load app controls.'));
  useEffect(() => { load(); }, [tenantId]);

  const set = async (key: string, enabled: boolean | null) => {
    setBusy(key); setErr(null);
    try { await superAdminApi.setAppFlag(tenantId, key, enabled); await load(); }
    catch (e: any) { setErr(e?.message || 'Update failed.'); } finally { setBusy(null); }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8' }}>
      <div className="s" style={{ marginBottom: 6 }}>App Controls</div>
      {err ? <div className="s" style={{ color: 'var(--danger)', marginBottom: 6 }}>{err}</div> : null}
      {!flags ? <div className="s muted">Loading…</div> : flags.map((f) => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{LABELS[f.key] || f.key}</div>
            <div className="s muted" style={{ fontSize: 11 }}>{f.override === null ? `Default (${f.default ? 'on' : 'off'})` : `Override: ${f.override ? 'on' : 'off'}`}</div>
          </div>
          <button className="btn ghost" aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${LABELS[f.key] || f.key}`} disabled={busy === f.key}
            onClick={() => set(f.key, !f.enabled)}>{busy === f.key ? '…' : f.enabled ? 'On' : 'Off'}</button>
          {f.override !== null ? (
            <button className="btn ghost" aria-label={`Reset ${LABELS[f.key] || f.key}`} disabled={busy === f.key} onClick={() => set(f.key, null)}>Reset</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
