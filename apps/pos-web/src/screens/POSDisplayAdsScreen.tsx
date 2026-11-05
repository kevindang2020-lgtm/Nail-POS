// POSDisplayAdsScreen.tsx — Marketing & Growth → Customer Display Advertising (23-inch dual-screen spec §47–§78,
// §108–§111). The salon's own ads for the right panel of its customer display, which plays them whenever no checkout
// is active. Tabs per §48: Advertisements · Playlist · Schedule · Branches · Display Preview · Analytics · Settings.
//
// Every number and status here is the server's: statuses (DRAFT/SCHEDULED/ACTIVE/PAUSED/EXPIRED/ARCHIVED) and "showing
// now" are evaluated in the salon's time zone server-side, the Playlist/Preview tabs show the playlist the display
// itself would get, and Analytics counts DISPLAYS — times an ad was on screen — never "views" (§108).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInlineConfirm, type RotatingAd } from '@aipowersalon/ui';
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import type { DisplayAdAction, DisplayAdsAnalytics, DisplayAdsState, DisplayAdStatus, DisplayAdView } from '@aipowersalon/api-contracts/tenant';
import { posDisplayAdsApi, mediaUrl } from '../api/posDisplayAdsApi';
import { useRealtime } from '../realtime/useRealtime';
import { reportError } from './reportsCommon';
import { AdEditor } from './display-ads/AdEditor';
import { DisplayPreview } from './display-ads/DisplayPreview';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel, fmtClock, weekdayShort } from '../components/codeLabel';
import { fmtYmd, fmtNumber, fmtDateTime } from '../i18n/format';

type Tab = 'ads' | 'playlist' | 'schedule' | 'branches' | 'preview' | 'analytics' | 'settings';
const TABS = (): [Tab, string][] => [['ads', tx('pos.advertisements')], ['playlist', tx('admin.ads.tab.playlist')], ['schedule', tx('pos.schedule')], ['branches', tx('pos.branches')], ['preview', tx('admin.ads.tab.preview')], ['analytics', tx('admin.ads.tab.analytics')], ['settings', tx('pos.settings')]];
const TONE: Record<DisplayAdStatus, string> = { ACTIVE: 'ok', SCHEDULED: 'info', DRAFT: 'mut', PAUSED: 'warn', EXPIRED: 'bad', ARCHIVED: 'mut' };
/** why a display plays no ads (CustomerDisplayAdPlaylist.offReason) → its sentence, or null for an unknown reason */
const offReason = (r: string | null | undefined): string | null => { if (!r) return null; const k = `admin.ads.off.${r}`; const l = tx(k); return l !== k ? l : null; };
const adStatus = (s: string) => codeLabel('admin.ads.status', s, 'deal');

