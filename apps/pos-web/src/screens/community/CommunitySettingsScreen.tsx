// CommunitySettingsScreen.tsx — /community/settings (contract §2.3 / §4 / §5). Three parts, each behind its own permission:
//   • Salon settings (community.settings.manage): on/off, approvals, how the salon is shown, anonymous posting, branch
//     visibility, retention, regions, notification preferences (categories, push, email, critical SMS) and whether
//     technicians may read the community. PUT with `expectedVersion` (0 = first save); 409 → reload + message.
//     Everyone else sees a read-only summary.
//   • Follows (community.follow): categories / regions / minimum severity the user wants alerts for.
//   • Analytics (community.settings.manage): the salon's own community activity for a date range.
// The rules can be re-read (and re-accepted) from here.
import { useCallback, useEffect, useState } from 'react';
import type {
  CommunityAuthorDisplay, CommunityCategory, CommunityFollowView, CommunitySettingsUpdate, CommunitySettingsView, CommunitySeverity,
  CommunityTenantAnalytics,
} from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { useCommunityRules } from './CommunityRules';
import {
  P, CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_LABEL, CommunityHeader, CommunitySubNav, body, btnDanger, btnGhost, btnGold,
  card, cardHead, communityErrorText, errText, input, isConflict, label, muted, okText, page, pretty, row,
} from './communityUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
type FollowChannel = CommunityFollowView['channels'][number];
const FOLLOW_CHANNELS = (): [FollowChannel, string][] => [['in_app', tx('growth.community.followChannel.in_app')], ['push', tx('growth.community.followChannel.push')], ['email', tx('growth.community.followChannel.email')], ['sms', tx('growth.community.followChannel.sms')]];

