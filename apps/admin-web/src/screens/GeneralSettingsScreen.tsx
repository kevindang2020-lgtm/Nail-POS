// GeneralSettingsScreen.tsx — Super Admin › System Settings › General Settings (platform-wide configuration).
// Units 2+3: shell + header + banner + 8 summary cards + 8 settings panels (real data; honest "not configured yet"
// for entities built in later units), plus the CORE EDITING LOOP — per-group edit drawers with client validation
// (mirroring the backend), live localization previews, a staged-changes model, a Save summary + confirmation,
// optimistic-concurrency handling, and an unsaved-changes guard. Save calls POST /super-admin/settings/general/save.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, MiniBars, AreaLine, NotConnected } from './_chartkit';

type Setting = { key: string; group: string; label: string; valueType: string; value: unknown; default: unknown; policy: string; mandatory: boolean; sensitive: boolean; version: number; isExplicitlySet: boolean };
type Groups = { group: string; settings: Setting[] }[];
type Overview = { cards: Record<string, any> } | null;
type Pending = Record<string, { key: string; value: unknown; from: unknown; label: string; version: number; group: string }>;

const GROUP_TITLE: Record<string, string> = { platform_identity: 'Platform Identity', support_contact: 'Support Contact Information', localization: 'Localization & Formatting', platform_urls: 'Platform Links & URLs', maintenance: 'Maintenance & Messaging', global_defaults: 'Global Defaults', business: 'Business Categories & Defaults', legal: 'Legal Documents', customer_display_ads: 'Customer Display Advertising' };
// Groups editable in this unit (real scalar settings). Legal/Maintenance/URLs/Business get dedicated editors in later units.
const EDITABLE = new Set(['platform_identity', 'support_contact', 'localization', 'global_defaults', 'customer_display_ads']);

const LOCALES: [string, string][] = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish (ES)'], ['fr-FR', 'French (FR)'], ['de-DE', 'German (DE)'], ['pt-BR', 'Portuguese (BR)']];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'UTC', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'];
const DATE_FORMATS: [string, string][] = [['MMM dd, yyyy', 'May 06, 2026'], ['MM/dd/yyyy', '05/06/2026'], ['dd/MM/yyyy', '06/05/2026'], ['yyyy-MM-dd', '2026-05-06']];
const TIME_FORMATS: [string, string][] = [['12h', '12-Hour (02:34 PM)'], ['24h', '24-Hour (14:34)']];
const NUMBER_FORMATS: [string, string][] = [['1,234.56', '1,234.56'], ['1.234,56', '1.234,56'], ['1 234,56', '1 234,56']];

function validate(valueType: string, value: unknown): string | null {
  switch (valueType) {
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : 'Must be a number';
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : 'Must be a valid email';
    case 'url': { let u: URL; try { u = new URL(String(value)); } catch { return 'Must be a valid URL'; } if (u.protocol === 'javascript:' || u.protocol === 'data:') return 'Unsafe URL scheme'; if (u.protocol !== 'https:') return 'Must use https'; return null; }
    case 'color': return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value)) ? null : 'Must be a hex color';
    case 'string': return /<\s*script/i.test(String(value ?? '')) ? 'Must not contain script' : null;
    default: return null;
  }
}
const tzParts = (tz: string) => { const now = new Date(); const p: Record<string, string> = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value])); p.mShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(now); return p; };
function previewDate(fmt: string, tz: string) { try { const p = tzParts(tz); switch (fmt) { case 'MM/dd/yyyy': return `${p.month}/${p.day}/${p.year}`; case 'dd/MM/yyyy': return `${p.day}/${p.month}/${p.year}`; case 'yyyy-MM-dd': return `${p.year}-${p.month}-${p.day}`; default: return `${p.mShort} ${p.day}, ${p.year}`; } } catch { return '—'; } }
function previewTime(fmt: string, tz: string) { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: fmt !== '24h' }).format(new Date()); } catch { return '—'; } }
function previewCurrency(cur: string, locale: string) { try { return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(1234.56); } catch { return '—'; } }
function previewNumber(fmt: string) { return fmt === '1.234,56' ? '1.234,56' : fmt === '1 234,56' ? '1 234,56' : '1,234.56'; }

const fmtVal = (s: Setting, v: unknown = s.value): string => {
  // extras Reviews Reputation 07 (round 11): the review-request text price is blank by default — "Not set", never "Unlimited"
  if (s.key === 'sms.review_request_price_cents') return v === null || v === undefined || v === '' ? 'Not set' : `${String(v)}¢ per text`;
  if (v === null || v === undefined || v === '') return s.valueType === 'json' ? 'Unlimited' : '—';
  if (s.valueType === 'boolean') return v ? 'ON' : 'OFF';
  if (s.key === 'localization.time_format') return v === '12h' ? '12-Hour (02:34 PM)' : '24-Hour (14:34)';
  if (s.key === 'localization.default_language') return (LOCALES.find((l) => l[0] === v)?.[1]) || String(v);
  if (s.key === 'localization.default_currency') return `${v} (${(() => { try { return (0).toLocaleString('en', { style: 'currency', currency: String(v) }).replace(/[\d.,\s]/g, ''); } catch { return v; } })()})`;
  if (s.key === 'defaults.tenant_trial_days') return `${v} days`;
  if (s.key === 'defaults.booking_interval_min') return `${v} minutes`;
  if (s.key === 'display_ads.max_file_size_mb' || s.key === 'display_ads.storage_limit_mb') return `${v} MB`;
  if (s.key === 'display_ads.max_ads_per_tenant') return `${v} ads`;
  if (s.key === 'display_ads.allowed_mime_types') return String(v).split(',').map((t) => t.trim().replace('image/', '').toUpperCase()).filter(Boolean).join(', ') || 'None';
  return String(v);
};

const statusLabel = (s: string) => (s ? s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : s);

