// OwnerCommunitySettingsScreen.tsx — BUILD_PLAN Phase 8 (tenant_safety_community): the salon's Safety Community settings in
// the Owner App (GET / PUT /community/settings, contract §2.3). Participation, approvals, how the salon is shown, anonymous
// posting, technicians' read access, retention, regions and the salon's alert preferences. PUT carries `expectedVersion`
// (0 = first save); a 409 reloads and says so. A session without community.settings.manage (403 on save) is told plainly.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ownerCommunityApi, type CommunitySettingsView } from '../api/ownerCommunityApi';
import { useOwnerNav } from '../shell/nav';
import { ownerCommunityError } from './OwnerCommunityCard';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="owner-menurow" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ml">{label}</span>
    </label>
  );
}
const field: CSSProperties = { display: 'grid', gap: 4, fontSize: 12.5, padding: '8px 12px' };
const inputStyle: CSSProperties = { fontFamily: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--owner-border, #E7DCC8)' };

export function OwnerCommunitySettingsScreen() {
  const { back } = useOwnerNav();
  const [view, setView] = useState<CommunitySettingsView | null>(null);
  const [d, setD] = useState<CommunitySettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => ownerCommunityApi.settings().then((s) => { setView(s); setD(s); }).catch((e) => setError(ownerCommunityError(e, 'Could not load the community settings.'))), []);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof CommunitySettingsView>(k: K, v: CommunitySettingsView[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const techView = !!d?.roleGrants?.technician?.includes('view_community');
  const setTechView = (on: boolean) => setD((x) => {
    if (!x) return x;
    const cur = (x.roleGrants?.technician ?? []).filter((c) => c !== 'view_community');
    return { ...x, roleGrants: { ...(x.roleGrants ?? {}), technician: on ? [...cur, 'view_community'] : cur } };
  });
  const save = async () => {
    if (!d || !view) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const s = await ownerCommunityApi.saveSettings({
        expectedVersion: view.version, enabled: d.enabled, receptionistApprovalRequired: d.receptionistApprovalRequired,
        managerApprovalRequired: d.managerApprovalRequired, displayName: d.displayName?.trim() || null, authorDisplay: d.authorDisplay,
        allowAnonymous: d.allowAnonymous, branchVisibility: d.branchVisibility, retentionDays: d.retentionDays, regionPreferences: d.regionPreferences,
        notify: d.notify, roleGrants: d.roleGrants, roleRemovals: d.roleRemovals,
      });
      setView(s); setD(s); setNotice('Community settings saved.');
    } catch (e) { if ((e as { status?: number })?.status === 409) await load(); setError(ownerCommunityError(e, 'The settings were not saved.')); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Safety Community</div></div>
        <div style={{ width: 40 }} />
      </header>
      <div style={{ paddingBlock: 12 }} data-testid="owner-community-settings">
        {notice ? <div role="status" className="owner-text-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{notice}</div> : null}
        {error ? <div role="alert" className="owner-state" style={{ marginBottom: 8 }}>{error}</div> : null}
        {!d ? (!error ? <div className="owner-state owner-text-muted">Loading…</div> : null) : (
          <>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head"><h6>PARTICIPATION</h6><p>Share and receive sanitized safety advisories with other salons</p></div>
              <div className="owner-menu-card">
                <Toggle label="Take part in the Safety Community" checked={d.enabled} onChange={(v) => set('enabled', v)} />
                <Toggle label="Front-desk advisories need a manager's approval" checked={d.receptionistApprovalRequired} onChange={(v) => set('receptionistApprovalRequired', v)} />
                <Toggle label="Managers' advisories need a second approval" checked={d.managerApprovalRequired} onChange={(v) => set('managerApprovalRequired', v)} />
                <Toggle label="Technicians can read the Safety Community" checked={techView} onChange={setTechView} />
                <Toggle label="Allow anonymous posts" checked={d.allowAnonymous} onChange={(v) => set('allowAnonymous', v)} />
              </div>
            </section>
            <section className="owner-menu-section" style={{ marginTop: 14 }}>
              <div className="owner-menu-section-head"><h6>HOW WE ARE SHOWN</h6><p>Other salons never see your ids — only this label</p></div>
              <div className="owner-menu-card">
                <label style={field}>Community display name<input style={inputStyle} value={d.displayName ?? ''} onChange={(e) => set('displayName', e.target.value)} /></label>
                <label style={field}>Show our salon as
                  <select style={inputStyle} value={d.authorDisplay} onChange={(e) => set('authorDisplay', e.target.value as CommunitySettingsView['authorDisplay'])}>
                    <option value="tenant_name">Our salon name</option><option value="display_name">Our community display name</option>
                    <option value="anonymous" disabled={!d.allowAnonymous}>Anonymous</option>
                  </select>
                </label>
                <label style={field}>Who in our salon sees advisories
                  <select style={inputStyle} value={d.branchVisibility} onChange={(e) => set('branchVisibility', e.target.value as 'tenant' | 'own_branch')}>
                    <option value="tenant">Every location</option><option value="own_branch">Only the location that posted</option>
                  </select>
                </label>
                <label style={field}>Keep drafts and private incidents for (days)<input type="number" style={inputStyle} value={d.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value) || 0)} /></label>
                <label style={field}>Regions we care about<input style={inputStyle} value={d.regionPreferences.join(', ')} onChange={(e) => set('regionPreferences', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
              </div>
            </section>
            <section className="owner-menu-section" style={{ marginTop: 14 }}>
              <div className="owner-menu-section-head"><h6>ALERTS</h6><p>How the salon is told about new advisories</p></div>
              <div className="owner-menu-card">
                <Toggle label="Push notifications" checked={d.notify.push} onChange={(v) => set('notify', { ...d.notify, push: v })} />
                <Toggle label="Email" checked={d.notify.email} onChange={(v) => set('notify', { ...d.notify, email: v })} />
                <Toggle label="SMS for critical alerts" checked={d.notify.criticalSms} onChange={(v) => set('notify', { ...d.notify, criticalSms: v })} />
              </div>
            </section>
            <button className="owner-btn" style={{ marginTop: 14 }} disabled={busy} onClick={save}>Save community settings</button>
          </>
        )}
      </div>
    </>
  );
}