function Toggle({ label: l, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label style={{ ...row, fontSize: 13 }}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {l}</label>;
}

export function CommunitySettingsScreen() {
  const can = useCan();
  const rules = useCommunityRules(can(P.view));
  const manage = can(P.settings);
  const [view, setView] = useState<CommunitySettingsView | null>(null);
  const [draft, setDraft] = useState<CommunitySettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.settings().then((s) => { setView(s); setDraft(s); }).catch((e) => setError(communityErrorText(e, tx('growth.community.couldNotLoadTheCommunitySettings')))), []);
  useEffect(() => { if (can(P.view)) load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(['community'], () => { if (!busy) load(); });

  const set = <K extends keyof CommunitySettingsView>(k: K, v: CommunitySettingsView[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setNotify = (patch: Partial<CommunitySettingsView['notify']>) => setDraft((d) => (d ? { ...d, notify: { ...d.notify, ...patch } } : d));
  const techCanView = !!draft?.roleGrants?.technician?.includes('view_community');
  const setTechView = (on: boolean) => setDraft((d) => {
    if (!d) return d;
    const cur = (d.roleGrants?.technician ?? []).filter((c) => c !== 'view_community');
    return { ...d, roleGrants: { ...(d.roleGrants ?? {}), technician: on ? [...cur, 'view_community'] : cur } };
  });

  const save = async () => {
    if (!draft || !view) return;
    setBusy(true); setError(null); setNotice(null);
    const u: CommunitySettingsUpdate = {
      expectedVersion: view.version,
      enabled: draft.enabled, receptionistApprovalRequired: draft.receptionistApprovalRequired, managerApprovalRequired: draft.managerApprovalRequired,
      displayName: draft.displayName?.trim() || null, authorDisplay: draft.authorDisplay, allowAnonymous: draft.allowAnonymous,
      branchVisibility: draft.branchVisibility, retentionDays: draft.retentionDays, regionPreferences: draft.regionPreferences,
      notify: draft.notify, roleGrants: draft.roleGrants, roleRemovals: draft.roleRemovals,
    };
    try { const s = await api.saveSettings(u); setView(s); setDraft(s); setNotice(tx('growth.community.communitySettingsSaved')); }
    catch (e) { if (isConflict(e)) await load(); setError(communityErrorText(e, tx('growth.community.theSettingsWereNotSaved'))); }
    finally { setBusy(false); }
  };

  if (!can(P.view)) return <div style={page}><CommunityHeader title={tx('pos.community_settings')} /><div style={{ padding: 20, ...muted }}>{tx('pos.you_do_not_have_access_to_u75b')}</div></div>;
  const d = draft;
  const ro = !manage;
  return (
    <div style={page}>
      <CommunityHeader title={tx('pos.community_settings')} sub={tx('pos.how_your_salon_takes_part_in_jdxz')} />
      <CommunitySubNav can={can} />
      <div style={body}>
        {notice ? <div role="status" style={okText}>{notice}</div> : null}
        {error ? <div role="alert" style={errText}>{error}</div> : null}
        <section style={card} aria-label={tx('pos.community_rules')}>
          <div style={cardHead}>{tx('pos.community_rules')}</div>
          <div style={{ ...row, fontSize: 13 }}>
            <span>{tx('pos.version')}{' '}{view?.rulesVersion ?? '—'} — {rules.acknowledged ? tx('pos.you_accepted_these_rules') : tx('pos.you_have_not_accepted_these_rules_1tfg')}</span>
            <button style={btnGhost} onClick={rules.require}>{tx('pos.read_the_rules')}</button>
          </div>
        </section>
        {d ? (
          <section style={{ ...card, display: 'grid', gap: 10 }} aria-label={tx('pos.salon_settings')} data-testid="community-salon-settings">
            <div style={cardHead}>{tx('pos.salon_settings')}{' '}{ro ? <span style={muted}>{tx('pos.read_only_the_owner_manages_these')}</span> : null}</div>
            <Toggle label={tx('pos.take_part_in_the_safety_community')} checked={d.enabled} disabled={ro} onChange={(v) => set('enabled', v)} />
            <Toggle label={tx('pos.front_desk_advisories_need_a_manager_1q5r')} checked={d.receptionistApprovalRequired} disabled={ro} onChange={(v) => set('receptionistApprovalRequired', v)} />
            <Toggle label={tx('pos.managers_advisories_need_a_second_approval')} checked={d.managerApprovalRequired} disabled={ro} onChange={(v) => set('managerApprovalRequired', v)} />
            <Toggle label={tx('pos.technicians_can_read_the_safety_community')} checked={techCanView} disabled={ro} onChange={setTechView} />
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <label style={label}>{tx('pos.community_display_name')}<input style={input} value={d.displayName ?? ''} disabled={ro} onChange={(e) => set('displayName', e.target.value)} placeholder={tx('pos.e_g_a_cherry_hill_salon')} /></label>
              <label style={label}>{tx('pos.show_our_salon_as')}
                <select style={input} value={d.authorDisplay} disabled={ro} onChange={(e) => set('authorDisplay', e.target.value as CommunityAuthorDisplay)}>
                  <option value="tenant_name">{tx('pos.our_salon_name')}</option><option value="display_name">{tx('pos.our_community_display_name')}</option>
                  <option value="anonymous" disabled={!d.allowAnonymous}>{tx('pos.anonymous_a_salon_in')}</option>
                </select>
              </label>
              <label style={label}>{tx('pos.who_in_our_salon_sees_advisories')}
                <select style={input} value={d.branchVisibility} disabled={ro} onChange={(e) => set('branchVisibility', e.target.value as 'tenant' | 'own_branch')}>
                  <option value="tenant">{tx('pos.every_location')}</option><option value="own_branch">{tx('pos.only_the_location_that_posted')}</option>
                </select>
              </label>
              <label style={label}>{tx('pos.keep_drafts_and_private_incidents_for_1amr')}<input type="number" min={30} max={3650} style={input} value={d.retentionDays} disabled={ro} onChange={(e) => set('retentionDays', Number(e.target.value) || 0)} /></label>
              <label style={label}>{tx('pos.regions_we_care_about_comma_separated')}<input style={input} value={d.regionPreferences.join(', ')} disabled={ro} onChange={(e) => set('regionPreferences', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
            </div>
            <Toggle label={tx('pos.allow_anonymous_posts')} checked={d.allowAnonymous} disabled={ro} onChange={(v) => set('allowAnonymous', v)} />
            <div style={muted}>{tx('pos.risk_matching')}{' '}{d.riskMatchingEnabled ? 'on' : 'off'} {tx('pos.controlled_by_ai_powersalon')}</div>
            <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
              <legend style={{ fontSize: 12.5, fontWeight: 700 }}>{tx('pos.notifications_for_the_salon')}</legend>
              <div style={row}>
                <Toggle label={tx('pos.push')} checked={d.notify.push} disabled={ro} onChange={(v) => setNotify({ push: v })} />
                <Toggle label={tx('pos.email')} checked={d.notify.email} disabled={ro} onChange={(v) => setNotify({ email: v })} />
                <Toggle label={tx('pos.sms_for_critical_alerts')} checked={d.notify.criticalSms} disabled={ro} onChange={(v) => setNotify({ criticalSms: v })} />
              </div>
              <div style={{ ...muted, margin: '8px 0 4px' }}>{tx('pos.alert_us_about_these_categories_none_1kza')}</div>
              <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))' }}>
                {CATEGORIES.map((c) => (
                  <Toggle key={c} label={CATEGORY_LABEL[c]} disabled={ro} checked={d.notify.categories.includes(c)}
                    onChange={(v) => setNotify({ categories: v ? [...d.notify.categories, c] : d.notify.categories.filter((x) => x !== c) })} />
                ))}
              </div>
            </fieldset>
            {manage ? <div style={row}><button style={btnGold} disabled={busy} onClick={save}>{tx('pos.save_community_settings')}</button><button style={btnGhost} disabled={busy} onClick={() => setDraft(view)}>{tx('pos.undo_changes')}</button></div> : null}
          </section>
        ) : <div style={muted}>{tx('pos.loading')}</div>}
        {can(P.follow) ? <CommunityFollowsCard /> : null}
        {manage ? <CommunityAnalyticsCard /> : null}
      </div>
      {rules.modal}
    </div>
  );
}

function CommunityFollowsCard() {
  const [items, setItems] = useState<CommunityFollowView[] | null>(null);
  const [category, setCategory] = useState<CommunityCategory | ''>('');
  const [region, setRegion] = useState('');
  const [severityMin, setSeverityMin] = useState<CommunitySeverity | ''>('');
  const [channels, setChannels] = useState<FollowChannel[]>(['in_app']);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.follows().then(setItems).catch((e) => setError(communityErrorText(e, tx('growth.community.couldNotLoadWhatYouFollow')))), []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setError(null);
    if (!category && !region.trim()) { setError(tx('pos.choose_a_category_or_a_region_1h5i')); return; }
    try { await api.addFollow({ category: category || null, region: region.trim() || null, severityMin: severityMin || null, channels }); setCategory(''); setRegion(''); setSeverityMin(''); await load(); }
    catch (e) { setError(communityErrorText(e, tx('growth.community.couldNotAddThatFollow'))); }
  };
  const remove = async (id: string) => { setError(null); try { await api.removeFollow(id); await load(); } catch (e) { setError(communityErrorText(e, tx('growth.community.couldNotRemoveThatFollow'))); } };
  return (
    <section style={{ ...card, display: 'grid', gap: 8 }} aria-label={tx('pos.what_i_follow')} data-testid="community-follows">
      <div style={cardHead}>{tx('pos.what_i_follow')}{' '}<span style={muted}>{tx('pos.you_get_alerts_for_new_posts_iucw')}</span></div>
      {error ? <div role="alert" style={errText}>{error}</div> : null}
      {items && items.length === 0 ? <div style={muted}>{tx('pos.you_do_not_follow_anything_yet')}</div> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {(items ?? []).map((f) => (
          <li key={f.id} style={{ ...row, justifyContent: 'space-between', fontSize: 13 }} data-testid="community-follow-row">
            <span>{f.category ? CATEGORY_LABEL[f.category] : tx('pos.any_category')}{f.region ? ` · ${f.region}` : ''}{f.severityMin ? tx('pos.v0_and_above', { v0: String(SEVERITY_LABEL[f.severityMin]) }) : ''} · {f.channels.map(pretty).join(', ') || tx('pos.in_app')}</span>
            <button style={btnDanger} onClick={() => remove(f.id)}>{tx('pos.stop_following')}</button>
          </li>
        ))}
      </ul>
      <div style={row}>
        <select style={input} aria-label={tx('pos.follow_category')} value={category} onChange={(e) => setCategory(e.target.value as CommunityCategory | '')}>
          <option value="">{tx('pos.any_category')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input style={{ ...input, width: 120 }} aria-label={tx('pos.follow_region')} placeholder={tx('pos.region')} value={region} onChange={(e) => setRegion(e.target.value)} />
        <select style={input} aria-label={tx('pos.minimum_severity')} value={severityMin} onChange={(e) => setSeverityMin(e.target.value as CommunitySeverity | '')}>
          <option value="">{tx('pos.any_severity')}</option>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]} {tx('pos.and_above')}</option>)}
        </select>
        {FOLLOW_CHANNELS().map(([k, l]) => <Toggle key={k} label={l} checked={channels.includes(k)} onChange={(v) => setChannels(v ? [...channels, k] : channels.filter((c) => c !== k))} />)}
        <button style={btnGold} onClick={add}>{tx('pos.follow')}</button>
      </div>
    </section>
  );
}

function CommunityAnalyticsCard() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [data, setData] = useState<CommunityTenantAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.analytics(from, to).then((a) => { setData(a); setError(null); }).catch((e) => setError(communityErrorText(e, tx('growth.community.couldNotLoadTheCommunityActivity')))); }, [from, to]);
  const stat = (l: string, v: string | number) => <div style={{ display: 'grid' }}><span style={muted}>{l}</span><strong style={{ fontSize: 16 }}>{v}</strong></div>;
  return (
    <section style={{ ...card, display: 'grid', gap: 8 }} aria-label={tx('pos.community_activity')} data-testid="community-analytics">
      <div style={cardHead}>{tx('pos.our_community_activity')}</div>
      <div style={row}>
        <label style={label}>{tx('pos.from')}<input type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={label}>{tx('pos.to_2')}<input type="date" style={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error ? <div role="alert" style={errText}>{error}</div> : null}
      {data ? (
        <>
          <div style={{ ...row, gap: 20 }}>
            {stat(tx('growth.community.stat.published'), data.published)}{stat(tx('growth.community.stat.comments'), data.comments)}{stat(tx('growth.community.stat.similar'), data.similarReports)}{stat(tx('growth.community.stat.followers'), data.followers)}
            {stat(tx('growth.community.stat.avgHours'), data.avgHoursToPublish == null ? '—' : data.avgHoursToPublish.toFixed(1))}
          </div>
          {data.topCategories.length ? <div style={{ fontSize: 12.5 }}>{tx('pos.top_categories')}{' '}{data.topCategories.map((t) => `${CATEGORY_LABEL[t.category] ?? t.category} (${t.count})`).join(', ')}</div> : null}
          {Object.keys(data.posts).length ? <div style={muted}>{tx('pos.by_status_2')}{' '}{Object.entries(data.posts).map(([k, v]) => `${pretty(k)} ${v}`).join(' · ')}</div> : null}
          <AlertPreview preview={(data as CommunityTenantAnalytics & { alertPreview?: AlertPreviewView }).alertPreview} />
        </>
      ) : null}
    </section>
  );
}

