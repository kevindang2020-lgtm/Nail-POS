// AdvertisingScreen.tsx — Global Advertising + Tenant Control guide (Nov 5 2026, G7): Super Admin → Advertising &
// Customer Display. English only.
//   • the ONE master switch "Allow Tenant Advertising" — ON = each salon's own ads, OFF = AI PowerSalon's ads only (never
//     mixed). A change shows its preview first (salons with live ads, displays online / offline, platform ads ready),
//     needs a reason and a fresh step-up, and refuses an empty platform playlist unless the neutral panel is confirmed.
//   • fleet status from the displays' own acknowledgments: Connected / Policy applied / Offline or pending — no invented
//     counts; a dash until the server answers.
//   • AI PowerSalon's campaigns: upload a picture (the same validated pipeline as salon ads), title, text, QR link,
//     duration, schedule; Save Draft is separate from Publish; publishing never changes the switch.
import { useCallback, useEffect, useState } from 'react';
import { superAdminAdvertisingApi as api } from '../../api/superAdminAdvertisingApi';
import { prepareAdImage } from './adImagePipeline';

const LIMITS = { maxFileBytes: 15 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const };
const dash = (v: unknown) => (v == null ? '—' : String(v));
const errText = (e: any, d: string) => e?.body?.message || e?.message || d;
const Card = ({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) => (
  <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm" data-testid={testId}>
    <div className="text-xs text-[#7A6C57]">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div>{sub ? <div className="mt-1 text-xs text-[#7A6C57]">{sub}</div> : null}
  </div>);

export function AdvertisingScreen() {
  const [pol, setPol] = useState<any | null>(null);
  const [fleet, setFleet] = useState<any | null>(null);
  const [ads, setAds] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [change, setChange] = useState<{ allow: boolean; reason: string; neutral: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fleetStatus, setFleetStatus] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const load = useCallback(() => {
    api.policy().then(setPol).catch((e) => setErr(errText(e, 'Could not load the advertising policy.')));
    api.fleet({ status: fleetStatus || undefined }).then(setFleet).catch((e) => setErr(errText(e, 'Could not load display status.')));
    api.ads({}).then(setAds).catch((e) => setErr(errText(e, 'Could not load platform advertisements.')));
  }, [fleetStatus]);
  useEffect(() => { load(); }, [load]);

  const saveSwitch = async () => {
    if (!change || !pol) return; setBusy(true); setNote(null);
    try { await api.setPolicy({ allowTenantAdvertising: change.allow, reason: change.reason, expectedVersion: pol.policy.version, acceptNeutralFallback: change.neutral }); setChange(null); setNote('Advertising policy saved. Displays switch when they acknowledge it.'); load(); }
    catch (e) { setNote(errText(e, 'The change was not saved.')); } finally { setBusy(false); }
  };
  const act = async (a: any, action: 'publish' | 'pause' | 'archive' | 'restore') => {
    setNote(null);
    try { await api.act(a.id, action, a.version); load(); } catch (e) { setNote(errText(e, 'That did not work.')); }
  };
  const upload = async (file: File) => {
    setBusy(true); setNote(null);
    try { const p = await prepareAdImage(file, { maxFileBytes: LIMITS.maxFileBytes, allowedMimeTypes: [...LIMITS.allowedMimeTypes] }); const m = await api.upload(p.form); setEdit((x: any) => ({ ...x, mediaId: m.id, preview: m.medium?.url ?? p.previewUrl })); if (p.warnings.length) setNote(p.warnings.join(' ')); }
    catch (e) { setNote(errText(e, 'The image could not be uploaded.')); } finally { setBusy(false); }
  };
  const saveAd = async () => {
    if (!edit) return; setBusy(true); setNote(null);
    const body: Record<string, unknown> = { name: edit.name, mediaId: edit.mediaId ?? null, headline: edit.headline || null, subheadline: edit.subheadline || null, ctaText: edit.ctaText || null,
      fitMode: edit.fitMode || 'contain', displayDurationSeconds: edit.displayDurationSeconds ? Number(edit.displayDurationSeconds) : null, priority: Number(edit.priority || 0),
      startDate: edit.startDate || null, endDate: edit.endDate || null, qr: edit.qrUrl ? { kind: 'customer_app', url: edit.qrUrl } : null };
    try { if (edit.id) await api.update(edit.id, { ...body, expectedVersion: edit.version }); else await api.create(body); setEdit(null); load(); }
    catch (e) { setNote(errText(e, 'The advertisement was not saved.')); } finally { setBusy(false); }
  };

  const mode = pol?.policy?.mode as string | undefined;
  const c = fleet?.counts;
  return (
    <div className="p-5" data-testid="advertising-screen">
      <h1 className="m-0 text-[24px] font-bold">Advertising &amp; Customer Display</h1>
      <p className="mt-1 max-w-4xl text-[13px] text-[#7A6C57]">One master switch decides whose pictures play on every idle customer display: each salon's own, or AI PowerSalon's. Never both. Check-In and payments are never affected.</p>
      {err ? <div className="mt-3 rounded-2xl border border-[#E6B8B2] bg-[#FFF6F4] p-3 text-sm text-[#A12D2D]">{err}</div> : null}

      <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4" data-testid="ad-policy">
        <div className="flex flex-wrap items-center gap-3">
          <b>Allow Tenant Advertising</b>
          <span className="rounded-full border px-3 py-0.5 text-sm" data-testid="ad-mode">{mode === 'TENANT_ONLY' ? 'ON — salon ads only' : mode === 'PLATFORM_ONLY' ? 'OFF — AI PowerSalon ads only' : '—'}</span>
          <span className="text-xs text-[#7A6C57]">Version {dash(pol?.policy?.version)}</span>
          {pol && !change ? <button className="btn" onClick={() => setChange({ allow: mode !== 'TENANT_ONLY', reason: '', neutral: false })} data-testid="ad-switch">{mode === 'TENANT_ONLY' ? 'Turn OFF (platform ads only)…' : 'Turn ON (salon ads only)…'}</button> : null}
        </div>
        {change && pol ? (
          <div className="mt-3 rounded-xl border p-3 text-sm" data-testid="ad-switch-preview">
            <div className="font-semibold">Before you switch to {change.allow ? 'ON — each salon plays its own ads' : 'OFF — every display plays AI PowerSalon ads'}</div>
            <ul className="ml-4 mt-1 list-disc">
              <li>{pol.liveTenantAds} live salon advertisements at {pol.tenantsWithLiveAds} salons {change.allow ? 'will play again (only still-valid published ones)' : 'stop playing — they are kept, not deleted or unpublished'}.</li>
              <li>{pol.registeredDisplays} registered displays: {pol.onlineDisplays} online, {pol.offlineDisplays} offline (offline displays switch only after they reconnect and confirm).</li>
              <li>{pol.platformAdsReady} published AI PowerSalon advertisements ready.</li>
            </ul>
            {!change.allow && pol.platformAdsReady === 0 ? <label className="mt-2 block"><input type="checkbox" checked={change.neutral} onChange={(e) => setChange({ ...change, neutral: e.target.checked })} /> No platform ad is ready — show the neutral welcome panel on every display</label> : null}
            <label className="mt-2 block">Reason (required)<input className="ml-2 rounded border px-2 py-1" value={change.reason} maxLength={500} onChange={(e) => setChange({ ...change, reason: e.target.value })} data-testid="ad-reason" /></label>
            <div className="mt-2 flex gap-2"><button className="btn ghost" onClick={() => setChange(null)}>Cancel</button>
              <button className="btn" disabled={busy || change.reason.trim().length < 5} onClick={saveSwitch} data-testid="ad-confirm">Confirm switch</button></div>
          </div>) : null}
        {pol?.history?.length ? <details className="mt-2 text-xs"><summary>History</summary><ul className="ml-4 list-disc">{pol.history.map((h: any) => <li key={h.id}>{h.at ? new Date(h.at).toLocaleString() : ''} · v{h.version} · {h.from} → {h.to} · {h.actor ?? '—'} · {h.reason}</li>)}</ul></details> : null}
      </section>

      <section className="mt-4" data-testid="ad-fleet">
        <div className="mb-2 flex items-center gap-2"><b>Customer Display Advertising</b><span className="text-xs text-[#7A6C57]">Online = heartbeat within {dash(fleet?.onlineWindowSeconds)} s. Applied = the display confirmed this policy version.</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="Connected displays" value={dash(c?.connected)} testId="fleet-connected" />
          <Card label="Policy applied" value={dash(c?.applied)} testId="fleet-applied" />
          <Card label="Online, pending" value={dash(c?.pending)} testId="fleet-pending" />
          <Card label="Offline" value={dash(c?.offline)} sub={c ? `${c.revoked} revoked (not counted)` : undefined} testId="fleet-offline" />
        </div>
        <div className="mt-2 flex gap-2 text-sm">{['', 'applied', 'pending', 'offline'].map((s) => <button key={s || 'all'} className={'btn ' + (fleetStatus === s ? '' : 'ghost')} onClick={() => setFleetStatus(s)}>{s || 'All'}</button>)}</div>
        {fleet?.items?.length ? <table className="mt-2 w-full text-sm"><thead><tr><th className="text-left">Salon</th><th className="text-left">Branch</th><th className="text-left">Display</th><th className="text-left">Status</th><th className="text-left">Last heartbeat</th><th className="text-left">Applied</th></tr></thead>
          <tbody>{fleet.items.map((d: any) => <tr key={d.deviceId}><td>{d.tenantName ?? '—'}</td><td>{d.branchName ?? '—'}</td><td>{d.name ?? d.deviceId.slice(0, 8)}</td><td>{d.status}</td><td>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}</td><td>{d.appliedMode ? `${d.appliedMode} v${d.appliedPolicyVersion}` : '—'}</td></tr>)}</tbody></table> : <div className="mt-2 text-sm text-[#7A6C57]">{fleet ? 'No displays in this group.' : 'Loading…'}</div>}
      </section>

      <section className="mt-4" data-testid="platform-ads">
        <div className="mb-2 flex items-center gap-2"><b>AI PowerSalon advertisements</b><span className="text-xs text-[#7A6C57]">Played on every idle display only while the switch is OFF. One picture at a time, half of the screen.</span>
          {!edit ? <button className="btn ml-auto" onClick={() => setEdit({ name: '', fitMode: 'contain', priority: 0 })} data-testid="pad-new">Create Ad</button> : null}</div>
        {edit ? (
          <div className="mb-3 grid gap-2 rounded-2xl border p-3 text-sm sm:grid-cols-2" data-testid="pad-form">
            <label>Title<input className="ml-2 rounded border px-2 py-1" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="pad-name" /></label>
            <label>Picture <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} /></label>
            {edit.preview ? <div className="sm:col-span-2"><div style={{ width: 480, height: 540, background: '#1b1410', display: 'grid', placeItems: 'center' }} data-testid="pad-preview"><img src={edit.preview} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: edit.fitMode === 'cover' ? 'cover' : 'contain' }} /></div><div className="text-xs text-[#7A6C57]">Half-screen preview (left: Check-In, right: this picture).</div></div> : null}
            <label>Headline<input className="ml-2 rounded border px-2 py-1" value={edit.headline ?? ''} maxLength={60} onChange={(e) => setEdit({ ...edit, headline: e.target.value })} /></label>
            <label>Subheadline<input className="ml-2 rounded border px-2 py-1" value={edit.subheadline ?? ''} maxLength={80} onChange={(e) => setEdit({ ...edit, subheadline: e.target.value })} /></label>
            <label>Button text<input className="ml-2 rounded border px-2 py-1" value={edit.ctaText ?? ''} maxLength={40} onChange={(e) => setEdit({ ...edit, ctaText: e.target.value })} /></label>
            <label>App download link (https, verified)<input className="ml-2 rounded border px-2 py-1" value={edit.qrUrl ?? ''} maxLength={300} onChange={(e) => setEdit({ ...edit, qrUrl: e.target.value })} placeholder="https://" /></label>
            <label>Fit<select className="ml-2" value={edit.fitMode} onChange={(e) => setEdit({ ...edit, fitMode: e.target.value })}><option value="contain">Contain (never cropped)</option><option value="cover">Cover</option></select></label>
            <label>Seconds on screen<input className="ml-2 w-20 rounded border px-2 py-1" inputMode="numeric" value={edit.displayDurationSeconds ?? ''} onChange={(e) => setEdit({ ...edit, displayDurationSeconds: e.target.value.replace(/\D/g, '') })} placeholder="15" /></label>
            <label>Starts<input type="date" className="ml-2" value={edit.startDate ?? ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></label>
            <label>Ends<input type="date" className="ml-2" value={edit.endDate ?? ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></label>
            <label>Order (higher first)<input className="ml-2 w-20 rounded border px-2 py-1" value={edit.priority ?? 0} onChange={(e) => setEdit({ ...edit, priority: e.target.value.replace(/[^\d-]/g, '') })} /></label>
            <div className="flex gap-2 sm:col-span-2"><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" disabled={busy || !edit.name.trim()} onClick={saveAd} data-testid="pad-save">Save Draft</button></div>
          </div>) : null}
        {ads?.items?.length ? <table className="w-full text-sm"><tbody>{ads.items.map((a: any) => (
          <tr key={a.id}><td>{a.image?.thumb ? <img src={a.image.thumb} alt="" style={{ width: 64, height: 48, objectFit: 'contain' }} /> : '—'}</td><td><b>{a.name}</b><div className="text-xs text-[#7A6C57]">{a.headline ?? ''}</div></td><td>{a.effectiveStatus}</td>
            <td className="flex gap-1">{a.status !== 'published' && a.status !== 'archived' ? <button className="btn" onClick={() => act(a, 'publish')} data-testid={`pad-publish-${a.id}`}>Publish</button> : null}
              {a.status === 'published' ? <button className="btn ghost" onClick={() => act(a, 'pause')}>Pause</button> : null}
              {a.status !== 'archived' ? <button className="btn ghost" onClick={() => setEdit({ ...a, qrUrl: a.qrUrl ?? '', preview: a.image?.medium ?? null })}>Edit</button> : null}
              {a.status !== 'archived' ? <button className="btn ghost" onClick={() => act(a, 'archive')}>Archive</button> : <button className="btn ghost" onClick={() => act(a, 'restore')}>Restore</button>}</td></tr>))}</tbody></table>
          : <div className="text-sm text-[#7A6C57]">{ads ? 'No AI PowerSalon advertisements yet. While the switch is OFF and none is published, displays show the neutral welcome panel.' : 'Loading…'}</div>}
      </section>
      {note ? <div className="mt-3 text-sm" role="status" data-testid="ad-note">{note}</div> : null}
    </div>
  );
}
