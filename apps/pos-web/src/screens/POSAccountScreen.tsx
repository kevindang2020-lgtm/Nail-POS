import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { posSettingsApi } from '../api/posSettingsApi';
import { posAiApi, type PosAiPackage } from '../api/posAiApi';
import { posLocationsApi, type SalonLocation } from '../api/posLocationsApi';
import { posAuditApi, type AuditEventRow } from '../api/posAuditApi';
import { posSessionsApi, type SignInSession } from '../api/posSessionsApi';
import { posAccountApi, type PosAccountOverview } from '../api/posAccountApi';
import { AccessRequestPanel } from './AccessRequestPanel';
import { NotificationPrefsPanel, AccountActivityDialog } from './AccountKit';
import { posPhoneApi, type MessagingReadiness } from '../api/posPhoneApi';
import { posMePrefsApi, type LoginAlertPrefs } from '../api/posMePrefsApi';
import { posSecurityApi } from '../api/posSecurityApi';
import { entitlementOf } from './aiCommStatus';
import { reportError } from './reportsCommon';
import SmsVerificationPanel from '../components/SmsVerificationPanel';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { serverText } from '../i18n/server-text';
import { useTenantNavAccess } from '../shell/tenant-access';
import { AccountFinder } from './accountFinder';

// POSAccountScreen.tsx — T20 Account. Matches the Account mockup 1:1. Panels with a live tenant-scoped source render REAL
// data (identity + avatar, business & brand + receipt branding + notifications, 2FA status, linked branches, AI sub);
// Nov 9 2026 (Account / Notification Preferences / Request Access / Recent Activity guides): a value with no source shows
// "—" or "Not connected" — never a sample (the old 42% storage, "Healthy" notifications, "Premium" plan and brand swatches
// were placeholders and are gone).


type BusinessBranch = { salonName?: string; legalName?: string; phone?: string; branchName?: string; address?: string; city?: string; state?: string; zip?: string; email?: string; timezone?: string };
type Notifications = { smsConfirmation?: boolean; emailConfirmation?: boolean; pushConfirmation?: boolean; noShowFollowUp?: boolean; a2pStatus?: string };
type ReceiptsBranding = { showLogo?: boolean; header?: string; brandPrimary?: string | null; brandAccent?: string | null };
// subscriptionPlan is set by Super Admin and surfaced READ-ONLY to the tenant (aiPackage/aiFeatures are live-resolved
// server-side from tenant_ai_packages). This is the Account screen's super-admin → tenant wiring for the billing panel.
type SubscriptionPlan = { plan?: string; tier?: string; billingStatus?: string; aiPackageIncluded?: boolean; aiPackage?: string; aiFeatures?: Record<string, boolean>; customerCount?: number; technicianCount?: number; smsThisMonth?: number };
type Settings = { businessBranch?: BusinessBranch; notifications?: Notifications; receiptsBranding?: ReceiptsBranding; subscriptionPlan?: SubscriptionPlan };
type Mfa = { enrolled: boolean; confirmed: boolean };
type ProfileMe = { userId: string; role: string; avatarUrl: string | null; email: string | null; fullName: string | null; memberSince: string | null; passwordChangedAt: string | null; lastLoginAt: string | null };