function maintByMonth(events: any[] | null): { label: string; value: number; tip?: string }[] {
  if (!events || events.length === 0) return [];
  const buckets = new Map<string, number>();
  for (const e of events) {
    if (!e.startsAt) continue;
    const d = new Date(e.startsAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-6).map(([k, v]) => {
    const [y, m] = k.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short' }) + " '" + y.slice(2);
    return { label, value: v, tip: `${v} event${v === 1 ? '' : 's'}` };
  });
}

function Row({ k, v, mut, first }: { k: string; v: ReactNode; mut?: boolean; first?: boolean }) {
  return <div className={'setrow' + (first ? ' first' : '') + ' mb-3'}><span className="k font-semibold mr-1 text-sm">{k} :-</span><span className={'v' + (mut ? ' mut' : '')}>{v}</span></div>;
}
function Panel({ n, title, action, onAction, dirty, children }: { n: number; title: string; action: string; onAction: () => void; dirty?: boolean; children: ReactNode }) {
  return (
    <section className="panel setpanel">
      <div className="phd flex justify-between gap-3 border-b border-[var(--grad)] pb-2 mb-2"><h2>{n}. {title}{dirty ? <span title="Unsaved changes" style={{ color: 'var(--accent,#F97316)', marginLeft: 6 }}>●</span> : null}</h2><button className="btn ghost !min-h-6 " onClick={onAction}>{action}</button></div>
      {children}
    </section>
  );
}

export function GeneralSettingsScreen() {
  const [groups, setGroups] = useState<Groups | null>(null);
  const [overview, setOverview] = useState<Overview>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [legalDocs, setLegalDocs] = useState<any[] | null>(null);
  const [legalVersion, setLegalVersion] = useState<{ available: boolean; version: string | null; docCount: number } | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const [maint, setMaint] = useState<any>(null);
  const [maintOpen, setMaintOpen] = useState(false);
  const [series, setSeries] = useState<{ date: string; count: number }[] | null>(null);
  const [recentChanges, setRecentChanges] = useState<any[] | null>(null);
  const [legalHistory, setLegalHistory] = useState<any[] | null>(null);
  const [acceptance, setAcceptance] = useState<any | null>(null);
  const [maintHistory, setMaintHistory] = useState<any[] | null>(null);
  const [localeDist, setLocaleDist] = useState<any>(null);
  const [adoption, setAdoption] = useState<any>(null);
  const nav = useNavigate();
  const [health, setHealth] = useState<any | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [bizSummary, setBizSummary] = useState<{ active: number; total: number } | null>(null);
  const [bizOpen, setBizOpen] = useState(false);
  const [presetDefaults, setPresetDefaults] = useState<any>(null);
  const [presetRows, setPresetRows] = useState<any[] | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [branding, setBranding] = useState<any>(null);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const loadBranding = () => { superAdminApi.branding().then(setBranding).catch(() => setBranding(null)); };

  const loadBiz = () => { superAdminApi.bizCategoriesSummary().then(setBizSummary).catch(() => setBizSummary(null)); };
  const loadPresets = () => {
    superAdminApi.tenantPresetDefaults().then(setPresetDefaults).catch(() => setPresetDefaults(null));
    superAdminApi.tenantPresets().then(setPresetRows).catch(() => setPresetRows([]));
  };

  const loadMaint = () => { superAdminApi.maintenanceState().then(setMaint).catch(() => setMaint(null)); };
  const loadAnalytics = () => {
    superAdminApi.generalSettingsSeries(7).then(setSeries).catch(() => setSeries([]));
    superAdminApi.generalSettingsHistory(20).then(setRecentChanges).catch(() => setRecentChanges([]));
    superAdminApi.legalDocHistory(10).then(setLegalHistory).catch(() => setLegalHistory([]));
    superAdminApi.legalDocAcceptance('terms_of_service').then(setAcceptance).catch(() => setAcceptance(null));
    superAdminApi.maintenanceHistory(50).then(setMaintHistory).catch(() => setMaintHistory([]));
    superAdminApi.generalSettingsLocaleDistribution().then(setLocaleDist).catch(() => setLocaleDist(null));
    superAdminApi.generalSettingsAdoptionRate().then(setAdoption).catch(() => setAdoption(null));
  };

  const loadLegal = () => {
    Promise.all([superAdminApi.legalDocuments(), superAdminApi.legalDocOverviewVersion()])
      .then(([d, v]) => { setLegalDocs(d); setLegalVersion(v); })
      .catch(() => { setLegalDocs([]); setLegalVersion({ available: false, version: null, docCount: 0 }); });
  };
  const load = () => {
    setLoading(true); setError(null); loadLegal(); loadMaint(); loadAnalytics(); loadBiz(); loadPresets(); loadBranding();
    Promise.all([superAdminApi.generalSettings(), superAdminApi.generalSettingsOverview()])
      .then(([s, o]) => { setGroups(s.groups); setOverview(o); })
      .catch((e: any) => setError(e?.message || 'Could not load settings.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (pendingCount > 0) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pendingCount]);

  const byGroup = useMemo(() => { const m: Record<string, Setting[]> = {}; for (const g of groups || []) m[g.group] = g.settings; return m; }, [groups]);
  const val = (key: string): Setting | undefined => (groups || []).flatMap((g) => g.settings).find((s) => s.key === key);
  const eff = (s: Setting): unknown => (s.key in pending ? pending[s.key].value : s.value);
  const groupDirty = (g: string) => (byGroup[g] || []).some((s) => s.key in pending);

  const stageEdits = (group: string, edited: Record<string, unknown>) => {
    setPending((prev) => {
      const next = { ...prev };
      for (const s of byGroup[group] || []) {
        if (!(s.key in edited)) continue;
        const nv = edited[s.key];
        if (JSON.stringify(nv ?? null) === JSON.stringify(s.value ?? null)) delete next[s.key];
        else next[s.key] = { key: s.key, value: nv, from: s.value, label: s.label, version: s.version, group };
      }
      return next;
    });
  };
  const discardAll = () => { setPending({}); setNotice(null); };

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const changes = Object.values(pending).map((p) => ({ key: p.key, value: p.value, expectedVersion: p.version, reason: 'Updated via General Settings' }));
      const res = await superAdminApi.generalSettingsSave(changes);
      if (res.conflicts.length) setNotice({ ok: false, msg: `${res.conflicts.length} setting(s) changed elsewhere and were not saved — showing the latest.` });
      else setNotice({ ok: true, msg: `Saved ${res.applied.length} change${res.applied.length === 1 ? '' : 's'}.` });
      setPending({}); setConfirmSave(false); load();
    } catch (e: any) { setNotice({ ok: false, msg: e?.message || 'Save failed.' }); }
    finally { setSaving(false); }
  };

  const exportSettings = () => {
    const payload: Record<string, Record<string, unknown>> = {};
    for (const g of groups || []) { payload[g.group] = {}; for (const s of g.settings) payload[g.group][s.key] = eff(s); }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings: payload }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aipowersalon-general-settings.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  const runOp = async (op: string) => {
    setOpBusy(op); setNotice(null);
    try { const r = await superAdminApi.generalSettingsOperation(op); setNotice({ ok: r.ok, msg: r.note }); }
    catch (e: any) { setNotice({ ok: false, msg: e?.message || 'Operation failed.' }); }
    finally { setOpBusy(null); }
  };
  const doReset = async () => {
    setOpBusy('reset'); setNotice(null);
    try { const r = await superAdminApi.generalSettingsReset('RESET'); setResetOpen(false); setResetText(''); setPending({}); load(); setNotice({ ok: true, msg: `Reset ${r.reset} setting${r.reset === 1 ? '' : 's'} to defaults.` }); }
    catch (e: any) { setNotice({ ok: false, msg: e?.message || 'Reset failed.' }); }
    finally { setOpBusy(null); }
  };
  const checkHealth = async () => { setHealthBusy(true); try { setHealth(await superAdminApi.systemHealth()); } catch (e: any) { setHealth({ error: e?.message || 'Health check failed.' }); } finally { setHealthBusy(false); } };
  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const flat: Record<string, unknown> = {};
        const src = parsed?.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed;
        for (const g of Object.values(src as Record<string, any>)) if (g && typeof g === 'object') for (const [k, v] of Object.entries(g)) flat[k] = v;
        const staged: Record<string, unknown> = {};
        for (const s of (groups || []).flatMap((x) => x.settings)) if (s.key in flat && JSON.stringify(flat[s.key] ?? null) !== JSON.stringify(s.value ?? null)) staged[s.key] = flat[s.key];
        const keys = Object.keys(staged);
        if (keys.length === 0) { setNotice({ ok: true, msg: 'Import parsed — no changed settings to apply.' }); return; }
        const grpOf = (key: string) => (groups || []).find((x) => x.settings.some((s) => s.key === key))?.group || '';
        setPending((prev) => { const next = { ...prev }; for (const k of keys) { const s = (groups || []).flatMap((x) => x.settings).find((y) => y.key === k)!; next[k] = { key: k, value: staged[k], from: s.value, label: s.label, version: s.version, group: grpOf(k) }; } return next; });
        setNotice({ ok: true, msg: `Imported ${keys.length} change${keys.length === 1 ? '' : 's'} — review and Save to apply.` });
      } catch { setNotice({ ok: false, msg: 'Could not parse that file — expected a settings JSON export.' }); }
    };
    reader.readAsText(file);
  };

  if (loading && !groups) return <div className="tnt"><div className="vh"><h1>General Settings</h1></div><div className="muted" style={{ padding: 40 }}>Loading platform settings…</div></div>;
  if (error && !groups) return <div className="tnt"><div className="vh"><h1>General Settings</h1></div><div className="panel" style={{ marginTop: 14 }}><div className="muted">{error}</div><button className="btn" style={{ marginTop: 10 }} onClick={load}>Retry</button></div></div>;

  const c = overview?.cards || {};
  const cards = [
    { l: 'Active Tenants', ico: '👥', tint: '#EEF2FF', fg: '#4338CA', v: c.activeTenants?.available ? String(c.activeTenants.value) : '—', d: c.activeTenants?.available ? c.activeTenants.trend : 'No data yet', dOk: !!c.activeTenants?.trend },
    { l: 'Platform Locale', ico: '🌐', tint: '#EFF6FF', fg: '#1D4ED8', v: c.platformLocale?.value ?? '—', d: c.platformLocale?.label, dOk: false },
    { l: 'Active Brand Theme', ico: '🎨', tint: '#FFF1E8', fg: '#EA580C', v: c.brandTheme?.value ?? '—', d: c.brandTheme?.label, dOk: false },
    { l: 'Maintenance Mode', ico: '🔧', tint: maint?.active ? '#FEF3C7' : '#F1F5F9', fg: maint?.active ? '#B45309' : '#475569', v: maint?.active ? 'ON' : 'OFF', d: maint?.active ? (maint.mode === 'read_only' ? 'Read-only' : 'Maintenance Active') : 'Platform is Live', dOk: false },
    { l: 'Legal Docs Version', ico: '📄', tint: '#EEF2FF', fg: '#4338CA', v: legalVersion?.available ? (legalVersion.version || '—') : '—', d: legalVersion?.available ? `${legalVersion.docCount} Document${legalVersion.docCount === 1 ? '' : 's'}` : 'Not configured', dOk: false },
    { l: 'Default Time Zone', ico: '🕐', tint: '#F5F3FF', fg: '#6D28D9', v: c.defaultTimezone?.value ?? '—', d: c.defaultTimezone?.label, dOk: false },
    { l: 'Support Channels', ico: '🎧', tint: '#ECFEFF', fg: '#0E7490', v: c.supportChannels?.value != null ? String(c.supportChannels.value) : '—', d: c.supportChannels?.label, dOk: false },
    { l: 'Platform Status', ico: c.platformStatus?.value === 'Healthy' ? '✅' : '⚠️', tint: '#ECFDF5', fg: '#047857', v: c.platformStatus?.value ?? '—', d: c.platformStatus?.label, dOk: false },
  ];
  const gs = (g: string) => byGroup[g] || [];

  return (
    <div className="work">
      <div className="vh flex flex-col lg:flex-row justify-between gap-3 mb-3 " >
        <div>
          <h1>General Settings <span className="gstar">★</span></h1>
          <div className="sub">Controls basic platform-wide configuration.</div>
        </div>
        <div className="self-baseline" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={exportSettings}>Export Settings</button>
          <button className="btn" disabled={pendingCount === 0 || saving} onClick={() => setConfirmSave(true)}>{pendingCount > 0 ? `Save ${pendingCount} Change${pendingCount === 1 ? '' : 's'}` : '+ Save Changes'}</button>
        </div>
      </div>

      <div className="infobanner" role="note"><span className="ic" aria-hidden>ⓘ</span>These settings apply platform-wide and serve as defaults for all tenants and branches unless overridden.</div>

      {pendingCount > 0 && (
        <div className="infobanner" style={{ background: '#FFF7ED', borderColor: '#FED7AA', color: '#9A3412' }} role="status">
          <span className="ic" aria-hidden>●</span>
          <span style={{ flex: 1 }}>You have {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}.</span>
          <button className="btn sm" onClick={() => setConfirmSave(true)}>Review &amp; Save</button>
          <button className="btn ghost sm" onClick={discardAll}>Discard</button>
        </div>
      )}
      {notice && <div className="infobanner" style={notice.ok ? { background: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46' } : { background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }} role="status" onClick={() => setNotice(null)}><span className="ic" aria-hidden>{notice.ok ? '✓' : '!'}</span>{notice.msg}</div>}

      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">
        {cards.map((k) => (
          <div className="kpi" key={k.l}>
            <div className="top"><div className="ico" style={{ background: k.tint, color: k.fg }} aria-hidden>{k.ico}</div><div className="l">{k.l}</div></div>
            <div className="text-base font-semibold py-1">{k.v}</div>
            {k.d ? <div className={'d' + (k.dOk ? '' : ' flat')}>{k.d}</div> : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mb-3 ">
        <Panel n={1} title="Platform Identity" action="Edit" dirty={groupDirty('platform_identity')} onAction={() => setOpenGroup('platform_identity')}>
          <Row first k="Platform Name" v={fmtVal(val('platform.name')!, eff(val('platform.name')!))} />
          <Row k="Active Theme" v={fmtVal(val('platform.theme')!, eff(val('platform.theme')!))} />
          <Row k="Brand Colors" v={branding
            ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{[branding.primary_color, branding.accent_color, branding.secondary_color].map((col: string, i: number) => <span key={i} title={col} style={{ width: 13, height: 13, borderRadius: 3, background: col, border: '1px solid rgba(0,0,0,.15)' }} />)}<button className="linkbtn" style={{ marginLeft: 5 }} onClick={() => setBrandingOpen(true)}>Manage</button></span>
            : <span className="mut">Managed in Branding</span>} />
          <Row k="Legal Name" v={fmtVal(val('platform.legal_name')!, eff(val('platform.legal_name')!))} />
        </Panel>
        <Panel n={2} title="Support Contact Information" action="Edit" dirty={groupDirty('support_contact')} onAction={() => setOpenGroup('support_contact')}>
          {gs('support_contact').map((s, i) => <Row key={s.key} first={i === 0} k={s.label} v={fmtVal(s, eff(s))} />)}
        </Panel>
        <Panel n={3} title="Localization & Formatting" action="Edit" dirty={groupDirty('localization')} onAction={() => setOpenGroup('localization')}>
          {gs('localization').map((s, i) => <Row key={s.key} first={i === 0} k={s.label} v={fmtVal(s, eff(s))} />)}
        </Panel>
        <Panel n={4} title="Business Categories & Defaults" action="Edit" onAction={() => setBizOpen(true)}>
          <Row first k="Business Categories" v={bizSummary ? (bizSummary.active > 0 ? `${bizSummary.active} ${bizSummary.active === 1 ? 'Category' : 'Categories'}` : <span className="mut">Not configured yet</span>) : <span className="mut">—</span>} mut={!bizSummary?.active} />
          <Row k="Default Tenant Settings" v={presetDefaults?.tenant ? `${presetDefaults.tenant.name} · ${presetDefaults.tenant.count} settings` : <span className="mut">—</span>} mut={!presetDefaults?.tenant} />
          <Row k="Default Branch Settings" v={presetDefaults?.branch ? `${presetDefaults.branch.name} · ${presetDefaults.branch.count} settings` : <span className="mut">—</span>} mut={!presetDefaults?.branch} />
          <Row k="Default Onboarding Prefs." v={presetDefaults?.onboarding ? `${presetDefaults.onboarding.name} · ${presetDefaults.onboarding.count} settings` : <span className="mut">—</span>} mut={!presetDefaults?.onboarding} />
        </Panel>
     
        <Panel n={5} title="Legal Documents" action="Manage All" onAction={() => setLegalOpen(true)}>
          {legalDocs === null ? <div className="muted" style={{ fontSize: 12, padding: '4px 0' }}>Loading…</div>
            : legalDocs.length === 0 ? <div className="muted" style={{ fontSize: 12, padding: '4px 0' }}>No legal documents configured yet — use Manage All to create Terms, Privacy or Cookie policies.</div>
              : <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Document</th><th>Version</th><th>Updated</th><th>Status</th></tr></thead>
                <tbody>{legalDocs.slice(0, 4).map((d) => (
                  <tr key={d.docType}><td>{d.label}</td><td>{d.version}</td><td className="muted">{d.lastUpdated ? new Date(d.lastUpdated).toLocaleDateString() : '—'}</td><td><span className={'pill ' + (d.status === 'published' ? 'ok' : d.status === 'draft' ? '' : 'warn')}>{statusLabel(d.status)}</span></td></tr>
                ))}</tbody>
              </table>}
        </Panel>
        <Panel n={6} title="Maintenance &amp; Messaging" action="Edit" onAction={() => setMaintOpen(true)}>
          <Row first k="Maintenance Mode" v={maint ? (maint.active ? (maint.mode === 'read_only' ? 'ON · Read-only' : 'ON') : 'OFF') : '—'} />
          <Row k="Maintenance Message" v={maint?.active && maint?.message ? String(maint.message) : <span className="mut">—</span>} />
          <Row k="Scheduled Maintenance" v={maint?.nextScheduled ? new Date(maint.nextScheduled.startsAt).toLocaleString() : <span className="mut">None Scheduled</span>} mut={!maint?.nextScheduled} />
          <Row k="Announcement Banner" v={maint?.announcementBanner ? 'Active' : <span className="mut">None</span>} />
        </Panel>
        <Panel n={7} title="Platform Links &amp; URLs" action="Edit" onAction={() => setOpenGroup('platform_urls')}>
          {gs('platform_urls').slice(0, 5).map((s, i) => <Row key={s.key} first={i === 0} k={s.label} v={fmtVal(s)} />)}
        </Panel>
        <Panel n={8} title="Global Defaults" action="Edit" dirty={groupDirty('global_defaults')} onAction={() => setOpenGroup('global_defaults')}>
          {gs('global_defaults').map((s, i) => <Row key={s.key} first={i === 0} k={s.label} v={fmtVal(s, eff(s))} />)}
        </Panel>
        {/* 23-inch dual-screen spec §110: the platform limits on salons' customer-display ads. The feature's on/off switch is
            its Feature Registry entry (customer_display_ads); a single salon is switched in its plan's feature overrides. */}
        <Panel n={9} title="Customer Display Advertising" action="Edit" dirty={groupDirty('customer_display_ads')} onAction={() => setOpenGroup('customer_display_ads')}>
          {gs('customer_display_ads').map((s, i) => <Row key={s.key} first={i === 0} k={s.label} v={fmtVal(s, eff(s))} />)}
          <Row k="Advertising Feature" v={<button className="linkbtn" onClick={() => nav('/feature-registry')}>Feature Registry</button>} />
        </Panel>
      </div>

      {/* Configuration action cards */}
      <div className="grid grid-cols-2 text-black mb-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginTop: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        {([
          ['🎨', 'Update Branding', 'Logo, colors & theme', () => setBrandingOpen(true)],
          ['⚙️', 'Change Default Settings', 'Update platform default values', () => setOpenGroup('global_defaults')],
          ['🌐', 'Configure Global Formatting', 'Set locale, date & time formats', () => setOpenGroup('localization')],
          ['📄', 'Manage Legal-Document Versions', 'Upload & manage legal docs', () => setLegalOpen(true)],
          ['🔧', 'Configure Maintenance Mode', 'Control maintenance settings', () => setMaintOpen(true)],
          ['🎯', 'Set Platform-Wide Defaults', 'Define tenant & branch defaults', () => setOpenGroup('global_defaults')],
        ] as [string, string, string, () => void][]).map(([ico, t, s, fn]) => (
          <button key={t} className="btn ghost" onClick={fn}><span className="ac-ico" aria-hidden>{ico}</span><span><span className="ac-t">{t}</span><div className="ac-s">{s}</div></span></button>
        ))}
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-3  gap-3 ">
        <section className="panel"><h2>Settings Changes (Last 7 Days)</h2>
          <AreaLine series={(series || []).map((d) => ({ label: d.date.slice(5), valueCents: d.count }))} emptyHint="No configuration changes yet — the chart populates as settings change." />
        </section>
        <section className="panel"><h2>Maintenance Events</h2>
          <MiniBars data={maintByMonth(maintHistory)} emptyHint="No maintenance events yet." />
        </section>
        <section className="panel"><h2>Localization Distribution</h2>
          {localeDist?.available
            ? <><Donut data={localeDist.items.slice(0, 6).map((it: any) => ({ label: it.label, value: it.count }))} centerLabel={`${localeDist.items.length}`} />
              <div className="gs-legend">{localeDist.items.slice(0, 4).map((it: any) => <div className="row" key={it.locale}><span>{it.label}</span><span>{it.count}</span></div>)}</div></>
            : <NotConnected>Per-tenant locale distribution isn’t available yet — it populates as tenants set a locale.</NotConnected>}
        </section>
        <section className="panel"><h2>Document Acceptance Status</h2>
          {acceptance?.available
            ? <><Donut data={[{ label: 'Accepted', value: acceptance.accepted }, { label: 'Pending', value: acceptance.pending }, { label: 'Declined', value: acceptance.declined }]} centerLabel={acceptance.total ? `${Math.round((acceptance.accepted / acceptance.total) * 100)}%` : '0%'} />
              <div className="gs-legend"><div className="row"><span>Accepted</span><span>{acceptance.accepted}</span></div><div className="row"><span>Pending</span><span>{acceptance.pending}</span></div><div className="row"><span>Declined</span><span>{acceptance.declined}</span></div></div></>
            : <NotConnected>No published required document yet.</NotConnected>}
        </section>
        <section className="panel"><h2>Default Setting Adoption Rate</h2>
          {adoption?.available
            ? <><Donut data={[{ label: 'On Defaults', value: adoption.onDefaults }, { label: 'Customized', value: adoption.customized }]} centerLabel={`${adoption.rate}%`} />
              <div className="gs-legend"><div className="row mb-3"><span>On Defaults</span><span>{adoption.onDefaults}</span></div><div className="row"><span>Customized</span><span>{adoption.customized}</span></div></div></>
            : <NotConnected>Adoption populates once tenants exist — it compares tenants on platform defaults vs. those that have customized.</NotConnected>}
        </section>
      </div>

      {/* Lower data tables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-3  gap-3 ">
        <section className="panel"><h2>Recent Configuration Changes</h2>
          {recentChanges === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
            : recentChanges.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No configuration changes recorded yet.</div>
              : <table className="tbl-mini"><thead><tr><th>Setting</th><th>Changed By</th><th>Date</th><th>Change</th></tr></thead><tbody>{recentChanges.slice(0, 6).map((r, i) => (
                <tr key={i}><td>{r.settingKey?.split('.').pop()}</td><td className="muted">{r.actor || 'Super Admin'}</td><td className="muted">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td><td className="muted">{String(r.previousValue ?? '—')} → {String(r.newValue ?? '—')}</td></tr>
              ))}</tbody></table>}
        </section>
        <section className="panel"><h2>Legal Document Version History</h2>
          {legalHistory === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
            : legalHistory.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No legal document versions yet.</div>
              : <table className="tbl-mini"><thead><tr><th>Document</th><th>Version</th><th>Published</th><th>By</th></tr></thead><tbody>{legalHistory.slice(0, 6).map((r) => (
                <tr key={r.id}><td>{r.label}</td><td>{r.version}</td><td className="muted">{r.publishedOn ? new Date(r.publishedOn).toLocaleDateString() : statusLabel(r.status)}</td><td className="muted">{r.publishedBy || '—'}</td></tr>
              ))}</tbody></table>}
        </section>
        <section className="panel"><div className="phd"><h2>Default Tenant Presets</h2><button className="btn ghost sm" onClick={() => setPresetsOpen(true)}>Manage</button></div>
          {presetRows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
            : presetRows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No presets yet — use Manage to create tenant/branch/onboarding defaults.</div>
              : <table className="tbl-mini"><thead><tr><th>Preset</th><th>Scope</th><th>Settings</th><th>Default</th></tr></thead><tbody>{presetRows.slice(0, 6).map((r) => (
                <tr key={r.id}><td>{r.name}</td><td className="muted">{r.scopeLabel.replace('Default ', '').replace(' Settings', '').replace(' Prefs.', '')}</td><td className="muted">{r.count}</td><td>{r.isDefault ? <span className="pill ok">Default</span> : <span className="muted">—</span>}</td></tr>
              ))}</tbody></table>}
        </section>
        <section className="panel"><h2>Scheduled Maintenance History</h2>
          {maintHistory === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
            : maintHistory.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No maintenance history yet.</div>
              : <table className="tbl-mini"><thead><tr><th>Date</th><th>Duration</th><th>Reason</th><th>Status</th></tr></thead><tbody>{maintHistory.slice(0, 6).map((r) => (
                <tr key={r.id}><td className="muted">{r.startsAt ? new Date(r.startsAt).toLocaleDateString() : '—'}</td><td className="muted">{r.duration}</td><td>{r.reason}</td><td><span className={'pill ' + (r.status === 'completed' ? 'ok' : r.status === 'cancelled' || r.status === 'failed' ? 'warn' : '')}>{statusLabel(r.status)}</span></td></tr>
              ))}</tbody></table>}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel mb-3  "  style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginTop: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <h2>Quick Actions</h2>
        <div className="grid sm:grid-cols-2 grid-cols-1 text-black mb-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <button className="btn ghost" disabled={opBusy === 'cache_clear'} onClick={() => runOp('cache_clear')}><span className="qa-ico" aria-hidden>🧹</span>{opBusy === 'cache_clear' ? 'Working…' : 'Clear Platform Cache'}</button>
          <button className="btn ghost" onClick={() => { setResetText(''); setResetOpen(true); }}><span className="qa-ico" aria-hidden>↺</span>Reset to Default Settings</button>
          <button className="btn ghost" disabled={opBusy === 'search_reindex'} onClick={() => runOp('search_reindex')}><span className="qa-ico" aria-hidden>🔎</span>{opBusy === 'search_reindex' ? 'Working…' : 'Rebuild Search Index'}</button>
          <button className="btn ghost" onClick={exportSettings}><span className="qa-ico" aria-hidden>⬇️</span>Export All Settings</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}><span className="qa-ico" aria-hidden>⬆️</span>Import Settings</button>
          <button className="btn ghost" onClick={() => nav('/audit-logs')}><span className="qa-ico" aria-hidden>📋</span>View Audit Logs</button>
          <button className="btn ghost" disabled={opBusy === 'email_test'} onClick={() => runOp('email_test')}><span className="qa-ico" aria-hidden>✉️</span>{opBusy === 'email_test' ? 'Working…' : 'Test Email Settings'}</button>
          <button className="btn ghost" disabled={healthBusy} onClick={checkHealth}><span className="qa-ico" aria-hidden>❤️</span>{healthBusy ? 'Checking…' : 'System Health Check'}</button>
        </div>
      </section>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />

      {health && (
        <div className="modal" onClick={() => setHealth(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="System Health">
            <div className="phead"><h2>System Health</h2><button className="linkbtn" onClick={() => setHealth(null)}>Close</button></div>
            {health.error ? <div className="muted" style={{ fontSize: 12.5 }}>{health.error}</div>
              : <div style={{ fontSize: 12.5 }}>
                <Row first k="Overall" v={health.ok === false ? 'Degraded' : 'Healthy'} />
                <Row k="Database" v={health.database ? (health.database.ok ? `OK${health.database.latencyMs != null ? ` · ${health.database.latencyMs}ms` : ''}` : 'Error') : '—'} />
                {health.database?.counts ? <Row k="Tenants / Users" v={`${health.database.counts.tenants} / ${health.database.counts.users}`} /> : null}
                {health.process ? <Row k="Environment" v={`${health.process.env} · node ${health.process.node}`} /> : null}
              </div>}
          </div>
        </div>
      )}

      {resetOpen && (
        <div className="modal" onClick={() => opBusy !== 'reset' && setResetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reset to defaults">
            <div className="phead"><h2>Reset all settings to defaults</h2><button className="linkbtn" onClick={() => opBusy !== 'reset' && setResetOpen(false)}>Close</button></div>
            <p className="muted" style={{ fontSize: 12.5 }}>This reverts every platform setting to its built-in default. The reversal is recorded in change history and audited. Type <b>RESET</b> to confirm.</p>
            <input className="inp" style={{ width: '100%', marginTop: 6 }} value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="RESET" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn ghost" disabled={opBusy === 'reset'} onClick={() => setResetOpen(false)}>Cancel</button>
              <button className="btn" disabled={resetText !== 'RESET' || opBusy === 'reset'} onClick={doReset}>{opBusy === 'reset' ? 'Resetting…' : 'Reset to defaults'}</button>
            </div>
          </div>
        </div>
      )}

      {openGroup && (EDITABLE.has(openGroup)
        ? <EditDrawer group={openGroup} settings={gs(openGroup)} pending={pending} onStage={stageEdits} onClose={() => setOpenGroup(null)} />
        : <ReadOnlyDrawer group={openGroup} settings={gs(openGroup)} onClose={() => setOpenGroup(null)} />)}

      {legalOpen && <LegalDrawer onClose={() => setLegalOpen(false)} onChanged={loadLegal} />}
      {maintOpen && <MaintenanceDrawer state={maint} onClose={() => setMaintOpen(false)} onChanged={loadMaint} />}
      {bizOpen && <BizCatDrawer onClose={() => setBizOpen(false)} onChanged={loadBiz} />}
      {presetsOpen && <PresetsDrawer onClose={() => setPresetsOpen(false)} onChanged={loadPresets} />}
      {brandingOpen && <BrandingDrawer branding={branding} onClose={() => setBrandingOpen(false)} onChanged={loadBranding} />}

      {confirmSave && (
        <div className="modal" onClick={() => !saving && setConfirmSave(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Review changes">
            <div className="phead"><h2>Review changes</h2><button className="linkbtn" onClick={() => !saving && setConfirmSave(false)}>Close</button></div>
            <p className="muted" style={{ fontSize: 12.5 }}>These platform-wide changes apply as defaults for all tenants/branches without an override. Each is versioned and audited.</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', margin: '8px 0' }}>
              {Object.values(pending).map((p) => (
                <div key={p.key} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600 }}>{p.label} <span className="muted" style={{ fontWeight: 400 }}>· {GROUP_TITLE[p.group]}</span></div>
                  <div style={{ marginTop: 2 }}><span className="muted">{String(p.from ?? '—') || '—'}</span> → <b>{String(p.value ?? '—') || '—'}</b></div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" disabled={saving} onClick={() => setConfirmSave(false)}>Cancel</button>
              <button className="btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : `Save ${Object.keys(pending).length} change${Object.keys(pending).length === 1 ? '' : 's'}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editable group drawer ───────────────────────────────────────────────────
function EditDrawer({ group, settings, pending, onStage, onClose }: { group: string; settings: Setting[]; pending: Pending; onStage: (g: string, e: Record<string, unknown>) => void; onClose: () => void }) {
  const seed = () => Object.fromEntries(settings.map((s) => [s.key, s.key in pending ? pending[s.key].value : s.value]));
  const [edited, setEdited] = useState<Record<string, unknown>>(seed);
  const set = (k: string, v: unknown) => setEdited((p) => ({ ...p, [k]: v }));

  const errors = useMemo(() => { const e: Record<string, string | null> = {}; for (const s of settings) e[s.key] = validate(s.valueType, edited[s.key]); return e; }, [edited, settings]);
  const hasError = Object.values(errors).some(Boolean);
  const dirty = settings.some((s) => JSON.stringify(edited[s.key] ?? null) !== JSON.stringify(s.value ?? null));

  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const apply = () => { onStage(group, edited); onClose(); };
  const close = () => {
    if (!dirty) { onClose(); return; }
    askConfirm('Discard your edits to this section? (They have not been staged.)', () => onClose(), { confirmLabel: 'Discard edits' });
  };

  const isLoc = group === 'localization';
  const locVals = isLoc ? {
    lang: String(edited['localization.default_language'] ?? 'en-US'), cur: String(edited['localization.default_currency'] ?? 'USD'),
    tz: String(edited['localization.default_timezone'] ?? 'UTC'), date: String(edited['localization.date_format'] ?? 'MMM dd, yyyy'),
    time: String(edited['localization.time_format'] ?? '12h'), num: String(edited['localization.number_format'] ?? '1,234.56'),
  } : null;

  return (
    <div className="drawer-wrap " onClick={close}>
      <div className="drawer p-4 rounded-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={GROUP_TITLE[group]}>
        {confirmUi}
        <div className="dhd flex justify-between"><h2 className='font-semibold text-base'>Edit {GROUP_TITLE[group]}</h2><button className="linkbtn" onClick={close}>Close</button></div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {settings.map((s) => (
            <label key={s.key} className="block my-2.5">
              <div className="text-xs font-semibold mb-[5px]">
                {s.label}
                {s.mandatory ? (
                  <span className="muted font-normal">
                    {' '}· platform-wide
                  </span>
                ) : null}
              </div>

              <Field
              
                s={s}
                value={edited[s.key]}
                onChange={(v) => set(s.key, v)}
               
              />

              {errors[s.key] ? (
                <div className="text-[11px] mt-[3px] text-[var(--danger,#B85B4D)]">
                  {errors[s.key]}
                </div>
              ) : null}
            </label>
          ))}
        </div>

        {isLoc && locVals && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg,#faf9f7)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Live Preview</div>
            <Row first k="Date" v={previewDate(locVals.date, locVals.tz)} />
            <Row k="Time" v={previewTime(locVals.time, locVals.tz)} />
            <Row k="Currency" v={previewCurrency(locVals.cur, locVals.lang)} />
            <Row k="Number" v={previewNumber(locVals.num)} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn" disabled={hasError || !dirty} onClick={apply}>Stage changes</button>
        </div>
      </div>
    </div>
  );
}

function Field({ s, value, onChange }: { s: Setting; value: unknown; onChange: (v: unknown) => void }) {
  const opts = (list: (string | [string, string])[]) => list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; });
  if (s.valueType === 'boolean') return <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {value ? 'On' : 'Off'}</label>;
  if (s.key === 'sms.review_request_price_cents') return <input className="inp" style={{ width: '100%' }} type="number" min={0} max={1000} step={1} placeholder="Not set" aria-label={s.label} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
  if (s.valueType === 'number') return <input className="inp" style={{ width: '100%' }} type="number" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
  if (s.key === 'localization.default_language') return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(LOCALES)}</select>;
  if (s.key === 'localization.default_currency') return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(CURRENCIES)}</select>;
  if (s.key === 'localization.default_timezone') { const list = TIMEZONES.includes(String(value)) ? TIMEZONES : [String(value), ...TIMEZONES]; return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(list)}</select>; }
  if (s.key === 'localization.date_format') return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(DATE_FORMATS)}</select>;
  if (s.key === 'localization.time_format') return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(TIME_FORMATS)}</select>;
  if (s.key === 'localization.number_format') return <select className="inp" style={{ width: '100%' }} value={String(value)} onChange={(e) => onChange(e.target.value)}>{opts(NUMBER_FORMATS)}</select>;
  return <input className="inp" style={{ width: '100%' }} type={s.valueType === 'email' ? 'email' : s.valueType === 'url' ? 'url' : 'text'} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />;
}

// ── Read-only drawer (non-editable groups) ──────────────────────────────────
function ReadOnlyDrawer({ group, settings, onClose }: { group: string; settings: Setting[]; onClose: () => void }) {
  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={GROUP_TITLE[group]}>
        <div className="dhd"><h2>{GROUP_TITLE[group]}</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {settings.length === 0
          ? <div className="muted" style={{ fontSize: 12.5 }}>This module isn’t configured yet. A dedicated editor is being built for it in an upcoming unit.</div>
          : settings.map((s) => (
            <div key={s.key} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</div>
                <span className="srcbadge">{s.mandatory ? 'Mandatory' : s.isExplicitlySet ? `Set · v${s.version}` : 'Platform Default'}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2, wordBreak: 'break-word' }}>{fmtVal(s)}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Legal Documents manager ─────────────────────────────────────────────────
const LEGAL_TYPES: [string, string][] = [['terms_of_service', 'Terms of Service'], ['privacy_policy', 'Privacy Policy'], ['cookie_policy', 'Cookie Policy'], ['acceptable_use', 'Acceptable Use Policy'], ['data_processing_addendum', 'Data Processing Addendum'], ['merchant_terms', 'Merchant Terms'], ['ai_disclosure', 'AI Usage Disclosure']];

function LegalDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ docType: 'terms_of_service', version: '', title: '', content: '', requiredAcceptance: true });
  const [confirm, setConfirm] = useState<{ action: 'publish' | 'retire'; id: string; label: string } | null>(null);

  const reload = () => { superAdminApi.legalDocHistory(100).then(setRows).catch(() => setRows([])); };
  useEffect(reload, []);

  const versionErr = form.version && !/^v\d+\.\d+(\.\d+)?$/.test(form.version) ? 'Version must look like v2.3.0' : null;

  const create = async () => {
    setBusy('create'); setErr(null);
    try { await superAdminApi.legalDocCreate({ docType: form.docType, version: form.version, title: form.title || undefined, content: form.content || undefined, requiredAcceptance: form.requiredAcceptance }); setForm({ ...form, version: '', title: '', content: '' }); reload(); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Could not create draft.'); } finally { setBusy(null); }
  };
  const act = async () => {
    if (!confirm) return;
    setBusy(confirm.action); setErr(null);
    try { if (confirm.action === 'publish') await superAdminApi.legalDocPublish(confirm.id); else await superAdminApi.legalDocRetire(confirm.id); setConfirm(null); reload(); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Action failed.'); setConfirm(null); } finally { setBusy(null); }
  };

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Legal Documents">
        <div className="dhd"><h2>Legal Documents</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {err && <div className="infobanner" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>{err}</div>}

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>New document version</div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Document
            <select className="inp" style={{ width: '100%', marginTop: 3 }} value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>{LEGAL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Version
            <input className="inp" style={{ width: '100%', marginTop: 3 }} placeholder="v2.3.0" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            {versionErr && <div style={{ color: 'var(--danger,#B85B4D)', fontSize: 11 }}>{versionErr}</div>}
          </label>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Title
            <input className="inp" style={{ width: '100%', marginTop: 3 }} placeholder="(defaults to the document name)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Content
            <textarea className="inp" style={{ width: '100%', marginTop: 3, minHeight: 70 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 10 }}><input type="checkbox" checked={form.requiredAcceptance} onChange={(e) => setForm({ ...form, requiredAcceptance: e.target.checked })} /> Requires acceptance</label>
          <button className="btn" disabled={!form.version || !!versionErr || busy === 'create'} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create draft'}</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>All versions</div>
        {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No versions yet.</div>
            : rows.map((r) => (
              <div key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.label} · {r.version}</div><div className="muted" style={{ fontSize: 11 }}>{statusLabel(r.status)}{r.publishedOn ? ` · ${new Date(r.publishedOn).toLocaleDateString()}` : ''}</div></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(r.status === 'draft' || r.status === 'approved') && <button className="btn ghost sm" disabled={!!busy} onClick={() => setConfirm({ action: 'publish', id: r.id, label: `${r.label} ${r.version}` })}>Publish</button>}
                  {r.status === 'published' && <button className="btn ghost sm" disabled={!!busy} onClick={() => setConfirm({ action: 'retire', id: r.id, label: `${r.label} ${r.version}` })}>Retire</button>}
                </div>
              </div>
            ))}

        {confirm && (
          <div className="modal" onClick={() => !busy && setConfirm(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm legal action">
              <div className="phead"><h2>{confirm.action === 'publish' ? 'Publish document' : 'Retire document'}</h2><button className="linkbtn" onClick={() => !busy && setConfirm(null)}>Close</button></div>
              <p className="muted" style={{ fontSize: 12.5 }}>{confirm.action === 'publish' ? <>Publish <b>{confirm.label}</b>? It becomes the required version platform-wide. Existing acceptances stay tied to prior versions; users may need to re-accept.</> : <>Retire <b>{confirm.label}</b>? It will no longer be the active document.</>}</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn ghost" disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</button>
                <button className="btn" disabled={!!busy} onClick={act}>{busy ? 'Working…' : (confirm.action === 'publish' ? 'Publish' : 'Retire')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Maintenance & Messaging manager ─────────────────────────────────────────
function MaintenanceDrawer({ state, onClose, onChanged }: { state: any; onClose: () => void; onChanged: () => void }) {
  const [history, setHistory] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [enableForm, setEnableForm] = useState({ reason: '', mode: 'full', message: '', expectedRestoration: '' });
  const [banner, setBanner] = useState<string>(state?.announcementBanner || '');
  const [sched, setSched] = useState({ title: '', reason: '', startsAt: '', endsAt: '', mode: 'full' });
  const [confirm, setConfirm] = useState<null | 'enable' | 'disable'>(null);

  const reload = () => { superAdminApi.maintenanceHistory(50).then(setHistory).catch(() => setHistory([])); };
  useEffect(reload, []);

  const wrap = (key: string, fn: () => Promise<void>) => async () => { setBusy(key); setErr(null); try { await fn(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); } };
  const doEnable = wrap('enable', async () => { await superAdminApi.maintenanceEnable({ reason: enableForm.reason, mode: enableForm.mode, message: enableForm.message || undefined, expectedRestoration: enableForm.expectedRestoration ? new Date(enableForm.expectedRestoration).toISOString() : undefined }); setConfirm(null); onChanged(); reload(); });
  const doDisable = wrap('disable', async () => { await superAdminApi.maintenanceDisable(); setConfirm(null); onChanged(); reload(); });
  const doSchedule = wrap('sched', async () => { await superAdminApi.maintenanceSchedule({ title: sched.title || undefined, reason: sched.reason, startsAt: new Date(sched.startsAt).toISOString(), endsAt: new Date(sched.endsAt).toISOString(), mode: sched.mode }); setSched({ title: '', reason: '', startsAt: '', endsAt: '', mode: 'full' }); onChanged(); reload(); });
  const doBanner = wrap('banner', async () => { await superAdminApi.maintenanceBanner(banner); onChanged(); });
  const cancelEvent = (id: string) => wrap('cancel' + id, async () => { await superAdminApi.maintenanceCancel(id); onChanged(); reload(); })();

  const active = !!state?.active;
  const schedValid = sched.reason.trim() && sched.startsAt && sched.endsAt && new Date(sched.endsAt) > new Date(sched.startsAt) && new Date(sched.startsAt) > new Date();

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Maintenance & Messaging">
        <div className="dhd"><h2>Maintenance &amp; Messaging</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {err && <div className="infobanner" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>{err}</div>}

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Status</div>
            <span className={'pill ' + (active ? 'warn' : 'ok')}>{active ? (state.mode === 'read_only' ? 'ON · Read-only' : 'ON') : 'Live'}</span>
          </div>
          {active
            ? <>
                <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>{state.message || 'Maintenance is active.'} Super Admins retain access.</div>
                <button className="btn" disabled={!!busy} onClick={() => setConfirm('disable')}>Disable maintenance</button>
              </>
            : <>
                <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Enabling blocks non-admin access. Super Admins and the health check always retain access.</div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Reason (required)<input className="inp" style={{ width: '100%', marginTop: 3 }} value={enableForm.reason} onChange={(e) => setEnableForm({ ...enableForm, reason: e.target.value })} /></label>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Mode<select className="inp" style={{ width: '100%', marginTop: 3 }} value={enableForm.mode} onChange={(e) => setEnableForm({ ...enableForm, mode: e.target.value })}><option value="full">Full</option><option value="read_only">Read-only</option></select></label>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Public message<input className="inp" style={{ width: '100%', marginTop: 3 }} value={enableForm.message} onChange={(e) => setEnableForm({ ...enableForm, message: e.target.value })} /></label>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>Expected restoration<input className="inp" type="datetime-local" style={{ width: '100%', marginTop: 3 }} value={enableForm.expectedRestoration} onChange={(e) => setEnableForm({ ...enableForm, expectedRestoration: e.target.value })} /></label>
                <button className="btn" disabled={!enableForm.reason.trim() || !!busy} onClick={() => setConfirm('enable')}>Enable maintenance</button>
              </>}
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Announcement banner</div>
          <textarea className="inp" style={{ width: '100%', minHeight: 54 }} value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="Shown to all users (optional)" />
          <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={busy === 'banner'} onClick={doBanner}>{busy === 'banner' ? 'Saving…' : 'Save banner'}</button>
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Schedule maintenance</div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Title<input className="inp" style={{ width: '100%', marginTop: 3 }} value={sched.title} onChange={(e) => setSched({ ...sched, title: e.target.value })} placeholder="e.g. Database Upgrade" /></label>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Reason (required)<input className="inp" style={{ width: '100%', marginTop: 3 }} value={sched.reason} onChange={(e) => setSched({ ...sched, reason: e.target.value })} /></label>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Start<input className="inp" type="datetime-local" style={{ width: '100%', marginTop: 3 }} value={sched.startsAt} onChange={(e) => setSched({ ...sched, startsAt: e.target.value })} /></label>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>End<input className="inp" type="datetime-local" style={{ width: '100%', marginTop: 3 }} value={sched.endsAt} onChange={(e) => setSched({ ...sched, endsAt: e.target.value })} /></label>
          <button className="btn" disabled={!schedValid || busy === 'sched'} onClick={doSchedule}>{busy === 'sched' ? 'Scheduling…' : 'Schedule'}</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>History &amp; scheduled</div>
        {history === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          : history.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No maintenance events yet.</div>
            : history.map((h) => (
              <div key={h.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.reason}</div><div className="muted" style={{ fontSize: 11 }}>{h.startsAt ? new Date(h.startsAt).toLocaleString() : '—'} · {h.duration} · {statusLabel(h.status)}</div></div>
                {h.status === 'scheduled' && <button className="btn ghost sm" disabled={!!busy} onClick={() => cancelEvent(h.id)}>Cancel</button>}
              </div>
            ))}

        {confirm && (
          <div className="modal" onClick={() => !busy && setConfirm(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm maintenance">
              <div className="phead"><h2>{confirm === 'enable' ? 'Enable maintenance mode' : 'Disable maintenance mode'}</h2><button className="linkbtn" onClick={() => !busy && setConfirm(null)}>Close</button></div>
              <p className="muted" style={{ fontSize: 12.5 }}>{confirm === 'enable' ? <>This blocks non-admin access platform-wide{enableForm.mode === 'read_only' ? ' (read-only)' : ''}. Super Admins and the health check keep access. This is audited.</> : <>Bring the platform back online for all users?</>}</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn ghost" disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</button>
                <button className="btn" disabled={!!busy} onClick={confirm === 'enable' ? doEnable : doDisable}>{busy ? 'Working…' : (confirm === 'enable' ? 'Enable' : 'Disable')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Business Categories manager ─────────────────────────────────────────────
function BizCatDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const reload = () => { superAdminApi.bizCategories(true).then(setRows).catch(() => setRows([])); };
  useEffect(reload, []);

  const wrap = (key: string, fn: () => Promise<void>) => async () => { setBusy(key); setErr(null); try { await fn(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); } };
  const create = wrap('create', async () => { await superAdminApi.bizCatCreate({ name: form.name, description: form.description || undefined }); setForm({ name: '', description: '' }); onChanged(); reload(); });
  const saveRename = wrap('rename', async () => { if (!editing) return; await superAdminApi.bizCatRename(editing.id, editing.name); setEditing(null); onChanged(); reload(); });
  const toggle = (c: any) => wrap('t' + c.id, async () => { if (c.active) await superAdminApi.bizCatDeactivate(c.id); else await superAdminApi.bizCatActivate(c.id); onChanged(); reload(); })();
  const move = (idx: number, dir: number) => {
    if (!rows) return; const j = idx + dir; if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id); const [x] = ids.splice(idx, 1); ids.splice(j, 0, x);
    wrap('reorder', async () => { await superAdminApi.bizCatReorder(ids); onChanged(); reload(); })();
  };

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Business Categories">
        <div className="dhd"><h2>Business Categories</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {err && <div className="infobanner" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>{err}</div>}

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>New category</div>
          <input className="inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Name (e.g. Nail Salon)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="inp" style={{ width: '100%', marginBottom: 8 }} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="btn" disabled={form.name.trim().length < 2 || busy === 'create'} onClick={create}>{busy === 'create' ? 'Creating…' : 'Add category'}</button>
        </div>

        {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No categories yet — add the business types tenants can be classified under.</div>
            : rows.map((c, i) => (
              <div key={c.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button className="linkbtn" title="Move up" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} style={{ lineHeight: 1, padding: 0, fontSize: 11 }}>▲</button>
                  <button className="linkbtn" title="Move down" disabled={i === rows.length - 1 || !!busy} onClick={() => move(i, 1)} style={{ lineHeight: 1, padding: 0, fontSize: 11 }}>▼</button>
                </div>
                <div style={{ flex: 1 }}>
                  {editing?.id === c.id
                    ? <div style={{ display: 'flex', gap: 6 }}><input className="inp" style={{ flex: 1 }} value={editing?.name ?? ''} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} /><button className="btn sm" disabled={busy === 'rename'} onClick={saveRename}>Save</button><button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button></div>
                    : <><span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</span>{c.description ? <div className="muted" style={{ fontSize: 11 }}>{c.description}</div> : null}</>}
                </div>
                {editing?.id === c.id ? null : <>
                  <span className={'pill ' + (c.active ? 'ok' : 'warn')}>{c.active ? 'Active' : 'Inactive'}</span>
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
                </>}
              </div>
            ))}
      </div>
    </div>
  );
}

// ── Tenant Presets manager ──────────────────────────────────────────────────
const PRESET_SCOPES: [string, string][] = [['tenant', 'Tenant defaults'], ['branch', 'Branch defaults'], ['onboarding', 'Onboarding prefs']];

function PresetsDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', scope: 'tenant', description: '', settings: '', makeDefault: false });

  const reload = () => { superAdminApi.tenantPresets().then(setRows).catch(() => setRows([])); };
  useEffect(reload, []);

  const settingsErr = form.settings.trim() ? (() => { try { const p = JSON.parse(form.settings); return p && typeof p === 'object' && !Array.isArray(p) ? null : 'Settings must be a JSON object'; } catch { return 'Settings must be valid JSON'; } })() : null;

  const wrap = (key: string, fn: () => Promise<void>) => async () => { setBusy(key); setErr(null); try { await fn(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); } };
  const create = wrap('create', async () => {
    const settings = form.settings.trim() ? JSON.parse(form.settings) : undefined;
    await superAdminApi.tenantPresetCreate({ name: form.name, scope: form.scope, description: form.description || undefined, settings, makeDefault: form.makeDefault });
    setForm({ name: '', scope: 'tenant', description: '', settings: '', makeDefault: false }); onChanged(); reload();
  });
  const makeDefault = (id: string) => wrap('d' + id, async () => { await superAdminApi.tenantPresetMakeDefault(id); onChanged(); reload(); })();

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tenant Presets">
        <div className="dhd"><h2>Tenant Presets</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {err && <div className="infobanner" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>{err}</div>}

        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>New preset</div>
          <input className="inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Name (e.g. Standard Salon)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="inp" style={{ width: '100%', marginBottom: 6 }} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>{PRESET_SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input className="inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="inp" style={{ width: '100%', minHeight: 64, fontFamily: 'monospace', fontSize: 11 }} placeholder='Settings JSON (optional), e.g. { "trialDays": 14 }' value={form.settings} onChange={(e) => setForm({ ...form, settings: e.target.value })} />
          {settingsErr && <div style={{ color: 'var(--danger,#B85B4D)', fontSize: 11 }}>{settingsErr}</div>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, margin: '8px 0' }}><input type="checkbox" checked={form.makeDefault} onChange={(e) => setForm({ ...form, makeDefault: e.target.checked })} /> Make default for this scope</label>
          <button className="btn" disabled={form.name.trim().length < 2 || !!settingsErr || busy === 'create'} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create preset'}</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>All presets</div>
        {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No presets yet.</div>
            : rows.map((p) => (
              <div key={p.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name} {p.isDefault ? <span className="pill ok" style={{ marginLeft: 4 }}>Default</span> : null}</div><div className="muted" style={{ fontSize: 11 }}>{p.scopeLabel} · {p.count} setting{p.count === 1 ? '' : 's'}</div></div>
                {!p.isDefault && <button className="btn ghost sm" disabled={!!busy} onClick={() => makeDefault(p.id)}>Make default</button>}
              </div>
            ))}
      </div>
    </div>
  );
}

// ── Platform Branding manager (colors + tagline; the logo is a locked brand asset) ──
const BRAND_COLORS: [string, string][] = [['primary_color', 'Primary'], ['secondary_color', 'Secondary'], ['accent_color', 'Accent'], ['surface_color', 'Surface'], ['text_color', 'Text']];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function BrandingDrawer({ branding, onClose, onChanged }: { branding: any; onClose: () => void; onChanged: () => void }) {
  const seed = () => ({ tagline: branding?.tagline || '', primary_color: branding?.primary_color || '#000000', secondary_color: branding?.secondary_color || '#000000', accent_color: branding?.accent_color || '#000000', surface_color: branding?.surface_color || '#FFFFFF', text_color: branding?.text_color || '#000000' });
  const [edited, setEdited] = useState<Record<string, string>>(seed);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const set = (k: string, v: string) => setEdited((p) => ({ ...p, [k]: v }));

  const colorErrs = BRAND_COLORS.filter(([k]) => !HEX_RE.test(edited[k])).map(([, l]) => l);
  const dirty = !branding ? false : (['tagline', ...BRAND_COLORS.map(([k]) => k)]).some((k) => String(edited[k]) !== String(branding[k] ?? ''));

  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      const patch: Record<string, string> = {};
      for (const k of ['tagline', ...BRAND_COLORS.map(([c]) => c)]) if (String(edited[k]) !== String(branding?.[k] ?? '')) patch[k] = edited[k];
      if (Object.keys(patch).length) await superAdminApi.brandingUpdate(patch);
      onChanged(); onClose();
    } catch (e: any) { setErr(e?.message || 'Could not save branding.'); } finally { setBusy(null); }
  };
  const restore = async () => { setBusy('restore'); setErr(null); try { await superAdminApi.brandingRestore(); setConfirmRestore(false); onChanged(); onClose(); } catch (e: any) { setErr(e?.message || 'Restore failed.'); setConfirmRestore(false); } finally { setBusy(null); } };

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Platform Branding">
        <div className="dhd"><h2>Platform Branding</h2><button className="linkbtn" onClick={onClose}>Close</button></div>
        {err && <div className="infobanner" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>{err}</div>}
        {!branding ? <div className="muted" style={{ fontSize: 12.5 }}>Branding is unavailable right now.</div> : <>
          <label style={{ display: 'block', margin: '10px 0' }}><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Tagline</div>
            <input className="inp" style={{ width: '100%' }} value={edited.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={80} /></label>

          {BRAND_COLORS.map(([k, label]) => (
            <label key={k} style={{ display: 'block', margin: '10px 0' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{label}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={HEX_RE.test(edited[k]) ? edited[k] : '#000000'} onChange={(e) => set(k, e.target.value.toUpperCase())} style={{ width: 34, height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: 0, background: 'none' }} aria-label={`${label} color`} />
                <input className="inp" style={{ flex: 1 }} value={edited[k]} onChange={(e) => set(k, e.target.value)} />
              </div>
            </label>
          ))}
          {colorErrs.length ? <div style={{ color: 'var(--danger,#B85B4D)', fontSize: 11 }}>Enter a valid #RRGGBB color for: {colorErrs.join(', ')}.</div> : null}

          <div className="panel" style={{ margin: '12px 0', background: 'var(--bg,#faf9f7)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Logo <span className="srcbadge" style={{ marginLeft: 4 }}>Locked</span></div>
            <div className="muted" style={{ fontSize: 11.5 }}>The official AI PowerSalon logo is a protected brand asset and can’t be replaced here.</div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn ghost sm" disabled={!!busy} onClick={() => setConfirmRestore(true)}>Restore defaults</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={!dirty || colorErrs.length > 0 || busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save branding'}</button>
            </div>
          </div>
        </>}

        {confirmRestore && (
          <div className="modal" onClick={() => !busy && setConfirmRestore(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Restore branding">
              <div className="phead"><h2>Restore default branding</h2><button className="linkbtn" onClick={() => !busy && setConfirmRestore(false)}>Close</button></div>
              <p className="muted" style={{ fontSize: 12.5 }}>Revert colors and tagline to the AI PowerSalon defaults? This is audited.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn ghost" disabled={!!busy} onClick={() => setConfirmRestore(false)}>Cancel</button>
                <button className="btn" disabled={!!busy} onClick={restore}>{busy === 'restore' ? 'Restoring…' : 'Restore'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
