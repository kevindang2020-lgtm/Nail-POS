// CommunicationsOverviewScreen.tsx — Super Admin → Business Management → Communications. Platform messaging-oversight
// dashboard wired to GET /super-admin/communications/overview (real data; honest "Not tracked" where a source isn't
// modelled yet). Full-screen layout + brand cream/gold design tokens; live background refresh; loading / empty / error / stale states.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSend,
  FiFileText,
  FiSliders,
  FiServer,
  FiAlertTriangle,
  FiShield,
  FiUserCheck,
  FiSlash,
  FiDownload,
  FiInbox,
} from 'react-icons/fi';
import {
  superAdminCommunicationsApi,
  type CommOverview,
  type CommKpi,
  type CommSegment,
  type CreateAnnouncementResult,
  type TenantLimitResult,
  type TemplateListItem,
  type CommProviderItem,
} from '../api/superAdminCommunicationsApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const ELIGIBLE_ROLES = ['OWNER', 'MANAGER', 'RECEPTION', 'TECHNICIAN'];

const REFRESH_MS = 25_000;
const ORANGE = '#E07B39';
const LINE = 'var(--line, #E9DAC4)';
const TEXT = 'var(--text, #2C2118)';
const MUTED = 'var(--muted, #9B8B78)';
const SEM: Record<string, string> = { good: '#3E8F57', warn: '#C08A2E', bad: '#D14343', neutral: '#6B7280' };
const CHAN_COLOR: Record<string, string> = {
  sms: '#3B82F6',
  email: ORANGE,
  push: '#3E8F57',
  in_app: '#8B5CF6',
  system_alert: '#D14343',
  tenant_notice: '#0E7490',
  support: '#B45309',
  other: '#9CA3AF',
};
const HEALTH_COLOR: Record<string, string> = { healthy: '#3E8F57', degraded: '#C08A2E', down: '#D14343' };

const cardStyle: React.CSSProperties = {
  background: 'var(--card, #FFFCF6)',
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)',
};

const fmt = (n: number) => n.toLocaleString();

function Dot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />;
}