const fmtDate = (d: string | null) => (d ? fmtYmd(d, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const hm = (t: string) => fmtClock(t);
function scheduleText(a: DisplayAdView): string {
  const parts: string[] = [];
  if (a.startDate || a.endDate) parts.push(`${fmtDate(a.startDate) ?? tx('pos.now')} – ${fmtDate(a.endDate) ?? tx('pos.no_end')}`);
  if (a.daysOfWeek?.length) parts.push(a.daysOfWeek.map((d) => weekdayShort(d)).join(', '));
  if (a.dailyStartTime && a.dailyEndTime) parts.push(`${hm(a.dailyStartTime)}–${hm(a.dailyEndTime)}`);
  return parts.length ? parts.join(' · ') : tx('pos.always_2');
}
const secs = (n: number) => (n >= 3600 ? tx('admin.ads.hours', { n: fmtNumber(n / 3600, 1) }) : n >= 60 ? tx('pos.v0_min', { v0: String(Math.round(n / 60)) }) : tx('admin.ads.seconds', { n: String(n) }));

/** The display's playlist → the rotator's slides (same shape the display renders). */
export function slidesOf(p: CustomerDisplayAdPlaylist | null, mode: 'panel' | 'fullscreen' = 'panel'): RotatingAd[] {
  if (!p?.enabled) return [];
  return p.ads
    .filter((a) => mode === 'panel' || !!a.fullscreenImage)
    .map((a) => ({ id: a.id, version: a.version, durationSeconds: a.durationSeconds, image: mode === 'fullscreen' ? a.fullscreenImage! : a.image, fit: a.fit, focalX: a.focalX, focalY: a.focalY, headline: a.headline, subheadline: a.subheadline, description: a.description, ctaText: a.ctaText, qr: a.qr }));
}

function actionsFor(a: DisplayAdView): { action: DisplayAdAction | 'edit' | 'delete'; label: string; danger?: boolean }[] {
  if (!a.canManage) return [];
  switch (a.storedStatus) {
    case 'draft': return [{ action: 'edit', label: tx('pos.edit') }, { action: 'publish', label: tx('pos.publish') }, { action: 'archive', label: tx('pos.archive') }, { action: 'delete', label: tx('pos.delete'), danger: true }];
    case 'published': return [{ action: 'edit', label: tx('pos.edit') }, { action: 'pause', label: tx('pos.pause') }, { action: 'archive', label: tx('pos.archive'), danger: true }];
    case 'paused': return [{ action: 'edit', label: tx('pos.edit') }, { action: 'publish', label: tx('pos.resume') }, { action: 'archive', label: tx('pos.archive'), danger: true }];
    case 'archived': return [{ action: 'restore', label: tx('pos.restore') }, { action: 'delete', label: tx('pos.delete'), danger: true }];
    default: return [];
  }
}

function BranchPicker({ st, value, onChange, allowAll }: { st: DisplayAdsState; value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const opts = st.branches.filter((b) => st.authorizedBranchIds.includes(b.id));
  if (opts.length <= 1 && !allowAll) return opts[0] ? <span className="sub">{tx('pos.branch_2')}{' '}<strong>{opts[0].name}</strong></span> : null;
  return (
    <select aria-label={tx('pos.branch')} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 180 }}>
      {allowAll && st.canManageAllBranches ? <option value="">{tx('pos.all_branches_2')}</option> : null}
      {opts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

export function POSDisplayAdsScreen() {
  const [st, setSt] = useState<DisplayAdsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ads');
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [editing, setEditing] = useState<{ ad: DisplayAdView | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { confirm, confirmUi } = useInlineConfirm();

  const load = useCallback(async () => {
    try { setSt(await posDisplayAdsApi.state()); setError(null); }
    catch (e: any) { setError(reportError(e, tx('admin.ads.noun'))); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // another manager's change (or the display's settings) arrives as customer_display_ads_updated → refetch
  useRealtime('display-ads', load, { intervalMs: 60_000 });

  const act = (a: DisplayAdView, action: DisplayAdAction | 'edit' | 'delete') => {
    if (action === 'edit') { setEditing({ ad: a }); return; }
    const run = async () => {
      setBusy(a.id + action); setNote(null);
      try {
        if (action === 'delete') { await posDisplayAdsApi.remove(a.id, a.version); setNote({ ok: true, msg: tx('pos.name_was_deleted', { name: String(a.name) }) }); }
        else { const v = await posDisplayAdsApi.act(a.id, action, a.version); setNote({ ok: true, msg: tx('pos.name_is_now_v1_v2', { name: String(v.name), v1: String(adStatus(v.status).toLowerCase()), v2: String(v.showingNow ? tx('pos.and_showing') : '') }) }); }
        await load();
      } catch (e: any) { setNote({ ok: false, msg: e?.message || tx('pos.that_action_could_not_be_completed') }); await load(); }
      finally { setBusy(null); }
    };
    if (action === 'delete') confirm(tx('admin.ads.confirm.delete', { name: a.name }), run, { confirmLabel: tx('pos.delete'), destructive: true });
    else if (action === 'archive' && a.storedStatus === 'published') confirm(tx('admin.ads.confirm.archive', { name: a.name }), run, { confirmLabel: tx('pos.archive'), destructive: true });
    else run();
  };

  if (error && !st) return <div className="work"><div className="state" style={{ color: '#B4453C' }}>{error}</div></div>;
  if (!st) return <div className="work"><div className="state">{tx('pos.loading_customer_display_advertising')}</div></div>;

  const canCreate = st.availability.active;
  return (
    <div className="work dads">
      {confirmUi}
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>{tx('pos.customer_display_advertising')}</h1>
          <div className="sub">{tx('pos.your_ads_on_the_right_side_ywzi')}</div>
        </div>
        <button className="btn ghost" onClick={load}>{tx('pos.refresh')}</button>
        <button className="btn primary" onClick={() => setEditing({ ad: null })} disabled={!canCreate}>{tx('pos.add_advertisement')}</button>
      </div>

      {!st.availability.active ? (
        <div className="dads-banner warn" role="status">{tx('pos.customer_display_advertising_is_not_available_1518')}{st.availability.detail ? ` — ${st.availability.detail}` : ''}{tx('pos.existing_ads_can_still_be_paused_enk1')}</div>
      ) : !st.settings.tenant.enabled ? (
        <div className="dads-banner warn" role="status">{tx('pos.advertising_is_turned_off_for_the_cxuw')}</div>
      ) : null}
      {note ? <div className={'dads-banner ' + (note.ok ? 'ok' : 'bad')} role="status" onClick={() => setNote(null)}>{note.msg}</div> : null}

      <div className="tabs sm" role="tablist" style={{ marginTop: 8 }}>
        {TABS().map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'ads' ? <AdsTab st={st} busy={busy} showArchived={showArchived} setShowArchived={setShowArchived} onAct={act} /> : null}
      {tab === 'playlist' ? <PlaylistTab st={st} /> : null}
      {tab === 'schedule' ? <ScheduleTab st={st} onEdit={(a) => setEditing({ ad: a })} /> : null}
      {tab === 'branches' ? <BranchesTab st={st} onEdit={(a) => setEditing({ ad: a })} /> : null}
      {tab === 'preview' ? <PreviewTab st={st} /> : null}
      {tab === 'analytics' ? <AnalyticsTab st={st} /> : null}
      {tab === 'settings' ? <SettingsTab st={st} onSaved={(msg) => { setNote({ ok: true, msg }); load(); }} onError={(msg) => setNote({ ok: false, msg })} /> : null}

      {editing ? (
        <AdEditor st={st} ad={editing.ad} salonName={st.salonName} onClose={() => { setEditing(null); load(); }}
          onSaved={(_v, msg) => { setEditing(null); setNote({ ok: true, msg }); load(); }} />
      ) : null}
    </div>
  );
}

function AdsTab({ st, busy, showArchived, setShowArchived, onAct }: { st: DisplayAdsState; busy: string | null; showArchived: boolean; setShowArchived: (v: boolean) => void; onAct: (a: DisplayAdView, action: DisplayAdAction | 'edit' | 'delete') => void }) {
  const rows = st.ads.filter((a) => showArchived || a.storedStatus !== 'archived');
  const names = new Map(st.branches.map((b) => [b.id, b.name]));
  const archived = st.ads.filter((a) => a.storedStatus === 'archived').length;
  return (
    <section>
      <div className="sub" style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <span>{st.usage.adCount} {tx('pos.of')}{' '}{st.limits.maxAds} {tx('pos.ads')}{' '}{(st.usage.storageBytes / 1024 / 1024).toFixed(1)} {tx('pos.of')}{' '}{Math.round(st.limits.storageLimitBytes / 1024 / 1024)} {tx('pos.mb_images')}</span>
        {archived ? <label className="dads-check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {tx('pos.show_archived')}{archived})</label> : null}
      </div>
      {rows.length === 0 ? (
        <div className="panel dads-empty">
          <div className="p-h">{tx('pos.no_advertisements_yet')}</div>
          <div className="sub">{tx('pos.upload_a_promotional_image_a_seasonal_162j')}</div>
        </div>
      ) : (
        <div className="dads-list">
          {rows.map((a) => (
            <article key={a.id} className="panel dads-card" data-testid="dads-card">
              <div className="dads-thumb">{a.media ? <img src={mediaUrl(a.media.thumb.url)} alt="" /> : <span className="sub">{tx('pos.no_image')}</span>}</div>
              <div className="dads-card-b">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{a.name}</strong>
                  <span className={'pill ' + TONE[a.status]}>{adStatus(a.status)}</span>
                  {a.showingNow ? <span className="pill ok" title={tx('pos.on_the_display_right_now')}>{tx('pos.showing_now')}</span> : null}
                </div>
                {a.headline ? <div className="sub" style={{ marginTop: 2 }}>{a.headline}</div> : null}
                <div className="dads-meta">
                  <span>{scheduleText(a)}</span>
                  <span>{a.allBranches ? tx('pos.all_branches_2') : a.branchIds.map((b) => names.get(b) ?? tx('pos.branch')).join(', ')}</span>
                  <span>{tx('admin.ads.seconds', { n: String(a.effectiveDurationSeconds) })}{a.displayDurationSeconds == null ? ` ${tx('admin.ads.defaultSuffix')}` : ''}</span>
                  {a.priority ? <span>{tx('pos.priority')}{' '}{a.priority}</span> : null}
                </div>
                {!a.canManage && a.storedStatus !== 'archived' ? <div className="sub" style={{ marginTop: 4 }}>{tx('pos.plays_at_other_branches_too_only_1m9c')}</div> : null}
              </div>
              <div className="dads-actions">
                {actionsFor(a).map((x) => (
                  <button key={x.action} className={'btn ' + (x.action === 'publish' ? 'primary' : 'ghost')} style={x.danger ? { color: '#B4453C' } : undefined}
                    disabled={!!busy || ((x.action === 'publish' || x.action === 'restore') && !st.availability.active)} onClick={() => onAct(a, x.action)}>
                    {busy === a.id + x.action ? '…' : x.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function usePlaylist(st: DisplayAdsState, branchId: string) {
  const [p, setP] = useState<CustomerDisplayAdPlaylist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!branchId) return;
    try { setP(await posDisplayAdsApi.playlist(branchId)); setErr(null); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_the_playlist')); }
  }, [branchId]);
  useEffect(() => { load(); }, [load, st]);
  // the playlist changes by itself when a schedule starts or ends — ask again when the server says it might
  useEffect(() => { if (!p) return; const t = setTimeout(load, Math.max(5, p.refreshAfterSeconds) * 1000); return () => clearTimeout(t); }, [p, load]);
  return { p, err };
}

function PlaylistTab({ st }: { st: DisplayAdsState }) {
  const [branchId, setBranchId] = useState(st.authorizedBranchIds[0] ?? '');
  const { p, err } = usePlaylist(st, branchId);
  const byId = useMemo(() => new Map(st.ads.map((a) => [a.id, a])), [st.ads]);
  const loop = p?.ads.reduce((s, a) => s + a.durationSeconds, 0) ?? 0;
  return (
    <section>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <BranchPicker st={st} value={branchId} onChange={setBranchId} />
        {p?.enabled ? <span className="sub">{p.ads.length} {tx('pos.ad')}{enPlural(p.ads.length === 1 ? '' : 's')} {tx('pos.in_rotation_one_loop')}{' '}{secs(loop)}</span> : null}
      </div>
      {err ? <div className="dads-banner bad">{err}</div> : !p ? <div className="state">{tx('pos.loading')}</div> : !p.enabled ? (
        <div className="panel"><div className="p-h">{tx('pos.not_playing_ads')}</div><div className="sub">{offReason(p.offReason) ?? tx('pos.advertising_is_off')} {tx('pos.the_display_shows_your_branded_welcome_1aty')}</div></div>
      ) : p.ads.length === 0 ? (
        <div className="panel"><div className="p-h">{tx('pos.nothing_scheduled_right_now')}</div><div className="sub">{tx('pos.no_published_ad_is_in_its_jhzt')}</div></div>
      ) : (
        <ol className="dads-playlist">
          {p.ads.map((a, i) => (
            <li key={a.id} className="panel">
              <span className="dads-num">{i + 1}</span>
              <img src={mediaUrl(byId.get(a.id)?.media?.thumb.url ?? a.image.url)} alt="" />
              <div style={{ flex: 1 }}><strong>{byId.get(a.id)?.name ?? a.headline ?? tx('pos.advertisement')}</strong><div className="sub">{a.headline ?? tx('pos.image_only')}</div></div>
              <span className="pill info">{tx('admin.ads.seconds', { n: String(a.durationSeconds) })}</span>
            </li>
          ))}
        </ol>
      )}
      {p ? <div className="sub" style={{ marginTop: 8 }}>{tx('pos.the_playlist_loops_continuously_while_no_1hu6')}{' '}{secs(p.refreshAfterSeconds)}.</div> : null}
    </section>
  );
}

function ScheduleTab({ st, onEdit }: { st: DisplayAdsState; onEdit: (a: DisplayAdView) => void }) {
  const groups: [string, DisplayAdStatus[]][] = [[tx('pos.active_3'), ['ACTIVE']], [tx('pos.scheduled'), ['SCHEDULED']], [tx('pos.paused'), ['PAUSED']], [tx('pos.drafts'), ['DRAFT']], [tx('pos.expired_2'), ['EXPIRED']]];
  return (
    <section>
      <div className="sub" style={{ margin: '4px 0 10px' }}>{tx('pos.dates_and_hours_are_each_branch_1prs')}{st.timeZone} {tx('pos.here')}</div>
      {groups.map(([label, statuses]) => {
        const ads = st.ads.filter((a) => statuses.includes(a.status));
        if (!ads.length) return null;
        return (
          <div key={label} className="panel" style={{ marginBottom: 10 }}>
            <div className="p-h">{label} <span className="sub" style={{ fontWeight: 400 }}>({ads.length})</span></div>
            <table className="tbl">
              <thead><tr><th>{tx('pos.advertisement')}</th><th>{tx('pos.dates')}</th><th>{tx('pos.days_2')}</th><th>{tx('pos.hours')}</th><th>{tx('pos.now')}</th><th /></tr></thead>
              <tbody>{ads.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.startDate || a.endDate ? `${fmtDate(a.startDate) ?? tx('pos.now')} – ${fmtDate(a.endDate) ?? tx('pos.no_end')}` : tx('pos.always_2')}</td>
                  <td>{a.daysOfWeek?.length ? a.daysOfWeek.map((d) => weekdayShort(d)).join(', ') : tx('pos.every_day')}</td>
                  <td>{a.dailyStartTime && a.dailyEndTime ? `${hm(a.dailyStartTime)}–${hm(a.dailyEndTime)}` : tx('pos.all_day')}</td>
                  <td>{a.showingNow ? <span className="pill ok">{tx('pos.showing')}</span> : <span className="sub">—</span>}</td>
                  <td>{a.canManage && a.storedStatus !== 'archived' ? <button className="btn ghost" onClick={() => onEdit(a)}>{tx('pos.edit_schedule')}</button> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      })}
      {!st.ads.some((a) => a.status !== 'ARCHIVED') ? <div className="panel sub">{tx('pos.no_advertisements_to_schedule_yet')}</div> : null}
    </section>
  );
}

function BranchesTab({ st, onEdit }: { st: DisplayAdsState; onEdit: (a: DisplayAdView) => void }) {
  const ads = st.ads.filter((a) => a.storedStatus !== 'archived');
  return (
    <section>
      <div className="sub" style={{ margin: '4px 0 10px' }}>{tx('pos.where_each_advertisement_plays_an_ad_ax22')}</div>
      {ads.length === 0 ? <div className="panel sub">{tx('pos.no_advertisements_yet_2')}</div> : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>{tx('pos.advertisement')}</th>{st.branches.map((b) => <th key={b.id}>{b.name}</th>)}<th /></tr></thead>
            <tbody>{ads.map((a) => (
              <tr key={a.id}>
                <td>{a.name} <span className={'pill ' + TONE[a.status]}>{adStatus(a.status)}</span></td>
                {st.branches.map((b) => {
                  const on = a.allBranches || a.branchIds.includes(b.id);
                  return <td key={b.id} aria-label={tx('pos.name_at_name2_v2', { name: String(a.name), name2: String(b.name), v2: String(on ? 'yes' : 'no') })}>{on ? <strong style={{ color: 'var(--ok)' }}>YES</strong> : <span className="sub">NO</span>}</td>;
                })}
                <td>{a.canManage ? <button className="btn ghost" onClick={() => onEdit(a)}>{tx('pos.edit_branches')}</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PreviewTab({ st }: { st: DisplayAdsState }) {
  const [branchId, setBranchId] = useState(st.authorizedBranchIds[0] ?? '');
  const [mode, setMode] = useState<'panel' | 'fullscreen'>('panel');
  const { p, err } = usePlaylist(st, branchId);
  const slides = useMemo(() => slidesOf(p, mode), [p, mode]);
  return (
    <section>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <BranchPicker st={st} value={branchId} onChange={setBranchId} />
        <div className="seg">
          <button className={'seg-btn' + (mode === 'panel' ? ' on' : '')} onClick={() => setMode('panel')}>{tx('pos.check_in_ads')}</button>
          <button className={'seg-btn' + (mode === 'fullscreen' ? ' on' : '')} onClick={() => setMode('fullscreen')}>{tx('pos.full_screen_idle')}</button>
        </div>
      </div>
      {err ? <div className="dads-banner bad">{err}</div> : null}
      {mode === 'fullscreen' && p && !p.fullScreenIdle.enabled ? <div className="dads-banner warn">{tx('pos.full_screen_idle_ads_are_off_1kra')}</div> : null}
      <div style={{ maxWidth: 1100 }}>
        <DisplayPreview ads={slides} mode={mode} salonName={st.salonName}
          caption={p && !p.enabled ? tx('pos.not_playing_ads_v0_the_branded_1jzn', { v0: String(offReason(p.offReason) ?? tx('pos.off_2')) }) : undefined} />
      </div>
    </section>
  );
}

function AnalyticsTab({ st }: { st: DisplayAdsState }) {
  const [days, setDays] = useState(30);
  const [branchId, setBranchId] = useState(st.canManageAllBranches ? '' : (st.authorizedBranchIds[0] ?? ''));
  const [a, setA] = useState<DisplayAdsAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (branchId ? posDisplayAdsApi.branchAnalytics(branchId, days) : posDisplayAdsApi.analytics(days)).then((r) => { if (live) { setA(r); setErr(null); } }).catch((e: any) => { if (live) setErr(e?.message || tx('pos.could_not_load_analytics')); });
    return () => { live = false; };
  }, [days, branchId, st]);
  const T = a?.totals;
  return (
    <section>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <div className="seg">{[7, 30, 90].map((d) => <button key={d} className={'seg-btn' + (days === d ? ' on' : '')} onClick={() => setDays(d)}>{d} {tx('pos.days')}</button>)}</div>
        <BranchPicker st={st} value={branchId} onChange={setBranchId} allowAll />
      </div>
      {err ? <div className="dads-banner bad">{err}</div> : !T ? <div className="state">{tx('pos.loading')}</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <div className="kpi"><div className="l">{tx('pos.active_ads')}</div><div className="v">{T.active}</div></div>
            <div className="kpi"><div className="l">{tx('pos.scheduled')}</div><div className="v">{T.scheduled}</div></div>
            <div className="kpi"><div className="l">{tx('pos.expired_2')}</div><div className="v">{T.expired}</div></div>
            <div className="kpi"><div className="l">{tx('pos.paused')}</div><div className="v">{T.paused}</div></div>
            <div className="kpi"><div className="l">{tx('pos.times_displayed')}</div><div className="v">{fmtNumber(T.displayCount)}</div><div className="d flat">{secs(T.displaySeconds)} {tx('pos.on_screen')}</div></div>
            <div className="kpi"><div className="l">{tx('pos.displays_showing_ads_now')}</div><div className="v">{T.devicesShowingNow} / {T.displaysRegistered}</div></div>
            <div className="kpi"><div className="l">{tx('pos.branches')}</div><div className="v">{a!.byBranch.length}</div></div>
          </div>
          <div className="sub" style={{ margin: '8px 0 12px' }}>{tx('pos.times_displayed_counts_each_time_an_7i4r')}</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="panel"><div className="p-h">{tx('pos.by_advertisement')}</div>
              {a!.byAd.length === 0 ? <div className="sub">{tx('pos.no_displays_recorded_in_this_period')}</div> : (
                <table className="tbl"><thead><tr><th>{tx('pos.advertisement')}</th><th>{tx('pos.times_displayed')}</th><th>{tx('pos.on_screen_2')}</th><th>{tx('pos.last_shown')}</th></tr></thead>
                  <tbody>{a!.byAd.map((r) => <tr key={r.adId}><td>{r.name}</td><td>{fmtNumber(r.displayCount)}</td><td>{secs(r.displaySeconds)}</td><td>{r.lastShownAt ? fmtDateTime(r.lastShownAt) : '—'}</td></tr>)}</tbody></table>
              )}
            </div>
            <div className="panel"><div className="p-h">{tx('pos.by_branch')}</div>
              <table className="tbl"><thead><tr><th>{tx('pos.branch')}</th><th>{tx('pos.times_displayed')}</th><th>{tx('pos.on_screen_2')}</th><th>{tx('pos.displays')}</th><th>{tx('pos.showing_ads_now')}</th></tr></thead>
                <tbody>{a!.byBranch.map((r) => <tr key={r.branchId}><td>{r.name}</td><td>{fmtNumber(r.displayCount)}</td><td>{secs(r.displaySeconds)}</td><td>{r.displays}</td><td>{r.devicesShowingNow}</td></tr>)}</tbody></table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SettingsTab({ st, onSaved, onError }: { st: DisplayAdsState; onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const t = st.settings.tenant;
  const [form, setForm] = useState(t);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setForm(st.settings.tenant); }, [st.settings.tenant]);
  const R = { min: 5, max: 30 };
  const dirty = JSON.stringify(form) !== JSON.stringify(t);
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); onSaved(msg); } catch (e: any) { onError(e?.message || tx('pos.the_setting_could_not_be_saved')); }
    finally { setBusy(null); }
  };
  const names = new Map(st.branches.map((b) => [b.id, b.name]));
  return (
    <section className="grid grid-cols-1 xl:grid-cols-2 gap-3" style={{ alignItems: 'start' }}>
      <div className="panel">
        <div className="p-h">{tx('pos.salon_wide')}</div>
        {!st.settings.canEditTenant ? <div className="sub" style={{ marginBottom: 8 }}>{tx('pos.only_the_salon_owner_can_change_zlrj')}</div> : null}
        <fieldset disabled={!st.settings.canEditTenant || !!busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="dads-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {tx('pos.show_advertisements_on_customer_displays')}</label>
          <div className="lf" style={{ marginTop: 8 }}><label htmlFor="dads-defdur">{tx('pos.default_display_time_per_ad')}</label>
            <select id="dads-defdur" value={form.defaultDurationSeconds} onChange={(e) => setForm({ ...form, defaultDurationSeconds: Number(e.target.value) })}>
              {Array.from({ length: R.max - R.min + 1 }, (_, i) => R.min + i).map((s) => <option key={s} value={s}>{s} {tx('pos.seconds')}</option>)}
            </select>
          </div>
          <label className="dads-check" style={{ marginTop: 8 }}><input type="checkbox" checked={form.fullScreenIdleAdsEnabled} disabled={!st.limits.fullScreenIdleAllowed} onChange={(e) => setForm({ ...form, fullScreenIdleAdsEnabled: e.target.checked })} /> {tx('pos.full_screen_ads_after_inactivity_any_4llk')}</label>
          {!st.limits.fullScreenIdleAllowed ? <div className="sub">{tx('pos.full_screen_ads_are_not_offered_1ls8')}</div> : null}
          {form.fullScreenIdleAdsEnabled ? (
            <div className="lf" style={{ marginTop: 8 }}><label htmlFor="dads-idle">{tx('pos.start_full_screen_ads_after')}</label>
              <select id="dads-idle" value={form.fullScreenIdleAfterSeconds} onChange={(e) => setForm({ ...form, fullScreenIdleAfterSeconds: Number(e.target.value) })}>
                {[30, 45, 60, 90, 120].map((s) => <option key={s} value={s}>{s} {tx('pos.seconds_without_a_touch')}</option>)}
              </select>
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!dirty} onClick={() => run('tenant', () => posDisplayAdsApi.saveSettings({ ...form }), tx('admin.ads.settingsSaved'))}>{busy === 'tenant' ? tx('pos.saving_2') : tx('pos.save_2')}</button>
          </div>
        </fieldset>
      </div>

      <div className="panel">
        <div className="p-h">{tx('pos.branches')}</div>
        <div className="sub" style={{ marginBottom: 8 }}>{tx('pos.a_branch_can_switch_advertising_or_1e79')}</div>
        {Object.entries(st.settings.branches).map(([b, o]) => (
          <div key={b} className="dads-row">
            <strong style={{ minWidth: 140 }}>{names.get(b) ?? tx('pos.branch')}</strong>
            <label className="dads-check"><input type="checkbox" checked={o.enabled !== false} disabled={!!busy} onChange={(e) => run('b' + b, () => posDisplayAdsApi.saveBranchSettings(b, { enabled: e.target.checked ? null : false }), tx(e.target.checked ? 'admin.ads.branch.followsSalon' : 'admin.ads.branch.off', { branch: names.get(b) ?? tx('pos.the_branch') }))} /> {tx('pos.ads_2')}</label>
            <label className="dads-check"><input type="checkbox" checked={o.fullScreenIdleAdsEnabled !== false} disabled={!!busy} onChange={(e) => run('f' + b, () => posDisplayAdsApi.saveBranchSettings(b, { fullScreenIdleAdsEnabled: e.target.checked ? null : false }), tx(e.target.checked ? 'admin.ads.branch.fullscreenFollows' : 'admin.ads.branch.fullscreenOff', { branch: names.get(b) ?? tx('pos.the_branch') }))} /> {tx('pos.full_screen')}</label>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="p-h">{tx('pos.displays')}</div>
        {st.devices.length === 0 ? <div className="sub">{tx('pos.no_customer_displays_are_paired_yet')}</div> : st.devices.map((d) => (
          <div key={d.id} className="dads-row">
            <strong style={{ minWidth: 140 }}>{d.name}</strong>
            <span className="sub">{d.branchId ? names.get(d.branchId) ?? '' : ''}</span>
            <label className="dads-check"><input type="checkbox" checked={d.adsEnabled} disabled={!!busy} onChange={(e) => run('d' + d.id, () => posDisplayAdsApi.setDevice(d.id, e.target.checked), tx(e.target.checked ? 'admin.ads.device.on' : 'admin.ads.device.off', { name: d.name }))} /> {tx('pos.ads_on_this_display')}</label>
            <span className="sub">{d.lastAdShownAt ? tx('pos.last_ad_v0', { v0: fmtDateTime(d.lastAdShownAt) }) : tx('pos.no_ads_shown_yet')}</span>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="p-h">{tx('pos.limits')}</div>
        <div className="dads-row"><span>{tx('pos.advertisements')}</span><strong>{st.usage.adCount} / {st.limits.maxAds}</strong></div>
        <div className="dads-row"><span>{tx('pos.image_storage')}</span><strong>{(st.usage.storageBytes / 1024 / 1024).toFixed(1)} / {Math.round(st.limits.storageLimitBytes / 1024 / 1024)} MB</strong></div>
        <div className="dads-row"><span>{tx('pos.largest_image')}</span><strong>{Math.round(st.limits.maxFileBytes / 1024 / 1024)} MB</strong></div>
        <div className="dads-row"><span>{tx('pos.file_types')}</span><strong>{st.limits.allowedMimeTypes.map((m) => m.replace('image/', '').toUpperCase()).join(', ') || tx('pos.none')}</strong></div>
        <div className="sub" style={{ marginTop: 6 }}>{tx('pos.set_by_the_platform')}</div>
      </div>
    </section>
  );
}