/** extras Safety Community 07 — the server runs the fan-out's own plan over the range for this salon (counts only). */
type AlertPreviewView = {
  communityEnabled: boolean; considered: number; wouldReceive: number; truncated: boolean;
  byReason: { critical: number; follow: number; category: number; default: number };
  channels: { inApp: number; push: number; email: number; sms: number };
  bySeverity: { severity: string; count: number }[]; byCategory: { category: string; count: number }[];
};
function AlertPreview({ preview: p }: { preview: AlertPreviewView | undefined }) {
  if (!p) return null;
  const sev = (s: string) => SEVERITY_LABEL[s as CommunitySeverity] ?? pretty(s);
  const cat = (c: string) => CATEGORY_LABEL[c as CommunityCategory] ?? pretty(c);
  return (
    <div style={{ display: 'grid', gap: 4, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 8 }} data-testid="community-alert-preview">
      <strong style={{ fontSize: 13.5 }}>{tx('growth.community.preview.title')}</strong>
      {!p.communityEnabled ? <div style={muted}>{tx('growth.community.preview.off')}</div> : (
        <>
          <div style={{ fontSize: 13 }}>{tx('growth.community.preview.summary', { n: String(p.wouldReceive), m: String(p.considered) })}</div>
          {p.wouldReceive > 0 ? (
            <>
              <div style={{ fontSize: 12.5 }}>{tx('growth.community.preview.reasons', { a: String(p.byReason.critical), b: String(p.byReason.follow), c: String(p.byReason.category), d: String(p.byReason.default) })}</div>
              <div style={{ fontSize: 12.5 }}>{tx('growth.community.preview.channels', { a: String(p.channels.inApp), b: String(p.channels.push), c: String(p.channels.email), d: String(p.channels.sms) })}</div>
              <div style={muted}>{p.bySeverity.map((x) => `${sev(x.severity)} ${x.count}`).join(' · ')}</div>
              <div style={muted}>{p.byCategory.map((x) => `${cat(x.category)} (${x.count})`).join(', ')}</div>
            </>
          ) : null}
          {p.truncated ? <div style={muted}>{tx('growth.community.preview.truncated', { m: String(p.considered) })}</div> : null}
        </>
      )}
      <div style={muted}>{tx('growth.community.preview.note')}</div>
    </div>
  );
}
