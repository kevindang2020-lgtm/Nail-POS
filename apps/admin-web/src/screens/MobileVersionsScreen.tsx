// Super-Admin → System Operations → Mobile app versions — BUILD_PLAN Phase 13 B (Constitution 6 §55–57, §150).
//
// Per store app (Customer, Technician, Owner, Manager Pay) and native platform (iOS, Android):
//   • the version policy — minimum supported (a build below it gets the hard "Update required" screen and every API call
//     answers 426), recommended (a dismissible banner), latest, the store link and an optional message. No policy = nothing
//     refused. Raise the minimum only for a security issue, a breaking API change or a critical defect (§56).
//   • the installed versions seen in the last 7 days (distinct installs, from the apps' X-Client-* headers) and how many
//     are on an unsupported version.
// Saving needs a reason (≥ 10 characters, audited) and step-up; the row's version is sent so a stale edit is refused.
// Crash rate by version: the client error reports carry the version label (/client-telemetry) — the System Ops mobile
// panel (Phase 14) charts it; this screen links nothing it cannot show.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MobileVersionsOverview, MobileVersionRow, AppVersionState } from '@aipowersalon/api-contracts';

const APPS = [['customer', 'Customer'], ['tech', 'Technician'], ['owner', 'Owner'], ['manager-pay', 'Manager Pay']] as const;
const PLATFORMS = [['ios', 'iOS'], ['android', 'Android']] as const;
const MIN_REASON = 10;
const STATE_LABEL: Record<AppVersionState, string> = { SUPPORTED: 'Supported', UPDATE_RECOMMENDED: 'Update recommended', UPDATE_REQUIRED: 'Update required' };
const STATE_COLOR: Record<AppVersionState, string> = { SUPPORTED: '#3E8F57', UPDATE_RECOMMENDED: '#A0711B', UPDATE_REQUIRED: '#B85B4D' };
const appLabel = (a: string) => APPS.find(([k]) => k === a)?.[1] ?? a;
const platLabel = (p: string) => (p === 'web' ? 'Web' : PLATFORMS.find(([k]) => k === p)?.[1] ?? p);

interface Draft { app: string; platform: string; minSupported: string; recommended: string; latest: string; storeUrl: string; message: string; reason: string; expectedVersion: number | null }
const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function MobileVersionsScreen() {
  const [data, setData] = useState<MobileVersionsOverview | 'error' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { api.get<MobileVersionsOverview>('/super-admin/mobile-versions').then(setData).catch(() => setData('error')); }, []);
  useEffect(load, [load]);

  const rowFor = (app: string, platform: string): MobileVersionRow | null =>
    data && data !== 'error' ? data.rows.find((r) => r.app === app && r.platform === platform) ?? null : null;
  const startEdit = (app: string, platform: string) => {
    const r = rowFor(app, platform);
    setMsg(null);
    setDraft({ app, platform, minSupported: r?.minSupported ?? '', recommended: r?.recommended ?? '', latest: r?.latest ?? '', storeUrl: r?.storeUrl ?? '',
      message: r?.message ?? '', reason: '', expectedVersion: r ? r.version : null });
  };
  const save = async () => {
    if (!draft) return;
    setMsg(null);
    try {
      await api.put(`/super-admin/mobile-versions/${draft.app}/${draft.platform}`, {
        minSupported: orNull(draft.minSupported), recommended: orNull(draft.recommended), latest: orNull(draft.latest),
        storeUrl: orNull(draft.storeUrl), message: orNull(draft.message), reason: draft.reason.trim(), expectedVersion: draft.expectedVersion,
      });
      setDraft(null); load();
    } catch (e: any) { setMsg(e?.message || 'The version policy could not be saved.'); }
  };
  const field = (label: string, key: keyof Draft, placeholder = '') => (
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>{label}
      <input aria-label={label} value={String(draft?.[key] ?? '')} placeholder={placeholder} onChange={(e) => draft && setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="page">
      <div className="phead"><h1>Mobile app versions</h1></div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 760 }}>
        A build below its minimum is refused (every API call answers “update required” and the app shows the update screen with the store link);
        below the recommended version it shows a dismissible banner. Web apps, the customer display and the kiosk are never refused.
        Raise a minimum only for a security issue, a breaking API change or a critical defect — never for every release.
      </p>
      {msg ? <div className="error" role="alert">{msg}</div> : null}
      {data === null ? <div className="state">Loading…</div> : data === 'error' ? <div className="state">Mobile app versions could not be read.</div> : (
        <>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="phead"><h2>Version policies</h2></div>
            <table className="table" data-testid="mv-policies">
              <thead><tr><th>App</th><th>Platform</th><th>Minimum</th><th>Recommended</th><th>Latest</th><th>Store link</th><th /></tr></thead>
              <tbody>
                {APPS.flatMap(([app]) => PLATFORMS.map(([platform]) => {
                  const r = rowFor(app, platform);
                  const configured = !!(r && (r.minSupported || r.recommended || r.latest));
                  return (
                    <tr key={`${app}/${platform}`}>
                      <td>{appLabel(app)}</td><td>{platLabel(platform)}</td>
                      {configured ? <><td>{r!.minSupported ?? '—'}</td><td>{r!.recommended ?? '—'}</td><td>{r!.latest ?? '—'}</td></>
                        : <td colSpan={3} className="muted">Not set — nothing refused</td>}
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r?.storeUrl ?? '—'}</td>
                      <td><button className="btn ghost" aria-label={`Edit ${app} ${platform}`} onClick={() => startEdit(app, platform)}>Edit…</button></td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
            {draft ? (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 12 }}>
                <b style={{ gridColumn: '1 / -1' }}>{appLabel(draft.app)} · {platLabel(draft.platform)}</b>
                {field('Minimum supported', 'minSupported', 'e.g. 1.4.0')}
                {field('Recommended', 'recommended', 'e.g. 1.5.0')}
                {field('Latest', 'latest', 'e.g. 1.6.0')}
                {field('Store link', 'storeUrl', 'https://…')}
                {field('Message shown to users', 'message', 'optional')}
                {field('Reason', 'reason', 'required, audited')}
                <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
                  <button className="btn" disabled={draft.reason.trim().length < MIN_REASON} onClick={save}>Save</button>
                  <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="panel">
            <div className="phead"><h2>Installed versions</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>distinct installs seen in the last {data.windowDays} days</span></div>
            <p style={{ fontSize: 13 }}>{data.totals.installs} active installs · {data.totals.unsupported} on an unsupported version · {data.totals.recommendedUpdate} with an update recommended</p>
            {data.distribution.length === 0 ? <div className="state">No app has reported its version in the last {data.windowDays} days.</div> : (
              <table className="table" data-testid="mv-distribution">
                <thead><tr><th>App</th><th>Platform</th><th>Version</th><th>Installs</th><th>State</th></tr></thead>
                <tbody>{data.distribution.map((d) => (
                  <tr key={`${d.app}/${d.platform}/${d.version}`}>
                    <td>{appLabel(d.app)}</td><td>{platLabel(d.platform)}</td><td>{d.version}</td><td>{d.installs.toLocaleString('en-US')}</td>
                    <td><span className="badge" style={{ color: STATE_COLOR[d.state] }}>{STATE_LABEL[d.state]}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