const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, fontFamily: "'Playfair Display', serif" };
const headRow = (title: string, action?: React.ReactNode): React.ReactNode => (<div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><div style={headStyle}>{title}</div>{action ? <div style={{ marginLeft: 'auto' }}>{action}</div> : null}</div>);
const kvRow = (label: string, value: React.ReactNode) => (<div className="row" key={label}><div className="t" style={{ flex: 1, color: 'var(--muted)', fontWeight: 600 }}>{label}</div><div style={{ marginLeft: 'auto', textAlign: 'right', fontWeight: 700 }}>{value}</div></div>);
const ghost = (label: string, fn: () => void, key?: string) => (<button key={key || label} className="btn ghost whitespace-nowrap w-fit" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={fn}>{label}</button>);
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const fmtBytes = (b: number) => { if (b < 1024) return `${b} B`; const u = ['KB', 'MB', 'GB', 'TB']; let v = b / 1024, i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`; };
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
// "owner_branch_selected" / "login.failed" / "payment.refunded" → "Owner Branch Selected" etc.
// an audit action with a catalogue label (admin.audit.action.<code>) shows it; any other is humanised (never blank / raw)
const humanizeAction = (a: string) => { const code = (a || '').trim(); if (!code) return tx('pos.event'); const k = `admin.audit.action.${code}`; const l = tx(k); return l !== k ? l : code.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); };
const fmtWhen = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; const day = fmtInZone(d, { month: 'short', day: '2-digit', year: 'numeric' }); const time = fmtInZone(d, { hour: 'numeric', minute: '2-digit' }); return `${day} — ${time}`; };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : fmtInZone(d, { month: 'short', day: '2-digit', year: 'numeric' }); };
const fmtDateAgo = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000)); return `${fmtDate(iso)} (${days === 0 ? tx('pos.today') : days === 1 ? tx('pos.1_day_ago') : tx('admin.account.daysAgo', { days: String(days) })})`; };
const grid3 = "grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 mb-3";
const G = '#08A64B'; // Tree leaves green

const ICON: Record<string, string> = {
  doc: 'M6 2h7l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M13 2v5h5', shield: 'M12 2l8 3v6c0 5-3.5 8-8 11-4.5-3-8-6-8-11V5z', monitor: 'M3 4h18v11H3z M8 20h8 M12 15v5', building: 'M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17 M15 21V8h4a1 1 0 0 1 1 1v12 M7 7h2 M7 11h2 M7 15h2', card: 'M2 6h20v12H2z M2 10h20', gem: 'M6 3h12l3 6-9 12L3 9z M3 9h18', bell: 'M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9 M10 21a2 2 0 0 0 4 0', chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
};
const Glyph = ({ name }: { name: string }) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICON[name].split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>);

function Ring({ pct, caption, blurb }: { pct: number; caption: string; blurb?: string }) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 4 }}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={G} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 42 42)" />
        <text x="42" y="40" textAnchor="middle" fontFamily="'Playfair Display', serif" fontSize="20" fill="var(--text)">{pct}</text>
        <text x="42" y="54" textAnchor="middle" fontSize="9" fill="var(--muted)">/ 100</text>
      </svg>
      <div style={{ fontSize: 12.5, color: G, fontWeight: 800 }}>{caption}</div>
      {blurb ? <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>{blurb}</div> : null}
    </div>
  );
}
const CheckList = ({ items }: { items: { label: string; ok: boolean }[] }) => (
  <div className="list" style={{ marginTop: 10, gap: 5 }}>{items.map((k) => (<div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}><span style={{ color: k.ok ? G : 'var(--muted)', fontWeight: 800 }}>{k.ok ? '✓' : '○'}</span><span style={{ color: k.ok ? 'var(--text)' : 'var(--muted)' }}>{k.label}</span></div>))}</div>
);
/** the account overview's fixed notification categories arrive as English labels (pos-account-overview.core.ts
 *  NOTIFICATION_CATEGORIES) — the label is the CODE; the screen shows the catalogue text for it */
const SCOPE_KEYS: Record<string, string> = { 'All assigned locations': 'admin.account.scope.allAssigned', 'This location': 'pos.this_location' };
const band = (s: number) => (s >= 90 ? tx('pos.excellent') : s >= 75 ? tx('status.level.good') : s >= 50 ? tx('status.level.fair') : tx('pos.needs_attention'));

export function POSAccountScreen() {
  const nav = useNavigate();
  const { principal } = useAuth();
  const navAccess = useTenantNavAccess(principal?.role, principal?.permissions);   // the sidebar's own gate — the Account Finder lists only what this person may open
  const [settings, setSettings] = useState<Settings | null>(null);
  const [me, setMe] = useState<ProfileMe | null>(null);
  const [pkgs, setPkgs] = useState<PosAiPackage[] | null>(null);
  const [rd, setRd] = useState<MessagingReadiness | null>(null);
  const [rdKnown, setRdKnown] = useState(false);
  const [alerts, setAlerts] = useState<LoginAlertPrefs | null>(null);
  const [trusted, setTrusted] = useState<number | null>(null);
  const [actOpen, setActOpen] = useState(false);
  const [locs, setLocs] = useState<{ locations: SalonLocation[]; summary: any } | null>(null);
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [activity, setActivity] = useState<AuditEventRow[] | null>(null);
  const [sessions, setSessions] = useState<SignInSession[] | null>(null);
  const [overview, setOverview] = useState<PosAccountOverview | null>(null);

  useEffect(() => {
    (posSettingsApi.getState() as Promise<Settings>).then(setSettings).catch(() => setSettings(null));
    api.get<ProfileMe>('/pos/me/profile').then(setMe).catch(() => {});
    posAiApi.packages().then((d) => setPkgs(d?.packages || [])).catch((e) => { reportError(e, 'account'); setPkgs(null); });
    // Notification Health = the salon's real SMS readiness (settings.view); a role without it sees "—", never "Healthy"
    posPhoneApi.readiness().then((r) => { setRd(r); setRdKnown(true); }).catch((e) => { reportError(e, 'account'); setRd(null); setRdKnown(true); });
    posMePrefsApi.loginAlerts().then(setAlerts).catch((e) => { reportError(e, 'account'); setAlerts(null); });
    // trusted devices = the identity layer's own device registry (auth_devices, Security & 2FA) — trusted AND not lapsed
    posSecurityApi.devices().then((d) => setTrusted((d?.devices ?? []).filter((x) => x.trustState === 'trusted' && (!x.trustedUntil || new Date(x.trustedUntil).getTime() > Date.now())).length))
      .catch((e) => { reportError(e, 'account'); setTrusted(null); });
    posLocationsApi.list().then((d) => setLocs(d as any)).catch(() => setLocs(null));
    api.get<Mfa>('/auth/mfa/status').then(setMfa).catch(() => setMfa(null));
    posAuditApi.events({ pageSize: 6 }).then((d) => setActivity(d?.items || [])).catch((e) => { reportError(e, 'account'); setActivity([]); });
    posSessionsApi.list().then((d) => setSessions(d?.sessions || [])).catch(() => setSessions([]));
    posAccountApi.overview().then(setOverview).catch(() => setOverview(null));
  }, []);

  const biz = settings?.businessBranch || {};
  const notif = settings?.notifications || {};
  const rb = settings?.receiptsBranding || {};
  // verified / degraded / blocked / unknown — from the authoritative messaging readiness, not from switch counts
  const notifState: 'verified' | 'degraded' | 'blocked' | 'unknown' = !rd ? 'unknown' : rd.outbound?.state === 'ready_to_attempt' ? 'verified' : rd.outbound?.state === 'degraded' ? 'degraded' : rd.outbound?.state === 'blocked' ? 'blocked' : 'unknown';
  const usage = overview?.usage;
  const storagePct = usage && usage.storageBytesUsed != null && usage.storageLimitBytes ? Math.min(100, Math.round((usage.storageBytesUsed / usage.storageLimitBytes) * 100)) : null;
  const aiActiveCount = pkgs ? pkgs.filter((p) => entitlementOf(p) === 'active').length : null;
  const branchTotal = locs?.summary?.total ?? (locs?.locations?.length || 0) ?? 0;
  const twoFA = !!mfa?.confirmed;
  const avatarUrl = me?.avatarUrl ?? null;
  const fullName = principal?.fullName || me?.fullName || '';
  const email = me?.email || biz.email || '';
  const addr = [biz.address, biz.city, biz.state, biz.zip].filter(Boolean).join(', ');
  const profileFields = [fullName, email, biz.phone, biz.salonName, addr, biz.timezone, avatarUrl, enPlural(branchTotal >= 1 ? 'y' : '')];
  const profilePct = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);   // computed from real fields only (was a fixed 98 until settings loaded)

  // Sep 2026 merge: every value on this screen is real or says it is not connected — the developer's sample fill is gone.

  // Super-admin-controlled subscription (read-only on the tenant). Use it for the billing panel + the two billing KPIs.
  const sp = settings?.subscriptionPlan || {};
  // Nov 9 2026: plan + billing status come from the tenant's subscription row (GET /pos/account/overview). The settings
  // subscriptionPlan block is a template ("Premium" / "Gold" / "active" for every salon unless Super Admin wrote one), so it
  // is no longer read for these — the same plan the Features and Subscription pages show.
  const planName = overview?.billing?.plan || '';
  const billingStatus = overview ? (overview.billing?.status || '') : '';
  const billActive = billingStatus === 'active';
  const aiIncluded = !!sp.aiPackageIncluded;

  // Account Health & Compliance scores — derived from real account state (no fabricated number).
  const a2pOk = (notif.a2pStatus || '').toLowerCase() === 'registered';
  const pwdRecent = me?.passwordChangedAt ? (Date.now() - new Date(me.passwordChangedAt).getTime()) < 180 * 86_400_000 : false;
  const healthChecks = [
    { label: tx('pos.profile_complete_2'), ok: profilePct >= 80 },
    { label: tx('pos.security_enabled'), ok: twoFA },
    { label: tx('pos.billing_up_to_date'), ok: billActive },
    { label: tx('pos.locations_active'), ok: branchTotal >= 1 },
  ];
  const healthScore = Math.round(0.4 * profilePct + 20 * (twoFA ? 1 : 0) + 20 * (billActive ? 1 : 0) + 20 * (branchTotal >= 1 ? 1 : 0));
  const complianceChecks = [
    { label: tx('pos.login_security_2fa'), ok: twoFA },
    { label: tx('pos.messaging_compliance_a2p'), ok: a2pOk },
    { label: tx('pos.password_hygiene'), ok: pwdRecent },
    { label: tx('pos.access_monitored'), ok: sessions != null },
  ];
  const complianceScore = Math.round((complianceChecks.filter((c) => c.ok).length / complianceChecks.length) * 100);
  const premiumTier = /premium|gold|pro|enterprise/i.test(planName);
  const staffCount: number | undefined = undefined;   // the settings template's technicianCount (0) is not a count — Active Users reads the overview

  // Session-derived (real once /pos/me/sessions returns): active count, last login, recent sign-in list.
  const activeSessions = sessions ? sessions.filter((s) => s.active).length : null;
  const lastLoginIso = sessions && sessions.length ? sessions[0].signedInAt : null; // list is most-recent-first

  const kpis: Array<{ l: string; v: string; sub: string; tone: 'ok' | 'warn'; icon: string; to: string; id: string }> = [
    { l: tx('pos.profile_completion'), v: `${profilePct}%`, sub: profilePct >= 100 ? tx('pos.complete_2') : tx('pos.add_the_missing_details'), tone: profilePct >= 80 ? 'ok' : 'warn', icon: 'doc', to: '/tenant/account/security', id: 'profile' },
    { l: tx('pos.2fa_status'), v: mfa ? (twoFA ? tx('pos.enabled') : tx('pos.disabled')) : tx('pos.unknown'), sub: !mfa ? tx('pos.status_unavailable_2') : !twoFA ? tx('pos.set_up_2fa') : tx('admin.account.secure'), tone: mfa && twoFA ? 'ok' : 'warn', icon: 'shield', to: '/tenant/account/security', id: '2fa' },
    { l: tx('pos.active_sessions'), v: activeSessions != null ? String(activeSessions) : '—', sub: activeSessions != null ? tx('pos.view_sessions') : tx('pos.not_available_2'), tone: 'ok', icon: 'monitor', to: '/tenant/account/security', id: 'sessions' },
    { l: tx('pos.linked_branches'), v: String(branchTotal), sub: branchTotal ? tx('pos.linked_to_this_account') : tx('pos.none_linked'), tone: 'ok', icon: 'building', to: '/tenant/management/locations', id: 'branches' },
    { l: tx('pos.billing_status'), v: billActive ? tx('pos.up_to_date') : (billingStatus ? statusLabel(['payment', 'invoice'], billingStatus) : tx('pos.not_set')), sub: overview?.billing?.renewal ? tx('admin.account.nextRenewalShort', { date: fmtDate(overview.billing.renewal) }) : '', tone: billActive ? 'ok' : 'warn', icon: 'card', to: '/tenant/account/billing', id: 'billing' },
    { l: tx('pos.subscription_plan'), v: planName ? cap(planName) : '—', sub: planName ? (overview?.billing?.fee ? tx('acx.planFee', { fee: overview.billing.fee }) : '') : overview ? tx('pos.not_set') : '', tone: planName ? 'ok' : 'warn', icon: 'gem', to: '/tenant/account/subscription', id: 'plan' },
    { l: tx('pos.notification_health'), v: notifState === 'unknown' ? '—' : tt('acx.nh.' + notifState), sub: !rdKnown ? tx('pos.loading') : notifState === 'unknown' ? tt('acx.nh.unknownSub') : rd?.account?.lastCheckedAt ? tt('acx.nh.checked', { at: fmtDate(rd.account.lastCheckedAt) }) : tt('acx.nh.neverChecked'), tone: notifState === 'verified' ? 'ok' : 'warn', icon: 'bell', to: '/tenant/communications/phone', id: 'notif' },
    { l: tx('pos.ai_storage_usage'), v: storagePct != null ? `${storagePct}%` : usage?.storageBytesUsed != null ? fmtBytes(usage.storageBytesUsed) : '—', sub: usage?.storageBytesUsed == null ? tt('acx.usage.unknown') : `${usage.storageLimitBytes ? tt('acx.usage.of', { used: fmtBytes(usage.storageBytesUsed), limit: fmtBytes(usage.storageLimitBytes) }) : tt('acx.usage.noLimit')}${aiActiveCount != null ? ' · ' + tt('acx.usage.ai', { n: aiActiveCount }) : ''}`, tone: storagePct != null && storagePct >= 90 ? 'warn' : 'ok', icon: 'chart', to: '/tenant/account/usage-limits', id: 'usage' },
  ];
  const toneColor = (t: string) => (t === 'ok' ? G : '#9a6a12');

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh "><h1>{tx('pos.account')}</h1><div className="sub ">{tx('pos.manage_profile_business_identity_security_billing_1k5r')}</div></div>
      <AccountFinder access={navAccess} />

      <div className="kpis acx-kpis" data-testid="acx-kpis">
        {kpis.map((c) => (
          <div className="kpi" key={c.l} role="button" tabIndex={0} data-testid={`acx-kpi-${c.id}`} onClick={() => nav(c.to)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(c.to); } }} style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div className="l">{c.l}</div>
              <span style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: 7, background: 'var(--cream2, #F3E7D2)', color: 'var(--g7, #A96F22)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><Glyph name={c.icon} /></span>
            </div>
            <div className="v" style={{ color: toneColor(c.tone), fontSize: 20 }}>{c.v}</div>
            <div className="d" style={{ color: c.tone === 'ok' ? G : '#9a6a12' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Row A — Profile · Business & Brand · Security */}
      <div className={grid3}>
        <section className="panel" data-testid="acx-panel-profile">
          {headRow(tx('pos.account_profile'), ghost(tx('pos.edit_profile'), () => nav('/tenant/account/security')))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: avatarUrl ? `center/cover url(${avatarUrl})` : 'var(--g7, #A96F22)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 20, flex: '0 0 auto' }}>{!avatarUrl ? (fullName || 'U').charAt(0) : ''}</div>
            <div><div style={{ fontWeight: 800, fontSize: 15 }}>{fullName}</div><div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{overview?.profile?.ownerTitle ? statusLabel('role', overview.profile.ownerTitle) : tx('pos.owner')}</div><span className="pill ok" style={{ marginTop: 3, display: 'inline-block' }}>{principal?.role ? statusLabel('role', principal.role) : tx('pos.owner')}</span></div>
          </div>
          <div className="list">
            {kvRow(tx('pos.email'), <span style={{ fontSize: 12 }}>{email || (overview?.profile?.email || '')}</span>)}
            {kvRow(tx('pos.phone'), biz.phone || (overview?.profile?.phone || ''))}
            {kvRow(tx('pos.loyalty_tenant_id'), <span style={{ fontSize: 11 }}>{principal?.tenantId || (overview?.profile?.loyaltyId || '')}</span>)}
            {kvRow(tx('pos.preferred_language'), (overview?.profile?.language || tx('pos.not_set')))}
            {kvRow(tx('pos.member_since'), me?.memberSince ? fmtDate(me.memberSince) : (overview?.profile?.memberSince || ''))}
            {kvRow(tx('pos.last_login'), <span style={{ color: G, fontWeight: 700 }}>{lastLoginIso ? fmtWhen(lastLoginIso) : me?.lastLoginAt ? fmtWhen(me.lastLoginAt) : (overview?.profile?.lastLogin || '')}</span>)}
          </div>
        </section>

        <section className="panel" data-testid="acx-panel-business">
          {headRow(tx('pos.business_brand_details'), ghost(tx('admin.account.editDetails'), () => nav('/tenant/management/salon-profile')))}
          <div className="list">
            {kvRow(tx('pos.business_name'), biz.salonName || (overview?.business?.name || ''))}
            {kvRow(tx('pos.primary_branch'), biz.branchName || (overview?.business?.branch || ''))}
            {kvRow(tx('pos.address_2'), addr || (overview?.business?.address || ''))}
            {kvRow(tx('pos.business_phone'), biz.phone || (overview?.business?.phone || ''))}
            {kvRow(tx('pos.timezone'), biz.timezone || (overview?.business?.timezone || ''))}
            {kvRow(tx('pos.display_name_2'), biz.salonName || (overview?.business?.display || ''))}
            {kvRow(tx('pos.receipts_from'), rb.header || biz.salonName || (overview?.business?.receipts || ''))}
            {kvRow(tx('pos.brand_colors'), (() => { const cs = [rb.brandPrimary, rb.brandAccent].filter((c): c is string => !!c);   // Settings → Receipts & Branding (batch 8 decision 5)
              return <span data-testid="acx-brand-colors" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{cs.length ? cs.map((c) => <span key={c} title={c} style={{ width: 15, height: 15, borderRadius: '50%', background: c, border: '1px solid var(--line)' }} />) : <span className="sub">{tt('acx.notConfigured')}</span>}</span>; })())}
            {kvRow(tx('pos.logo_status'), <span className="pill ok">{rb.showLogo === false ? tx('pos.not_set') : tx('pos.active_3')}</span>)}
          </div>
        </section>

        <section className="panel" data-testid="acx-panel-security">
          {headRow(tx('pos.security_access'), ghost(tx('admin.account.manageSecurity'), () => nav('/tenant/account/security')))}
          <div className="list">
            {kvRow(tx('pos.password_last_changed'), me?.passwordChangedAt ? fmtDateAgo(me.passwordChangedAt) : (overview?.security?.passwordChanged || ''))}
            {kvRow(tx('pos.two_factor_authentication'), <span className={'pill ' + (twoFA ? 'ok' : 'warn')}>{!mfa ? tx('pos.unknown') : twoFA ? tx('pos.enabled') : tx('pos.disabled')}</span>)}
            {kvRow(tx('pos.login_alerts'), <span className={'pill ' + (alerts?.enabled ? 'ok' : alerts ? 'warn' : '')} data-testid="acx-login-alerts">{!alerts ? '—' : alerts.enabled ? tx('pos.enabled') : tx('pos.disabled')}</span>)}
            {kvRow(tx('pos.trusted_devices'), <span data-testid="acx-trusted">{trusted == null ? '—' : tt('acx.trustedN', { n: trusted })}</span>)}   {/* auth_devices (Security & 2FA): a device the user trusted from a 2FA sign-in, not a session count */}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', margin: '10px 0 6px' }}>{tx('pos.recent_sign_ins')}</div>
          {sessions === null ? (
            <div className="muted" style={{ padding: '8px 4px' }}>{tx('pos.loading_sessions')}</div>
          ) : sessions.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '6px 4px' }}>{tx('pos.no_recent_sign_in_sessions_found')}</div>
          ) : (
            <div className="list">
              {sessions.slice(0, 5).map((s) => (
                <div className="row" key={s.id}><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{s.device}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{s.ip || tx('pos.ip_unavailable')}</div></div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmtWhen(s.signedInAt)}</div><span className={'pill ' + (s.active ? 'ok' : 'mut')} style={{ marginTop: 1, display: 'inline-block' }}>{s.active ? tx('pos.active_3') : codeLabel('admin.account.session', s.status)}</span></div></div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>{ghost(tx('admin.account.manageSessions'), () => nav('/tenant/account/security'))}</div>
        </section>
      </div>

      {/* Row B — Notifications · Subscription & Billing · Role & Access */}
      <div className={grid3}>
        <NotificationPrefsPanel rd={rd} rdKnown={rdKnown} />

        <section className="panel" data-testid="acx-panel-billing">
          {headRow(tx('pos.subscription_billing'), ghost(tx('admin.account.manageBilling'), () => nav('/tenant/account/billing')))}
          <div className="row" style={{ marginBottom: 8 }}><div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}><Glyph name="gem" /><span style={{ fontWeight: 800 }}>{planName ? cap(planName) : (overview?.billing?.plan || tx('pos.plan'))} {tx('pos.plan')}</span><span className={'pill ' + (billActive ? 'ok' : 'warn')}>{billActive ? tx('pos.active_3') : billingStatus ? statusLabel(['payment', 'invoice'], billingStatus) : tx('pos.active_3')}</span></div></div>
          <div className="list" style={{ maxHeight: 'none' }}>
            {kvRow(tx('pos.next_renewal'), overview?.billing?.renewal ? fmtDate(overview.billing.renewal) : tx('pos.not_set'))}
            {kvRow(tx('pos.payment_method_2'), overview?.billing?.method ? tx('pos.method_exp_v1', { method: String(overview.billing.method), v1: String(overview.billing.expires ?? '—') }) : tx('pos.held_by_the_card_processor'))}
            {kvRow(tx('pos.monthly_software_fee'), overview?.billing?.fee || tx('pos.not_set'))}
            {kvRow(tx('pos.locations_included'), overview?.billing?.locations ?? String(branchTotal))}   {/* no plan limit is recorded — the count only */}
            {kvRow(tx('pos.active_users'), staffCount != null ? String(staffCount) : (overview?.billing?.users ?? '—'))}   {/* no plan user limit is recorded */}
          </div>
          <div style={{ margin: '8px 0 2px' }}>
            {[{ l: tx('pos.all_premium_features'), on: premiumTier }, { l: tx('pos.ai_insights_automation'), on: aiIncluded }, { l: tx('pos.priority_support'), on: premiumTier }, { l: tx('pos.advanced_integrations'), on: premiumTier }].map((f) => (<div key={f.l} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}><span style={{ color: f.on ? G : 'var(--muted)', fontWeight: 800 }}>{f.on ? '✓' : '—'}</span><span style={{ flex: 1 }}>{f.l}</span><span style={{ color: f.on ? G : 'var(--muted)', fontWeight: 700, fontSize: 11 }}>{f.on ? tx('pos.included_2') : tx('pos.not_in_plan')}</span></div>))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}><button className="btn whitespace-nowrap w-fit" onClick={() => nav('/tenant/account/subscription')}>{tx('pos.upgrade_plan')}</button>{ghost(tx('admin.account.billingHistory'), () => nav('/tenant/account/billing'))}</div>
        </section>

        <section className="panel" data-testid="acx-panel-role">
          {headRow(tx('pos.role_access_overview'), ghost(tx('admin.account.manageAccess'), () => nav('/tenant/account/users-roles')))}
          <div className="list">
            {kvRow(tx('pos.your_role'), <span className="pill ok">{principal?.role ? statusLabel('role', principal.role) : tx('pos.owner')}</span>)}
            {kvRow(tx('pos.access_level_2'), overview?.role?.level ? statusLabel('role', overview.role.level) : '')}
            {kvRow(tx('pos.data_scope'), principal?.branchId ? tx('pos.this_branch_2') : (overview?.role?.scope ? (SCOPE_KEYS[overview.role.scope] ? tx(SCOPE_KEYS[overview.role.scope]) : serverText(overview.role.scope)) : ''))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', margin: '10px 0 6px' }}>{tx('pos.branch_access')}</div>
          <div className="list" style={{ maxHeight: 'none' }}>
            {(overview?.role?.branches || []).map((b) => (
              <div className="row" key={b.name}><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{b.name}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{b.sub}</div></div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontWeight: 700 }}>{statusLabel('role', b.role)} · {serverText(b.access)}</div><span className="pill ok" style={{ marginTop: 2, display: 'inline-block' }}>{statusLabel(['teamMember', 'location'], b.status)}</span></div></div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8, textAlign: 'center' }}>
            {[[tx('admin.account.users.total'), (overview?.role?.totals || { users: 0, admins: 0, managers: 0, staff: 0 }).users], [tx('admin.account.users.admins'), (overview?.role?.totals || { users: 0, admins: 0, managers: 0, staff: 0 }).admins], [tx('admin.account.users.managers'), (overview?.role?.totals || { users: 0, admins: 0, managers: 0, staff: 0 }).managers], [tx('pos.staff'), (overview?.role?.totals || { users: 0, admins: 0, managers: 0, staff: 0 }).staff]].map(([l, v]) => (<div key={l as string} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '6px 2px' }}><div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17 }}>{v}</div><div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{l}</div></div>))}
          </div>
        </section>
        <AccessRequestPanel currentRole={principal?.role} />
      </div>

      {/* Row C — Recent Activity · Account Health · Compliance · Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <section className="panel" data-testid="acx-panel-activity">
          {headRow(tx('pos.recent_account_activity'), <span style={{ display: 'inline-flex', gap: 6 }}>{ghost(tt('acx.act.viewAll'), () => setActOpen(true), 'acx-act-open')}{ghost(tx('admin.account.fullAuditLog'), () => nav('/tenant/account/activity-logs'))}</span>)}
          {activity === null ? (
            <div className="muted" style={{ padding: '16px 4px' }}>{tx('pos.loading_activity')}</div>
          ) : activity.length === 0 ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: '20px 8px' }}>
              <div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--cream2, #F3E7D2)', color: 'var(--g7, #A96F22)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}><Glyph name="monitor" /></div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_recent_account_activity')}</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.1fr 1.4fr 1fr', gap: 8, fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em', padding: '0 4px 6px' }}><div>{tx('pos.time')}</div><div>{tx('pos.event')}</div><div>{tx('pos.details')}</div><div>{tx('pos.by_2')}</div></div>
              <div className="list" style={{ maxHeight: 'none' }}>
                {activity.map((a) => (
                  <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.1fr 1.4fr 1fr', gap: 8, alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid var(--line)', fontSize: 11.5 }}><div style={{ color: 'var(--muted)' }}>{fmtWhen(a.occurredAt)}</div><div style={{ fontWeight: 700 }}>{humanizeAction(a.action)}</div><div style={{ color: 'var(--muted)' }}>{a.summary || codeLabel('admin.audit.module', a.module)}</div><div>{a.actorName || tx('pos.system')}</div></div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel" data-testid="acx-panel-health">
          {headRow(tx('pos.account_health_score'))}
          <Ring pct={healthScore} caption={band(healthScore)} blurb={healthScore >= 90 ? tx('pos.your_account_is_in_great_shape') : healthScore >= 75 ? tx('pos.a_few_items_could_be_tightened_x0yg') : tx('pos.some_account_setup_still_needs_attention')} />
          <CheckList items={healthChecks} />
        </section>

        <section className="panel" data-testid="acx-panel-compliance">
          {headRow(tx('pos.compliance_score'))}
          <Ring pct={complianceScore} caption={band(complianceScore)} blurb={complianceScore >= 90 ? tx('pos.your_compliance_is_in_great_shape') : complianceScore >= 75 ? tx('pos.mostly_compliant_one_item_to_resolve') : tx('pos.resolve_the_unchecked_items_below')} />
          <CheckList items={complianceChecks} />
        </section>

        <section className="panel" data-testid="acx-panel-backup">
          {headRow(tx('pos.backup_data_health'))}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 12px' }}><span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--cream2, #F3E7D2)', color: 'var(--g7, #A96F22)', display: 'grid', placeItems: 'center' }}><Glyph name="chart" /></span></div>
          <div className="list">
            {kvRow(tx('pos.last_backup'), overview?.backup?.last ? fmtWhen(overview.backup.last) : tx('pos.not_connected_2'))}
            {kvRow(tx('pos.status'), overview?.backup?.status ? <span className="pill ok">{codeLabel('admin.account.backup', overview.backup.status)}</span> : tx('pos.not_connected_2'))}
            {kvRow(tx('pos.next_backup'), overview?.backup?.next ? fmtWhen(overview.backup.next) : tx('pos.not_connected_2'))}
          </div>
          {/* Sep 2026 merge: 'Run Backup Now' only opened the support page — there is no on-demand backup; the button is gone */}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel">
        <div style={{ ...headStyle, marginBottom: 10 }}>{tx('pos.quick_actions_2')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { l: tx('pos.edit_profile'), fn: () => nav('/tenant/account/security') },
            { l: tx('pos.manage_2fa'), fn: () => nav('/tenant/account/security') },
            { l: tx('pos.change_password'), fn: () => nav('/tenant/account/security') },
            { l: tx('pos.update_billing'), fn: () => nav('/tenant/account/billing') },
            { l: tx('pos.notification_settings'), fn: () => nav('/tenant/account/security') },
            { l: tx('pos.brand_settings'), fn: () => nav('/tenant/management/salon-profile') },
            { l: tx('pos.view_audit_log'), fn: () => nav('/tenant/account/activity-logs') },
            { l: tx('pos.view_activity_logs'), fn: () => nav('/tenant/account/activity-logs') },   // was labelled 'Export Account Data' — it opens the logs
          ].map((a) => <button key={a.l} className="btn ghost whitespace-nowrap w-fit" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>

      {actOpen ? <AccountActivityDialog onClose={() => setActOpen(false)} /> : null}
      <SmsVerificationPanel />
      <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', opacity: 0.8 }}>{tx('pos.identity_plan_billing_ai_inclusion_branches_1cml')}</div>
    </div>
  );
}