function KpiCard({ k }: { k: CommKpi }) {
  const tint = k.available ? (SEM[k.semantic] || MUTED) : '#9B8B78';
  return (
    <div
      className="kpi"
      style={{
        ...cardStyle,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        cursor: 'default',
      }}
      tabIndex={0}
      aria-label={`${k.label}: ${k.available ? k.display : 'Not tracked'}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {k.label}
        </span>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: `${tint}18`,
            border: `1px solid ${tint}30`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Dot color={tint} />
        </span>
      </div>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 22,
          fontWeight: 700,
          color: k.available ? TEXT : '#B8AE9E',
          margin: '2px 0',
          lineHeight: 1.2,
        }}
      >
        {k.available ? k.display : 'Not tracked'}
      </div>
      {k.available ? (
        k.direction === 'flat' && k.deltaPct === 0 ? (
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>—</div>
        ) : (
          <div style={{ fontSize: 11, color: SEM[k.semantic] || MUTED, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{k.direction === 'up' ? '▲' : k.direction === 'down' ? '▼' : ''}</span>
            <span>{Math.abs(k.deltaPct)}% vs prior</span>
          </div>
        )
      ) : (
        <div style={{ fontSize: 11, color: '#B8AE9E' }}>No source modelled yet</div>
      )}
    </div>
  );
}

function Donut({ segments, total, centerLabel, colorFor }: { segments: CommSegment[]; total: number; centerLabel: string; colorFor: (k: string) => string }) {
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.filter((s) => s.count > 0).map((s) => {
    const frac = total > 0 ? s.count / total : 0;
    const dash = frac * C;
    const el = { s, dashArray: `${dash} ${C - dash}`, offset: -acc * C, color: colorFor(s.key) };
    acc += frac;
    return el;
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={`${centerLabel}: ${total}`} style={{ flexShrink: 0 }}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line, #E9DAC4)" strokeWidth="16" />
        {arcs.map((a, i) => (
          <circle key={i} cx="64" cy="64" r={R} fill="none" stroke={a.color} strokeWidth="16" strokeDasharray={a.dashArray} strokeDashoffset={a.offset} transform="rotate(-90 64 64)" />
        ))}
        <text x="64" y="60" textAnchor="middle" fontFamily="'Playfair Display', serif" fontSize="20" fontWeight="700" fill={TEXT}>{fmt(total)}</text>
        <text x="64" y="76" textAnchor="middle" fontSize="10.5" fill={MUTED} fontWeight="600">{centerLabel}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, flex: 1, minWidth: 0 }}>
        {segments.length === 0 ? <span style={{ color: MUTED }}>No data yet</span> : segments.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot color={colorFor(s.key)} />
            <span style={{ color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
            <span style={{ color: MUTED, marginLeft: 'auto', fontWeight: 600, flexShrink: 0 }}>{fmt(s.count)} · {s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ days }: { days: CommOverview['volumeTrend'] }) {
  const W = 520, H = 160, pad = 26;
  const series: { key: keyof CommOverview['volumeTrend'][number]; color: string; label: string }[] = [
    { key: 'sent', color: '#3B82F6', label: 'SMS' },
    { key: 'delivered', color: ORANGE, label: 'Email' },
    { key: 'failed', color: '#3E8F57', label: 'Push' },
    { key: 'suppressed', color: '#8B5CF6', label: 'In-App' },
  ];
  const max = Math.max(1, ...days.flatMap((d) => [d.sent, d.delivered, d.failed, d.suppressed]));
  const x = (i: number) => pad + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  if (days.length === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>No volume in this period.</div>;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Messaging volume trend">
        {[0, 0.33, 0.66, 1].map((p) => {
          const gy = H - pad - p * (H - 2 * pad);
          return <line key={p} x1={pad} x2={W - pad} y1={gy} y2={gy} stroke="var(--line, #E9DAC4)" strokeDasharray="3 3" opacity={0.6} />;
        })}
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={days.map((d, i) => `${x(i)},${y(d[s.key] as number)}`).join(' ')} />
        ))}
        {days.map((d, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>{d.day.slice(5)}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 11, color: MUTED }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ days }: { days: CommOverview['deliveryPerformance'] }) {
  const W = 520, H = 160, pad = 26;
  const max = Math.max(1, ...days.map((d) => d.delivered + d.failed + d.suppressed));
  const groupW = days.length ? (W - 2 * pad) / days.length : 0;
  if (days.length === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>No delivery events in this period.</div>;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Delivery performance">
        {[0, 0.33, 0.66, 1].map((p) => {
          const gy = H - pad - p * (H - 2 * pad);
          return <line key={p} x1={pad} x2={W - pad} y1={gy} y2={gy} stroke="var(--line, #E9DAC4)" strokeDasharray="3 3" opacity={0.6} />;
        })}
        {days.map((d, i) => {
          const bw = Math.min(10, groupW / 4);
          const gx = pad + i * groupW + groupW / 2;
          const bars = [{ v: d.delivered, c: '#3E8F57' }, { v: d.failed, c: '#D14343' }, { v: d.suppressed, c: ORANGE }];
          return bars.map((b, j) => {
            const bh = (b.v / max) * (H - 2 * pad);
            return <rect key={`${i}-${j}`} x={gx - bw * 1.5 + j * bw} y={H - pad - bh} width={bw - 1} height={bh} fill={b.c} rx={2} />;
          });
        })}
        {days.map((d, i) => (
          <text key={i} x={pad + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>{d.day.slice(5)}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 11, color: MUTED }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#3E8F57' }} /><span>Delivered</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#D14343' }} /><span>Failed</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: ORANGE }} /><span>Suppressed</span></div>
      </div>
    </div>
  );
}

const CONTROL_ICONS: Record<string, React.ReactNode> = {
  'Send Platform Announcements': <FiSend size={18} />,
  'Manage Message Templates': <FiFileText size={18} />,
  'Configure Sender Information': <FiSliders size={18} />,
  'Configure Communication Providers': <FiServer size={18} />,
  'Review Delivery Failures': <FiAlertTriangle size={18} />,
  'Set Tenant Usage Limits': <FiShield size={18} />,
  'Review Opt-Out Compliance': <FiUserCheck size={18} />,
  'Block Abusive Usage': <FiSlash size={18} />,
  'Export Communication Reports': <FiDownload size={18} />,
};

function ControlCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  const icon = CONTROL_ICONS[title] || <FiSend size={18} />;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: '#FFFDF8',
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: '12px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        minHeight: 76,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
        e.currentTarget.style.boxShadow = '0 6px 18px rgba(169, 111, 34, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = LINE;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(242, 216, 146, 0.35), rgba(215, 166, 70, 0.18))',
          border: '1px solid #E2C686',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8B5A18',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: TEXT, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.35 }}>{desc}</div>
      </div>
    </button>
  );
}

const PLATFORM_CONTROLS = [
  { title: 'Send Platform Announcements', desc: 'Broadcast updates to all or selected tenants.' },
  { title: 'Manage Message Templates', desc: 'Create and maintain reusable SMS, email, and push templates.' },
  { title: 'Configure Sender Information', desc: 'Control sender IDs, email identities, and branded sender settings.' },
  { title: 'Configure Communication Providers', desc: 'Manage SMS, email, and push delivery providers.' },
];
const TENANT_CONTROLS = [
  { title: 'Review Delivery Failures', desc: 'Investigate failed and suppressed sends.' },
  { title: 'Set Tenant Usage Limits', desc: 'Apply messaging limits by plan and usage policy.' },
  { title: 'Review Opt-Out Compliance', desc: 'Audit opt-out handling and suppression lists.' },
  { title: 'Block Abusive Usage', desc: 'Pause or block tenants with abusive messaging behavior.' },
  { title: 'Export Communication Reports', desc: 'Download cross-tenant messaging reports.' },
];
const QUICK_ACTIONS = [
  'Send Platform Announcement',
  'Review Delivery Failures',
  'Manage Message Templates',
  'Configure Sender Info',
  'Configure Providers',
  'Set Tenant Usage Limits',
  'Review Opt-Out Compliance',
  'Block Abusive Usage',
  'Export Communication Reports',
];

export function CommunicationsOverviewScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<CommOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [annOpen, setAnnOpen] = useState(false);
  const [ann, setAnn] = useState({ title: '', subject: '', body: '', channel: 'in_app', priority: 'normal', roles: [] as string[], scheduledAt: '' });
  const [annKey, setAnnKey] = useState('');
  const [annBusy, setAnnBusy] = useState(false);
  const [annErr, setAnnErr] = useState<string | null>(null);
  const [annResult, setAnnResult] = useState<CreateAnnouncementResult | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitTenant, setLimitTenant] = useState('');
  const [limitFields, setLimitFields] = useState({ monthlySms: '', monthlyEmail: '', monthlyPush: '', dailyLimit: '', enforcement: 'soft', optOutRateThresholdBps: '' });
  const [limitCurrent, setLimitCurrent] = useState<TenantLimitResult | null>(null);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitErr, setLimitErr] = useState<string | null>(null);
  const [limitSaved, setLimitSaved] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplList, setTplList] = useState<TemplateListItem[]>([]);
  const [tplForm, setTplForm] = useState({ name: '', channel: 'sms', body: '' });
  const [tplPreview, setTplPreview] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [provOpen, setProvOpen] = useState(false);
  const [provList, setProvList] = useState<CommProviderItem[]>([]);
  const [provForm, setProvForm] = useState({ name: '', channel: 'sms', apiEndpoint: '', credential: '' });
  const [provBusy, setProvBusy] = useState(false);
  const [provErr, setProvErr] = useState<string | null>(null);
  const [provTest, setProvTest] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const refreshProviders = () => superAdminCommunicationsApi.listProviders().then((r) => setProvList(r.providers)).catch(() => setProvList([]));
  const openProviders = () => { setProvOpen(true); setProvErr(null); setProvTest({}); setProvForm({ name: '', channel: 'sms', apiEndpoint: '', credential: '' }); refreshProviders(); };
  const createProv = () => {
    if (!provForm.name.trim() || !provForm.credential.trim()) { setProvErr('Name and credential are required.'); return; }
    setProvBusy(true); setProvErr(null);
    superAdminCommunicationsApi.createProvider({ name: provForm.name.trim(), channel: provForm.channel, credential: provForm.credential, apiEndpoint: provForm.apiEndpoint.trim() || undefined })
      .then(() => { setProvForm({ name: '', channel: 'sms', apiEndpoint: '', credential: '' }); return refreshProviders(); })
      .catch((e: unknown) => setProvErr(e instanceof Error ? e.message : 'Create failed'))
      .finally(() => setProvBusy(false));
  };
  const testProv = (id: string) => { setProvTest((t) => ({ ...t, [id]: 'Testing…' })); superAdminCommunicationsApi.testProvider(id).then((r) => { setProvTest((t) => ({ ...t, [id]: `${r.healthLabel} · ${r.recent.delivered} ok / ${r.recent.failed} failed` })); return refreshProviders(); }).catch((e: unknown) => setProvTest((t) => ({ ...t, [id]: e instanceof Error ? e.message : 'Test failed' }))); };

  const refreshTemplates = () => superAdminCommunicationsApi.listTemplates().then((r) => setTplList(r.templates)).catch(() => setTplList([]));
  const openTemplates = () => { setTplOpen(true); setTplErr(null); setTplPreview(null); setTplForm({ name: '', channel: 'sms', body: '' }); refreshTemplates(); };
  const doPreview = () => { superAdminCommunicationsApi.previewTemplate({ body: tplForm.body, values: { name: 'Alex', service: 'Manicure' } }).then((r) => setTplPreview(r.rendered)).catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Preview failed')); };
  const createTpl = () => {
    if (!tplForm.name.trim() || !tplForm.body.trim()) { setTplErr('Name and body are required.'); return; }
    setTplBusy(true); setTplErr(null);
    superAdminCommunicationsApi.createTemplate({ name: tplForm.name.trim(), channel: tplForm.channel, body: tplForm.body })
      .then(() => { setTplForm({ name: '', channel: 'sms', body: '' }); setTplPreview(null); return refreshTemplates(); })
      .catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Create failed'))
      .finally(() => setTplBusy(false));
  };
  const publishTpl = (t: TemplateListItem) => {
    const target = t.current_version > 0 ? t.current_version : 1;
    superAdminCommunicationsApi.publishTemplateVersion(t.id, target).then(() => refreshTemplates()).catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Publish failed'));
  };

  const openLimits = () => { setLimitOpen(true); setLimitErr(null); setLimitSaved(false); setLimitCurrent(null); setLimitTenant(''); setLimitFields({ monthlySms: '', monthlyEmail: '', monthlyPush: '', dailyLimit: '', enforcement: 'soft', optOutRateThresholdBps: '' }); };
  const loadLimit = (tenantId: string) => {
    setLimitTenant(tenantId); setLimitErr(null); setLimitSaved(false);
    if (!tenantId) { setLimitCurrent(null); return; }
    superAdminCommunicationsApi.getTenantLimit(tenantId).then((r) => {
      setLimitCurrent(r);
      const l = r.limit;
      setLimitFields({ monthlySms: l?.monthlySms?.toString() ?? '', monthlyEmail: l?.monthlyEmail?.toString() ?? '', monthlyPush: l?.monthlyPush?.toString() ?? '', dailyLimit: l?.dailyLimit?.toString() ?? '', enforcement: l?.enforcement ?? 'soft', optOutRateThresholdBps: l?.optOutRateThresholdBps?.toString() ?? '' });
    }).catch((e: unknown) => setLimitErr(e instanceof Error ? e.message : 'Failed to load limit'));
  };
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  const submitLimit = () => {
    if (!limitTenant) { setLimitErr('Select a tenant.'); return; }
    setLimitBusy(true); setLimitErr(null);
    superAdminCommunicationsApi.setTenantLimit(limitTenant, {
      monthlySms: numOrNull(limitFields.monthlySms), monthlyEmail: numOrNull(limitFields.monthlyEmail), monthlyPush: numOrNull(limitFields.monthlyPush),
      dailyLimit: numOrNull(limitFields.dailyLimit), enforcement: limitFields.enforcement, optOutRateThresholdBps: numOrNull(limitFields.optOutRateThresholdBps),
    }).then(() => { setLimitSaved(true); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setLimitErr(e instanceof Error ? e.message : 'Failed to save limit'))
      .finally(() => setLimitBusy(false));
  };

  const openAnnouncement = () => {
    setAnn({ title: '', subject: '', body: '', channel: 'in_app', priority: 'normal', roles: [], scheduledAt: '' });
    setAnnErr(null); setAnnResult(null);
    setAnnKey(`ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setAnnOpen(true);
  };
  const toggleRole = (r: string) => setAnn((a) => ({ ...a, roles: a.roles.includes(r) ? a.roles.filter((x) => x !== r) : [...a.roles, r] }));
  const submitAnnouncement = () => {
    if (!ann.title.trim()) { setAnnErr('A title is required.'); return; }
    if (!ann.body.trim()) { setAnnErr('A message body is required.'); return; }
    if (ann.roles.length === 0) { setAnnErr('Select at least one recipient role.'); return; }
    setAnnBusy(true); setAnnErr(null);
    superAdminCommunicationsApi.createAnnouncement({
      title: ann.title.trim(), subject: ann.subject.trim() || undefined, body: ann.body.trim(), channel: ann.channel, priority: ann.priority,
      recipientRoles: ann.roles, targetScope: 'all_tenants', scheduledAt: ann.scheduledAt ? new Date(ann.scheduledAt).toISOString() : undefined, idempotencyKey: annKey,
    }).then((r) => { setAnnResult(r); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setAnnErr(e instanceof Error ? e.message : 'Failed to send announcement'))
      .finally(() => setAnnBusy(false));
  };

  const load = useCallback((signal: AbortSignal, background = false) => {
    if (background && inFlight.current) return;
    inFlight.current = true;
    if (!background) { setLoading(true); setError(null); }
    superAdminCommunicationsApi.overview({})
      .then((d) => { if (!signal.aborted) { setData(d); setError(null); setLastUpdated(new Date()); setStale(false); if (!background) setLoading(false); } })
      .catch((e: unknown) => { if (signal.aborted) return; if (background) setStale(true); else { setError(e instanceof Error ? e.message : 'Failed to load communications'); setLoading(false); } })
      .finally(() => { inFlight.current = false; });
  }, []);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);
  useAutoRefresh((signal) => load(signal, true), REFRESH_MS);

  const row1 = useMemo(() => data?.kpis.slice(0, 6) ?? [], [data]);
  const row2 = useMemo(() => data?.kpis.slice(6, 12) ?? [], [data]);

  if (loading) {
    return (
      <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ height: 28, width: 260, background: '#EAE1D3', borderRadius: 8 }} />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{ ...cardStyle, height: 96, opacity: 0.6 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="work" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <div style={{ ...cardStyle, padding: 28, textAlign: 'center', maxWidth: 440, width: '100%' }}>
          <div style={{ color: SEM.bad, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Couldn’t load Communications</div>
          <div style={{ color: MUTED, fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} className="btn" style={{ minHeight: 36, fontWeight: 700 }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-3 items-start lg:items-center">
        <div className="vh" style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Communications <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
            Centralizes platform messaging infrastructure and communication history.
          </div>
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, fontSize: 11.5, color: stale ? 'var(--warn,#D09A36)' : 'var(--ok,#3E8F57)' }}>
            <Dot color={stale ? '#D09A36' : '#3E8F57'} />
            {stale ? (
              <span>Reconnecting — showing last known data{lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ''}.</span>
            ) : (
              <span>{lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} · auto-refresh {REFRESH_MS / 1000}s</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setModal('Export Report')} className="btn ghost" style={{ minHeight: 36 }}>
            ⭳ Export Report
          </button>
          <button onClick={openAnnouncement} className="btn" style={{ minHeight: 36, fontWeight: 800 }}>
            + Send Announcement
          </button>
          <button onClick={() => nav('/communications/inbox')} className="btn ghost" style={{ minHeight: 36, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FiInbox size={14} /> Open Inbox →
          </button>
        </div>
      </div>

      {/* KPI Grid (12 cards in 2 responsive 6-col rows) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {row1.map((k) => (
          <KpiCard key={k.key} k={k} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {row2.map((k) => (
          <KpiCard key={k.key} k={k} />
        ))}
      </div>

      {/* Control Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>
              Platform Communication Controls
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Global routing & templates</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Manage message infrastructure, templates, and sending policies.
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {PLATFORM_CONTROLS.map((c) => (
              <ControlCard
                key={c.title}
                title={c.title}
                desc={c.desc}
                onClick={() => (c.title === 'Send Platform Announcements' ? openAnnouncement() : c.title === 'Manage Message Templates' ? openTemplates() : c.title === 'Configure Communication Providers' ? openProviders() : setModal(c.title))}
              />
            ))}
          </div>
        </section>

        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>
              Tenant Communication Oversight
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Usage & limits policy</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Monitor tenant communication usage and enforce compliance.
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {TENANT_CONTROLS.map((c) => (
              <ControlCard
                key={c.title}
                title={c.title}
                desc={c.desc}
                onClick={() => (c.title === 'Set Tenant Usage Limits' ? openLimits() : setModal(c.title))}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Analytics (Charts & Donut mix) */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
              Messaging Volume Trend
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Last 30 days by channel</span>
          </div>
          <LineChart days={data.volumeTrend} />
        </section>

        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
              Delivery Performance
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Delivered vs failed vs suppressed</span>
          </div>
          <BarChart days={data.deliveryPerformance} />
        </section>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
              Communication Mix by Type
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Total messaging share</span>
          </div>
          <Donut segments={data.communicationMix.segments} total={data.communicationMix.total} centerLabel="Total" colorFor={(k) => CHAN_COLOR[k] || '#9CA3AF'} />
        </section>

        <section className="panel" style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
              Provider Status
            </h2>
            <span style={{ fontSize: 11, color: MUTED }}>Fleet health & uptime</span>
          </div>
          <Donut segments={data.providerStatus.segments} total={data.providerStatus.total} centerLabel="Providers" colorFor={(k) => HEALTH_COLOR[k] || '#9CA3AF'} />
        </section>
      </div>

      {/* Communication Types */}
      <section className="panel" style={{ ...cardStyle, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
            Communication Types
          </h2>
          <span style={{ fontSize: 11, color: MUTED }}>Platform supported delivery channels</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {data.communicationTypes.map((t) => (
            <div
              key={t.key}
              style={{
                background: '#FFFDF8',
                border: `1px solid ${LINE}`,
                borderRadius: 12,
                padding: '12px 10px',
                textAlign: 'center',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
              }}
              tabIndex={0}
              aria-label={`${t.label}: ${t.sent} sent`}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(169, 111, 34, 0.10)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.borderColor = LINE;
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: `${CHAN_COLOR[t.key] || '#9CA3AF'}18`,
                  border: `1px solid ${CHAN_COLOR[t.key] || '#9CA3AF'}30`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 6,
                }}
              >
                <Dot color={CHAN_COLOR[t.key] || '#9CA3AF'} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{t.label}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{fmt(t.sent)} sent</div>
            </div>
          ))}
        </div>
      </section>

      {/* Reporting Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Table
          title="Top Communication Activity Today"
          headers={['Template', 'Type', 'Sent', 'Delivered', 'Tenants']}
          rows={data.topActivity.map((a) => [a.template, a.channel, fmt(a.sent), fmt(a.delivered), fmt(a.tenants)])}
          empty="No activity today."
        />
        <Table
          title="Tenant Usage Overview"
          headers={['Tenant', 'Sent', 'Delivered', 'Delivery %', 'Opt-Out %']}
          rows={data.tenantUsage.map((t) => [t.tenant, fmt(t.sent), fmt(t.delivered), `${t.deliveryRate}%`, `${t.optOutRate}%`])}
          empty="No tenant usage in this period."
        />
      </div>

      <section className="panel" style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ background: '#FFF9EF', padding: '12px 18px', borderBottom: `1px solid ${LINE}` }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
            Delivery Failures & Compliance Review
          </h2>
        </div>
        <div style={{ padding: '0 18px 14px' }}>
          <TableInner
            headers={['Tenant', 'Channel', 'Template', 'Failure Reason', 'Provider', 'Time']}
            rows={data.deliveryFailures.map((f) => [f.tenant, f.channel, f.template, f.reason, f.provider, new Date(f.time).toLocaleTimeString()])}
            empty="No delivery failures in this period."
          />
        </div>
      </section>

      {/* Quick Actions */}
      <section className="panel" style={{ ...cardStyle, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
            Quick Actions
          </h2>
          <span style={{ fontSize: 11, color: MUTED }}>Instant oversight shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2.5">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => (a === 'Send Platform Announcement' ? openAnnouncement() : a === 'Set Tenant Usage Limits' ? openLimits() : a === 'Manage Message Templates' ? openTemplates() : a === 'Configure Providers' ? openProviders() : setModal(a))}
              style={{
                border: `1px solid ${LINE}`,
                borderRadius: 10,
                padding: '10px 8px',
                background: '#FFFDF8',
                fontSize: 11,
                fontWeight: 600,
                color: TEXT,
                cursor: 'pointer',
                minHeight: 54,
                textAlign: 'center',
                lineHeight: 1.3,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(169, 111, 34, 0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = LINE;
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </section>

      {/* At-a-Glance Summary (Today) */}
      <section className="panel" style={{ ...cardStyle, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
            At-a-Glance Summary (Today)
          </h2>
          <span style={{ fontSize: 11, color: MUTED }}>Daily pulse across platform</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Glance label="Total SMS Today" value={fmt(data.atAGlance.sms)} color="#3B82F6" />
          <Glance label="Total Email Today" value={fmt(data.atAGlance.email)} color={ORANGE} />
          <Glance label="Total Push Today" value={fmt(data.atAGlance.push)} color="#3E8F57" />
          <Glance label="In-App Announcements" value={data.atAGlance.inApp > 0 ? fmt(data.atAGlance.inApp) : 'Not tracked'} color="#8B5CF6" muted={data.atAGlance.inApp === 0} />
          <Glance label="Provider Incidents" value={data.atAGlance.providerIncidents.available ? '—' : 'Not tracked'} color="#D14343" muted={!data.atAGlance.providerIncidents.available} />
          <Glance label="Avg Delivery Rate" value={`${data.atAGlance.avgDeliveryRate}%`} color="#3E8F57" />
        </div>
      </section>

      {/* Bottom Link to Inbox */}
      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <button
          onClick={() => nav('/communications/inbox')}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--g7, #A96F22)',
            fontWeight: 700,
            cursor: 'pointer',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
          }}
        >
          <FiInbox size={15} /> Open Communications Inbox →
        </button>
      </div>

      {/* Modal: Providers */}
      {provOpen ? (
        <div role="dialog" aria-label="Communication Providers" onClick={() => setProvOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, background: '#FFFDF8', padding: 22, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 4, color: TEXT }}>Communication Providers</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>SMS / email / push delivery providers. Secrets are encrypted and never displayed after saving; only the last 4 characters are shown.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {provList.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No providers configured.</div> : provList.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', flexWrap: 'wrap', background: '#fff' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: MUTED }}>{p.channel} · key ••••{p.credential_last4 ?? '----'}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: p.status === 'active' ? SEM.good : p.status === 'down' ? SEM.bad : MUTED }}>{p.status}</span>
                  <button onClick={() => testProv(p.id)} className="btn ghost" style={{ marginLeft: 'auto', height: 28, padding: '0 10px', fontSize: 11, fontWeight: 700 }}>Test</button>
                  {provTest[p.id] ? <span style={{ fontSize: 11, color: MUTED, width: '100%', marginTop: 2 }}>{provTest[p.id]}</span> : null}
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>Add provider</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Name<input aria-label="Provider name" value={provForm.name} onChange={(e) => setProvForm((f) => ({ ...f, name: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Channel<select aria-label="Provider channel" value={provForm.channel} onChange={(e) => setProvForm((f) => ({ ...f, channel: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}>{['sms', 'email', 'push', 'multi'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              </div>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>API endpoint (optional)<input aria-label="Provider endpoint" value={provForm.apiEndpoint} onChange={(e) => setProvForm((f) => ({ ...f, apiEndpoint: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Credential / API key (write-only)<input aria-label="Provider credential" type="password" autoComplete="off" value={provForm.credential} onChange={(e) => setProvForm((f) => ({ ...f, credential: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
              {provErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{provErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={createProv} disabled={provBusy} className="btn" style={{ minHeight: 36, fontWeight: 700, opacity: provBusy ? 0.7 : 1 }}>{provBusy ? 'Saving…' : 'Add provider'}</button>
              </div>
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}><button onClick={() => setProvOpen(false)} className="btn ghost" style={{ minHeight: 34 }}>Close</button></div>
          </div>
        </div>
      ) : null}

      {/* Modal: Message Templates */}
      {tplOpen ? (
        <div role="dialog" aria-label="Message Templates" onClick={() => setTplOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, background: '#FFFDF8', padding: 22, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 4, color: TEXT }}>Message Templates</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>Reusable SMS / email / push templates. Editing creates a new version; published versions are never overwritten.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {tplList.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No templates yet.</div> : tplList.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', background: '#fff' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{t.name}</span>
                  <span style={{ fontSize: 11.5, color: MUTED }}>{t.channel} · v{t.current_version || '—'} · {t.versions} version{t.versions === 1 ? '' : 's'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: t.status === 'published' ? SEM.good : MUTED }}>{t.status}</span>
                  {t.status !== 'published' ? <button onClick={() => publishTpl(t)} className="btn" style={{ height: 28, padding: '0 10px', fontSize: 11, fontWeight: 700 }}>Publish</button> : null}
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>New template</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Name<input aria-label="Template name" value={tplForm.name} onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Channel<select aria-label="Template channel" value={tplForm.channel} onChange={(e) => setTplForm((f) => ({ ...f, channel: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}>{['sms', 'email', 'push', 'in_app'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              </div>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Body (use {'{{name}}'} placeholders)<textarea aria-label="Template body" value={tplForm.body} onChange={(e) => { setTplForm((f) => ({ ...f, body: e.target.value })); setTplPreview(null); }} rows={3} style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit', background: '#fff' }} /></label>
              {tplPreview != null ? <div style={{ fontSize: 12, background: '#F7F2E9', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, color: TEXT }}>Preview: {tplPreview}</div> : null}
              {tplErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{tplErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={doPreview} className="btn ghost" style={{ minHeight: 36 }}>Preview</button>
                <button onClick={createTpl} disabled={tplBusy} className="btn" style={{ minHeight: 36, fontWeight: 700, opacity: tplBusy ? 0.7 : 1 }}>{tplBusy ? 'Saving…' : 'Create template'}</button>
              </div>
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}><button onClick={() => setTplOpen(false)} className="btn ghost" style={{ minHeight: 34 }}>Close</button></div>
          </div>
        </div>
      ) : null}

      {/* Modal: Tenant Usage Limits */}
      {limitOpen ? (
        <div role="dialog" aria-label="Set Tenant Usage Limits" onClick={() => setLimitOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, background: '#FFFDF8', padding: 22, width: 480, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 4, color: TEXT }}>Set Tenant Usage Limits</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>Backend-enforced messaging limits. Blank fields mean unlimited for that channel.</div>
            {limitSaved ? (
              <div>
                <div style={{ fontSize: 13, color: '#3E8F57', fontWeight: 700, marginBottom: 8 }}>Limits saved and enforced.</div>
                <div style={{ marginTop: 14, textAlign: 'right' }}><button onClick={() => setLimitOpen(false)} className="btn" style={{ minHeight: 36, fontWeight: 700 }}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Tenant<select aria-label="Tenant" value={limitTenant} onChange={(e) => loadLimit(e.target.value)} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}><option value="">Select a tenant…</option>{data.tenantUsage.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
                {limitCurrent ? <div style={{ fontSize: 11.5, color: MUTED }}>Month-to-date usage — SMS {limitCurrent.usage.sms} · Email {limitCurrent.usage.email} · Push {limitCurrent.usage.push}</div> : null}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Monthly SMS<input aria-label="Monthly SMS" value={limitFields.monthlySms} onChange={(e) => setLimitFields((f) => ({ ...f, monthlySms: e.target.value }))} inputMode="numeric" style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px', background: '#fff' }} /></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Monthly Email<input aria-label="Monthly Email" value={limitFields.monthlyEmail} onChange={(e) => setLimitFields((f) => ({ ...f, monthlyEmail: e.target.value }))} inputMode="numeric" style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px', background: '#fff' }} /></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Monthly Push<input aria-label="Monthly Push" value={limitFields.monthlyPush} onChange={(e) => setLimitFields((f) => ({ ...f, monthlyPush: e.target.value }))} inputMode="numeric" style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px', background: '#fff' }} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Daily limit<input aria-label="Daily limit" value={limitFields.dailyLimit} onChange={(e) => setLimitFields((f) => ({ ...f, dailyLimit: e.target.value }))} inputMode="numeric" style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px', background: '#fff' }} /></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Enforcement<select aria-label="Enforcement" value={limitFields.enforcement} onChange={(e) => setLimitFields((f) => ({ ...f, enforcement: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}>{['soft', 'hard', 'approval'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                </div>
                {limitErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{limitErr}</div> : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setLimitOpen(false)} className="btn ghost" style={{ minHeight: 36 }}>Cancel</button>
                  <button onClick={submitLimit} disabled={limitBusy} className="btn" style={{ minHeight: 36, fontWeight: 700, opacity: limitBusy ? 0.7 : 1 }}>{limitBusy ? 'Saving…' : 'Save limits'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Modal: Platform Announcement */}
      {annOpen ? (
        <div role="dialog" aria-label="Send Platform Announcement" onClick={() => setAnnOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, background: '#FFFDF8', padding: 22, width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 4, color: TEXT }}>Send Platform Announcement</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>Broadcast to tenant staff/admins across the platform. Announcements never target tenant customers.</div>
            {annResult ? (
              <div>
                <div style={{ fontSize: 13, color: '#3E8F57', fontWeight: 700, marginBottom: 8 }}>{annResult.idempotent ? 'Already queued — no duplicate created.' : `Announcement ${annResult.status}.`}</div>
                <div style={{ fontSize: 13, color: TEXT }}>Estimated recipients: <strong>{annResult.recipientEstimate.toLocaleString()}</strong> tenant users.</div>
                <div style={{ marginTop: 16, textAlign: 'right' }}><button onClick={() => setAnnOpen(false)} className="btn" style={{ minHeight: 36, fontWeight: 700 }}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Title<input aria-label="Announcement title" value={ann.title} onChange={(e) => setAnn((a) => ({ ...a, title: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Subject (optional)<input aria-label="Announcement subject" value={ann.subject} onChange={(e) => setAnn((a) => ({ ...a, subject: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Message<textarea aria-label="Announcement body" value={ann.body} onChange={(e) => setAnn((a) => ({ ...a, body: e.target.value }))} rows={3} style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit', background: '#fff' }} /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Channel<select aria-label="Channel" value={ann.channel} onChange={(e) => setAnn((a) => ({ ...a, channel: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}>{['in_app', 'email', 'sms', 'push', 'multi'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Priority<select aria-label="Priority" value={ann.priority} onChange={(e) => setAnn((a) => ({ ...a, priority: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff' }}>{['normal', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                </div>
                <div style={{ fontSize: 11.5, color: '#5C5240' }}>Recipient roles (tenant users)
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5 }}>{ELIGIBLE_ROLES.map((r) => (<label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" aria-label={`Role ${r}`} checked={ann.roles.includes(r)} onChange={() => toggleRole(r)} /> {r}</label>))}</div>
                </div>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Schedule (optional)<input aria-label="Schedule" type="datetime-local" value={ann.scheduledAt} onChange={(e) => setAnn((a) => ({ ...a, scheduledAt: e.target.value }))} style={{ height: 36, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', background: '#fff' }} /></label>
                {annErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{annErr}</div> : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setAnnOpen(false)} className="btn ghost" style={{ minHeight: 36 }}>Cancel</button>
                  <button onClick={submitAnnouncement} disabled={annBusy} className="btn" style={{ minHeight: 36, fontWeight: 700, opacity: annBusy ? 0.7 : 1 }}>{annBusy ? 'Sending…' : 'Queue announcement'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* General Information Modal */}
      {modal ? (
        <div role="dialog" aria-label={modal} onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, background: '#FFFDF8', padding: 22, width: 440, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 8, color: TEXT }}>{modal}</div>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>
              This is a permissioned, audited workflow. The oversight dashboard is live and reconciles from real messaging data; this specific workflow is delivered in an upcoming unit of the Communications build.
            </div>
            <div style={{ marginTop: 18, textAlign: 'right' }}>
              <button onClick={() => setModal(null)} className="btn" style={{ minHeight: 36, fontWeight: 700 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <section className="panel" style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      <div style={{ background: '#FFF9EF', padding: '12px 18px', borderBottom: `1px solid ${LINE}` }}>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: TEXT, margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ padding: '0 18px 14px' }}>
        <TableInner headers={headers} rows={rows} empty={empty} />
      </div>
    </section>
  );
}

function TableInner({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 12, padding: '18px 0', textAlign: 'center' }}>{empty}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      color: MUTED,
                      fontWeight: 700,
                      fontSize: 10.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '10px 8px',
                      borderBottom: `1px solid ${LINE}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ transition: 'background 0.12s ease' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(243, 231, 210, 0.25)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  {r.map((c, j) => (
                    <td
                      key={j}
                      style={{
                        padding: '9px 8px',
                        borderBottom: `1px solid ${LINE}`,
                        color: TEXT,
                        whiteSpace: 'nowrap',
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Glance({ label, value, color, muted }: { label: string; value: string; color: string; muted?: boolean }) {
  return (
    <div
      style={{
        background: '#FFFDF8',
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: `${color}18`,
            border: `1px solid ${color}30`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Dot color={color} />
        </span>
        <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 20,
          fontWeight: 700,
          color: muted ? '#B8AE9E' : TEXT,
        }}
      >
        {value}
      </div>
    </div>
  );
}
