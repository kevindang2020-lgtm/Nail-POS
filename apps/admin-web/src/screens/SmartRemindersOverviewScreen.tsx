// SmartRemindersOverviewScreen.tsx — Super Admin → AI & Automation → Smart Reminders. Reminder-oversight dashboard
// wired to GET /super-admin/smart-reminders/overview (real data; honest "Not tracked" where a source isn't modelled).
// White/orange Super Admin design; live background refresh; loading / empty / error / stale states.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminSmartRemindersApi, type SROverview, type SRKpi, type SRSegment, type SRTemplateItem, type SREffective, type SRFlowState, type SRPlanFeature } from '../api/superAdminSmartRemindersApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const REMINDER_TYPE_OPTIONS = [
  { key: 'appointment_confirmation', label: 'Appointment Confirmation' }, { key: 'upcoming_appointment', label: 'Upcoming Appointment Reminder' },
  { key: 'missed_appointment_followup', label: 'Missed Appointment Follow-Up' }, { key: 'customer_rebooking', label: 'Customer Rebooking Reminder' },
  { key: 'technician_schedule', label: 'Technician Schedule Reminder' }, { key: 'subscription_payment', label: 'Subscription Payment Reminder' },
  { key: 'merchant_document', label: 'Merchant-Document Reminder' }, { key: 'onboarding', label: 'Onboarding Reminder' },
  { key: 'support_ticket_update', label: 'Support Ticket Update' }, { key: 'device_offline_alert', label: 'Device-Offline Alert' },
];

const REFRESH_MS = 25_000;
const ORANGE = '#E07B39';
const LINE = '#ECE7DE';
const TEXT = '#2A2320';
const MUTED = '#8A7E6D';
const SEM: Record<string, string> = { good: '#3E8F57', warn: '#C08A2E', bad: '#D14343', neutral: '#6B7280' };
const CHAN_COLOR: Record<string, string> = { sms: '#3B82F6', email: ORANGE, push: '#8B5CF6', other: '#9CA3AF' };
const STATUS_COLOR: Record<string, string> = { delivered: '#3E8F57', failed: '#D14343', blocked: '#C08A2E' };
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' };
const fmt = (n: number) => n.toLocaleString();
function Dot({ color }: { color: string }) { return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />; }

function KpiCard({ k }: { k: SRKpi }) {
  const tint = k.available ? (SEM[k.semantic] || MUTED) : MUTED;
  return (
    <div style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }} tabIndex={0} aria-label={`${k.label}: ${k.available ? k.display : 'Not tracked'}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: `${tint}1A`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Dot color={tint} /></span>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{k.label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: k.available ? TEXT : '#C62B3F' }}>{k.available ? k.display : 'Not tracked'}</div>
      {k.available ? (
        k.direction === 'flat' && k.deltaPct === 0
          ? <div style={{ fontSize: 11.5, color: MUTED }}>—</div>
          : <div style={{ fontSize: 11.5, color: SEM[k.semantic] || MUTED, fontWeight: 600 }}>{k.direction === 'up' ? '▲' : k.direction === 'down' ? '▼' : ''} {Math.abs(k.deltaPct)}% vs prior</div>
      ) : <div style={{ fontSize: 11, color: '#B8AE9E' }}>No source modelled yet</div>}
    </div>
  );
}

function Donut({ segments, total, centerLabel, colorFor }: { segments: SRSegment[]; total: number; centerLabel: string; colorFor: (k: string) => string }) {
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.filter((s) => s.count > 0).map((s) => { const frac = total > 0 ? s.count / total : 0; const el = { dashArray: `${frac * C} ${C - frac * C}`, offset: -acc * C, color: colorFor(s.key) }; acc += frac; return el; });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={`${centerLabel}: ${total}`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="#F1ECE3" strokeWidth="16" />
        {arcs.map((a, i) => (<circle key={i} cx="64" cy="64" r={R} fill="none" stroke={a.color} strokeWidth="16" strokeDasharray={a.dashArray} strokeDashoffset={a.offset} transform="rotate(-90 64 64)" />))}
        <text x="64" y="60" textAnchor="middle" fontSize="18" fontWeight="800" fill={TEXT}>{fmt(total)}</text>
        <text x="64" y="78" textAnchor="middle" fontSize="10" fill={MUTED}>{centerLabel}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
        {segments.length === 0 ? <span style={{ color: MUTED }}>No data yet</span> : segments.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot color={colorFor(s.key)} /><span style={{ color: TEXT }}>{s.label}</span><span style={{ color: MUTED, marginLeft: 'auto' }}>{fmt(s.count)} · {s.pct}%</span></div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ days }: { days: SROverview['deliveryTrend'] }) {
  const W = 520, H = 150, pad = 24;
  const max = Math.max(1, ...days.map((d) => d.total));
  const x = (i: number) => pad + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  if (days.length === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>No reminders in this period.</div>;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reminder delivery trend">
      <polyline fill="none" stroke={ORANGE} strokeWidth="2" points={days.map((d, i) => `${x(i)},${y(d.total)}`).join(' ')} />
      {days.map((d, i) => (<circle key={i} cx={x(i)} cy={y(d.total)} r="2.5" fill={ORANGE} />))}
      {days.map((d, i) => (<text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{d.day.slice(5)}</text>))}
    </svg>
  );
}

function BarChart({ days }: { days: SROverview['deliveryTrend'] }) {
  const W = 520, H = 150, pad = 24;
  const max = Math.max(1, ...days.map((d) => d.delivered + d.failed + d.blocked));
  const groupW = days.length ? (W - 2 * pad) / days.length : 0;
  if (days.length === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>No delivery events in this period.</div>;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Delivered vs failed">
      {days.map((d, i) => {
        const bw = Math.min(9, groupW / 3); const gx = pad + i * groupW + groupW / 2;
        const bars = [{ v: d.delivered, c: '#3E8F57' }, { v: d.failed, c: '#D14343' }];
        return bars.map((b, j) => (<rect key={`${i}-${j}`} x={gx - bw + j * bw} y={H - pad - (b.v / max) * (H - 2 * pad)} width={bw - 1} height={(b.v / max) * (H - 2 * pad)} fill={b.c} />));
      })}
      {days.map((d, i) => (<text key={i} x={pad + i * groupW + groupW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{d.day.slice(5)}</text>))}
    </svg>
  );
}

const CONTROLS = [
  'Create Global Reminder Templates', 'Configure Default Timing', 'Enable Reminders by Subscription Plan', 'Set SMS, Email, or Push Channels',
  'Configure Fallback Behavior', 'Monitor Delivery Rates', 'Disable Problematic Reminders', 'Allow Tenant Customization',
];
const QUICK_ACTIONS = ['Create Reminder', 'Export Report', 'Schedule Reminder Review', 'Configure Timing', 'Set Channels', 'View Failures', 'Enable by Plan', 'Tenant Customization'];

export function SmartRemindersOverviewScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<SROverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const doExport = () => {
    setExporting(true);
    superAdminSmartRemindersApi.exportCsv({ dataset: 'tenant-usage' })
      .then((r) => {
        const blob = new Blob([r.content], { type: r.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(() => setModal('Export Report'))
      .finally(() => setExporting(false));
  };
  const [tplOpen, setTplOpen] = useState(false);
  const [tplList, setTplList] = useState<SRTemplateItem[]>([]);
  const [tplForm, setTplForm] = useState({ name: '', reminderType: 'appointment_confirmation', sms: '', emailSubject: '', emailBody: '' });
  const [tplPreview, setTplPreview] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refreshTemplates = () => superAdminSmartRemindersApi.listTemplates().then((r) => setTplList(r.templates)).catch(() => setTplList([]));
  const openTemplates = () => { setTplOpen(true); setTplErr(null); setTplPreview(null); setTplForm({ name: '', reminderType: 'appointment_confirmation', sms: '', emailSubject: '', emailBody: '' }); refreshTemplates(); };
  const doPreview = () => { superAdminSmartRemindersApi.previewTemplate({ sms: tplForm.sms, emailBody: tplForm.emailBody, values: { name: 'Alex', service: 'Manicure' } }).then((r) => setTplPreview(r.sms ?? r.emailBody ?? '(no preview)')).catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Preview failed')); };
  const createTpl = () => {
    if (!tplForm.name.trim() || (!tplForm.sms.trim() && !tplForm.emailBody.trim())) { setTplErr('Name and at least one channel (SMS or email) are required.'); return; }
    setTplBusy(true); setTplErr(null);
    superAdminSmartRemindersApi.createTemplate({ name: tplForm.name.trim(), reminderType: tplForm.reminderType, sms: tplForm.sms.trim() || undefined, emailSubject: tplForm.emailSubject.trim() || undefined, emailBody: tplForm.emailBody.trim() || undefined })
      .then(() => { setTplForm({ name: '', reminderType: tplForm.reminderType, sms: '', emailSubject: '', emailBody: '' }); setTplPreview(null); return refreshTemplates(); })
      .catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Create failed'))
      .finally(() => setTplBusy(false));
  };
  const publishTpl = (t: SRTemplateItem) => { superAdminSmartRemindersApi.publishTemplateVersion(t.id, t.current_version > 0 ? t.current_version : 1).then(() => refreshTemplates()).catch((e: unknown) => setTplErr(e instanceof Error ? e.message : 'Publish failed')); };

  const [tmOpen, setTmOpen] = useState(false);
  const [tmForm, setTmForm] = useState({ reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: '1440', minOffsetMinutes: '0', maxOffsetMinutes: '10080', quietHoursStart: '', quietHoursEnd: '', quietHoursPolicy: 'defer', timezoneSource: 'tenant' });
  const [tmBusy, setTmBusy] = useState(false);
  const [tmErr, setTmErr] = useState<string | null>(null);
  const [tmSaved, setTmSaved] = useState(false);
  const openTiming = () => { setTmOpen(true); setTmErr(null); setTmSaved(false); loadTiming('upcoming_appointment'); };
  const loadTiming = (reminderType: string) => {
    setTmForm((f) => ({ ...f, reminderType })); setTmErr(null); setTmSaved(false);
    superAdminSmartRemindersApi.getTiming(reminderType).then((r) => {
      const t = r.timing; if (t) setTmForm({ reminderType, direction: t.direction, offsetMinutes: String(t.offsetMinutes), minOffsetMinutes: String(t.minOffsetMinutes), maxOffsetMinutes: String(t.maxOffsetMinutes), quietHoursStart: t.quietHoursStart != null ? String(t.quietHoursStart) : '', quietHoursEnd: t.quietHoursEnd != null ? String(t.quietHoursEnd) : '', quietHoursPolicy: t.quietHoursPolicy, timezoneSource: t.timezoneSource });
    }).catch((e: unknown) => setTmErr(e instanceof Error ? e.message : 'Failed to load timing'));
  };
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  const saveTiming = () => {
    setTmBusy(true); setTmErr(null);
    superAdminSmartRemindersApi.setTiming({ reminderType: tmForm.reminderType, direction: tmForm.direction, offsetMinutes: Number(tmForm.offsetMinutes) || 0, minOffsetMinutes: Number(tmForm.minOffsetMinutes) || 0, maxOffsetMinutes: Number(tmForm.maxOffsetMinutes) || 0, quietHoursStart: numOrNull(tmForm.quietHoursStart), quietHoursEnd: numOrNull(tmForm.quietHoursEnd), quietHoursPolicy: tmForm.quietHoursPolicy, timezoneSource: tmForm.timezoneSource })
      .then(() => setTmSaved(true))
      .catch((e: unknown) => setTmErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setTmBusy(false));
  };

  const [tcOpen, setTcOpen] = useState(false);
  const [tcForm, setTcForm] = useState({ tenantId: '', reminderType: 'upcoming_appointment', offsetMinutes: '', channels: '' });
  const [tcEff, setTcEff] = useState<SREffective | null>(null);
  const [tcBusy, setTcBusy] = useState(false);
  const [tcErr, setTcErr] = useState<string | null>(null);
  const [tcMsg, setTcMsg] = useState<string | null>(null);
  const openCustomization = () => { setTcOpen(true); setTcErr(null); setTcMsg(null); setTcEff(null); setTcForm({ tenantId: data?.tenantUsage[0]?.tenantId ?? '', reminderType: 'upcoming_appointment', offsetMinutes: '', channels: '' }); if (data?.tenantUsage[0]) loadEffective(data.tenantUsage[0].tenantId, 'upcoming_appointment'); };
  const loadEffective = (tenantId: string, reminderType: string) => {
    setTcForm((f) => ({ ...f, tenantId, reminderType })); setTcErr(null);
    if (!tenantId) { setTcEff(null); return; }
    superAdminSmartRemindersApi.getEffective(tenantId, reminderType).then((r) => { setTcEff(r); setTcForm((f) => ({ ...f, offsetMinutes: r.override?.offsetMinutes != null ? String(r.override.offsetMinutes) : '', channels: r.override?.channels?.join(',') ?? '' })); }).catch((e: unknown) => setTcErr(e instanceof Error ? e.message : 'Failed to load'));
  };
  const saveOverride = () => {
    if (!tcForm.tenantId) { setTcErr('Select a tenant.'); return; }
    setTcBusy(true); setTcErr(null); setTcMsg(null);
    const channels = tcForm.channels.trim() ? tcForm.channels.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
    superAdminSmartRemindersApi.setOverride(tcForm.tenantId, { reminderType: tcForm.reminderType, offsetMinutes: tcForm.offsetMinutes.trim() ? Number(tcForm.offsetMinutes) : undefined, channels })
      .then(() => { setTcMsg('Customization saved.'); return loadEffective(tcForm.tenantId, tcForm.reminderType); })
      .catch((e: unknown) => setTcErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setTcBusy(false));
  };
  const revertOverride = () => {
    if (!tcForm.tenantId) return;
    setTcBusy(true); setTcErr(null); setTcMsg(null);
    superAdminSmartRemindersApi.revertOverride(tcForm.tenantId, tcForm.reminderType)
      .then(() => { setTcMsg('Reverted to platform default.'); return loadEffective(tcForm.tenantId, tcForm.reminderType); })
      .catch((e: unknown) => setTcErr(e instanceof Error ? e.message : 'Revert failed'))
      .finally(() => setTcBusy(false));
  };

  const [fsOpen, setFsOpen] = useState(false);
  const [fsForm, setFsForm] = useState({ reminderType: 'missed_appointment_followup', reason: '', status: 'disabled' });
  const [fsState, setFsState] = useState<SRFlowState | null>(null);
  const [fsBusy, setFsBusy] = useState(false);
  const [fsErr, setFsErr] = useState<string | null>(null);
  const [fsMsg, setFsMsg] = useState<string | null>(null);
  const openFlow = () => { setFsOpen(true); setFsErr(null); setFsMsg(null); setFsForm({ reminderType: 'missed_appointment_followup', reason: '', status: 'disabled' }); loadFlow('missed_appointment_followup'); };
  const loadFlow = (reminderType: string) => { setFsForm((f) => ({ ...f, reminderType })); setFsErr(null); superAdminSmartRemindersApi.getFlow(reminderType).then((r) => setFsState(r.state)).catch(() => setFsState(null)); };
  const disableFlow = () => {
    if (fsForm.reason.trim().length < 3) { setFsErr('A reason is required to disable a reminder flow.'); return; }
    setFsBusy(true); setFsErr(null); setFsMsg(null);
    superAdminSmartRemindersApi.disableFlow({ reminderType: fsForm.reminderType, reason: fsForm.reason.trim(), status: fsForm.status })
      .then((r) => { setFsMsg(`Flow set to ${r.status}. New jobs are stopped; history is preserved.`); return loadFlow(fsForm.reminderType); })
      .catch((e: unknown) => setFsErr(e instanceof Error ? e.message : 'Disable failed'))
      .finally(() => setFsBusy(false));
  };
  const enableFlow = () => {
    setFsBusy(true); setFsErr(null); setFsMsg(null);
    superAdminSmartRemindersApi.enableFlow({ reminderType: fsForm.reminderType })
      .then(() => { setFsMsg('Flow re-enabled.'); return loadFlow(fsForm.reminderType); })
      .catch((e: unknown) => setFsErr(e instanceof Error ? e.message : 'Enable failed'))
      .finally(() => setFsBusy(false));
  };

  const [chOpen, setChOpen] = useState(false);
  const [chForm, setChForm] = useState({ reminderType: 'upcoming_appointment', primaryChannel: 'sms', fallbackChannels: [] as string[], stopOnSuccess: true });
  const [chBusy, setChBusy] = useState(false);
  const [chErr, setChErr] = useState<string | null>(null);
  const [chMsg, setChMsg] = useState<string | null>(null);
  const openChannels = () => { setChOpen(true); setChErr(null); setChMsg(null); setChForm({ reminderType: 'upcoming_appointment', primaryChannel: 'sms', fallbackChannels: [], stopOnSuccess: true }); loadChannels('upcoming_appointment'); };
  const loadChannels = (reminderType: string) => {
    setChForm((f) => ({ ...f, reminderType })); setChErr(null);
    superAdminSmartRemindersApi.getChannels(reminderType).then((r) => { if (r.config) setChForm({ reminderType, primaryChannel: r.config.primaryChannel, fallbackChannels: r.config.fallbackChannels, stopOnSuccess: r.config.stopOnSuccess }); }).catch(() => {});
  };
  const toggleFallback = (c: string) => setChForm((f) => ({ ...f, fallbackChannels: f.fallbackChannels.includes(c) ? f.fallbackChannels.filter((x) => x !== c) : [...f.fallbackChannels, c] }));
  const sequencePreview = [chForm.primaryChannel, ...chForm.fallbackChannels.filter((c) => c !== chForm.primaryChannel)].filter((v, i, a) => a.indexOf(v) === i);
  const saveChannels = () => {
    setChBusy(true); setChErr(null); setChMsg(null);
    superAdminSmartRemindersApi.setChannels({ reminderType: chForm.reminderType, primaryChannel: chForm.primaryChannel, fallbackChannels: chForm.fallbackChannels.filter((c) => c !== chForm.primaryChannel), stopOnSuccess: chForm.stopOnSuccess })
      .then((r) => setChMsg(`Saved. Delivery order: ${r.after?.sequence.join(' → ')}`))
      .catch((e: unknown) => setChErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setChBusy(false));
  };

  const [pfOpen, setPfOpen] = useState(false);
  const [pfForm, setPfForm] = useState({ planCode: '', featureKey: 'smart_reminders', state: 'enabled' });
  const [pfList, setPfList] = useState<SRPlanFeature[]>([]);
  const [pfBusy, setPfBusy] = useState(false);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [pfMsg, setPfMsg] = useState<string | null>(null);
  const openPlanFeatures = () => { setPfOpen(true); setPfErr(null); setPfMsg(null); setPfForm({ planCode: '', featureKey: 'smart_reminders', state: 'enabled' }); setPfList([]); };
  const loadPlanFeatures = (planCode: string) => { if (!planCode.trim()) { setPfList([]); return; } superAdminSmartRemindersApi.listPlanFeatures(planCode.trim()).then((r) => setPfList(r.features)).catch(() => setPfList([])); };
  const savePlanFeature = () => {
    if (!pfForm.planCode.trim()) { setPfErr('Plan code is required.'); return; }
    setPfBusy(true); setPfErr(null); setPfMsg(null);
    superAdminSmartRemindersApi.setPlanFeature({ planCode: pfForm.planCode.trim(), featureKey: pfForm.featureKey, state: pfForm.state })
      .then((r) => { setPfMsg(`${r.featureKey} on ${r.planCode}: ${r.state} (${r.allowed ? 'permitted' : 'blocked'}).`); return loadPlanFeatures(pfForm.planCode); })
      .catch((e: unknown) => setPfErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setPfBusy(false));
  };

  const load = useCallback((signal: AbortSignal, background = false) => {
    if (background && inFlight.current) return;
    inFlight.current = true;
    if (!background) { setLoading(true); setError(null); }
    superAdminSmartRemindersApi.overview({})
      .then((d) => { if (!signal.aborted) { setData(d); setError(null); setLastUpdated(new Date()); setStale(false); if (!background) setLoading(false); } })
      .catch((e: unknown) => { if (signal.aborted) return; if (background) setStale(true); else { setError(e instanceof Error ? e.message : 'Failed to load smart reminders'); setLoading(false); } })
      .finally(() => { inFlight.current = false; });
  }, []);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);
  useAutoRefresh((signal) => load(signal, true), REFRESH_MS);

  const row1 = useMemo(() => data?.kpis.slice(0, 6) ?? [], [data]);
  const row2 = useMemo(() => data?.kpis.slice(6, 12) ?? [], [data]);

  if (loading) return <div style={{ padding: 24 }}><div style={{ height: 20, width: 220, background: '#Eee', borderRadius: 6 }} /><div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>{Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ ...card, height: 96 }} />)}</div></div>;
  if (error) return <div style={{ padding: 24 }}><div style={{ ...card, padding: 24, textAlign: 'center' }}><div style={{ color: SEM.bad, fontWeight: 700, marginBottom: 8 }}>Couldn’t load Smart Reminders</div><div style={{ color: MUTED, fontSize: 13, marginBottom: 14 }}>{error}</div><button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Retry</button></div></div>;
  if (!data) return null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#FBFAF7' }}>
      <div className="work">
        <div className='flex flex-col lg:flex-row justify-between gap-3'>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: TEXT, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>Smart Reminders <span style={{ color: ORANGE }}>★</span></h1>
            <div style={{ color: MUTED, fontSize: 12.5, marginTop: 2 }}>Controls automated reminders triggered by appointments and business events.</div>
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, fontSize: 11.5, color: stale ? '#B8860B' : '#7A9E86' }}>
              <Dot color={stale ? '#D09A36' : '#3E8F57'} />
              {stale ? <span>Reconnecting — showing last known data{lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ''}.</span> : <span>{lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} · auto-refresh {REFRESH_MS / 1000}s</span>}
            </div>
          </div>
          <div className="items-baseline" style={{ display: 'flex', gap: 8 }}>
            <button onClick={doExport} disabled={exporting} className="btn ghost">⭳ {exporting ? 'Exporting…' : 'Export Report'}</button>
            <button onClick={openTemplates} className="btn">+ Create Reminder</button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mt-4">{row1.map((k) => <KpiCard key={k.key} k={k} />)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mt-4">{row2.map((k) => <KpiCard key={k.key} k={k} />)}</div>

        {/* controls + reminder types */}
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: TEXT, marginBottom: 10 }}>Smart Reminder Controls</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {CONTROLS.map((c) => (<button key={c} onClick={() => (c === 'Create Global Reminder Templates' ? openTemplates() : c === 'Configure Default Timing' ? openTiming() : c === 'Allow Tenant Customization' ? openCustomization() : c === 'Disable Problematic Reminders' ? openFlow() : c === 'Set SMS, Email, or Push Channels' ? openChannels() : c === 'Configure Fallback Behavior' ? openChannels() : c === 'Enable Reminders by Subscription Plan' ? openPlanFeatures() : setModal(c))} style={{ ...card, boxShadow: 'none', padding: 12, textAlign: 'left', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: TEXT, minHeight: 62 }}>{c}</button>))}
            </div>
          </div>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: TEXT, marginBottom: 10 }}>Reminder Types</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {data.reminderTypes.map((t) => (<div key={t.key} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: TEXT, fontWeight: 600 }}>{t.label}</div>))}
            </div>
          </div>
        </div>

        {/* charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Reminder Delivery Trend (Last 7 Days)</div><LineChart days={data.deliveryTrend} /></div>
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Scheduled vs Delivered vs Failed{!data.scheduledVsDelivered.scheduledAvailable ? <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 500 }}> — scheduled counts not tracked</span> : null}</div><BarChart days={data.deliveryTrend} /></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Reminder Mix by Channel</div><Donut segments={data.channelMix.segments} total={data.channelMix.total} centerLabel="Total" colorFor={(k) => CHAN_COLOR[k] || '#9CA3AF'} /></div>
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Delivery Status</div><Donut segments={data.deliveryStatus.segments} total={data.deliveryStatus.total} centerLabel="Total" colorFor={(k) => STATUS_COLOR[k] || '#9CA3AF'} /></div>
        </div>

        {/* tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
          <Table title="Tenant Reminder Usage" headers={['Tenant', 'Total', 'SMS', 'Email', 'Push', 'Delivery %']} rows={data.tenantUsage.map((t) => [t.tenant, fmt(t.total), fmt(t.sms), fmt(t.email), fmt(t.push), `${t.deliveryRate}%`])} empty="No tenant usage in this period." />
          <Table title="Reminder Performance by Tenant (Top 5)" headers={['Tenant', 'Delivered', 'Delivery %', 'Open Rate']} rows={data.performanceByTenant.map((t) => [t.tenant, fmt(t.delivered), `${t.deliveryRate}%`, 'Not tracked'])} empty="No performance data yet." />
        </div>
        <div style={{ ...card, padding: 16, marginTop: 14 }}>
          <TableInner title="Delivery Failures & Problematic Reminders" headers={['Tenant', 'Channel', 'Failure Reason', 'Status', 'Time']} rows={data.deliveryFailures.map((f) => [f.tenant, f.channel, f.reason, f.status, new Date(f.time).toLocaleTimeString()])} empty="No delivery failures in this period." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
          <Table title="Recent Reminder Activity" headers={['Tenant', 'Channel', 'Status', 'Time']} rows={data.recentActivity.map((a) => [a.tenant, a.channel, a.status, new Date(a.time).toLocaleTimeString()])} empty="No recent activity." />
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Upcoming Reminder Jobs</div><div style={{ color: MUTED, fontSize: 12 }}>Scheduled jobs are not tracked yet — this will populate once a reminder scheduler is modelled.</div></div>
        </div>

        {/* quick actions */}
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Quick Actions</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {QUICK_ACTIONS.map((a) => (<button key={a} onClick={() => (a === 'Create Reminder' ? openTemplates() : a === 'Configure Timing' ? openTiming() : a === 'Tenant Customization' ? openCustomization() : a === 'View Failures' ? openFlow() : a === 'Set Channels' ? openChannels() : a === 'Enable by Plan' ? openPlanFeatures() : a === 'Export Report' ? doExport() : setModal(a))} style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: '10px 6px', background: '#fff', fontSize: 10.5, fontWeight: 600, color: TEXT, cursor: 'pointer', minHeight: 54 }}>{a}</button>))}
          </div>
        </div>

        {/* at-a-glance */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>At-a-Glance Summary (Today)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            <Glance label="Reminders Sent Today" value={fmt(data.atAGlance.sentToday)} color={ORANGE} />
            <Glance label="Successful Deliveries" value={fmt(data.atAGlance.successfulToday)} color="#3E8F57" />
            <Glance label="Failed Sends" value={fmt(data.atAGlance.failedToday)} color="#D14343" />
            <Glance label="Fallback Sends" value="Not tracked" color="#C08A2E" muted />
            <Glance label="Avg Open Rate" value="Not tracked" color="#8B5CF6" muted />
            <Glance label="Tenants Using Reminders" value={fmt(data.atAGlance.tenantsUsingReminders)} color="#3B82F6" />
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 12 }}>
          <button onClick={() => nav('/smart-reminders/performance')} style={{ border: 'none', background: 'none', color: ORANGE, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Open Reminder Performance view →</button>
        </div>
      </div>

      {pfOpen ? (
        <div role="dialog" aria-label="Enable Reminders by Subscription Plan" onClick={() => setPfOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 520, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Enable Reminders by Subscription Plan</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Per-plan capability matrix — enforced on the backend before a tenant can use a reminder capability. Enabled / trial / grandfathered permit; disabled / add-on / approval block.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Plan code<input aria-label="Plan code" value={pfForm.planCode} onChange={(e) => { setPfForm((f) => ({ ...f, planCode: e.target.value })); loadPlanFeatures(e.target.value); }} placeholder="e.g. premium" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Feature<select aria-label="Plan feature" value={pfForm.featureKey} onChange={(e) => setPfForm((f) => ({ ...f, featureKey: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['smart_reminders', ...REMINDER_TYPE_OPTIONS.map((o) => o.key), 'sms', 'email', 'push', 'multi_step', 'fallback', 'tenant_customization', 'custom_timing', 'custom_templates', 'analytics'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>State<select aria-label="Plan feature state" value={pfForm.state} onChange={(e) => setPfForm((f) => ({ ...f, state: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['enabled', 'disabled', 'trial', 'add_on', 'approval', 'grandfathered'].map((sx) => <option key={sx} value={sx}>{sx}</option>)}</select></label>
              </div>
              {pfList.length ? (
                <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, maxHeight: 160, overflowY: 'auto' }}>
                  {pfList.map((f) => (<div key={f.featureKey} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}><span style={{ color: TEXT }}>{f.featureKey}</span><span style={{ marginLeft: 'auto', fontWeight: 700, color: f.allowed ? SEM.good : SEM.bad }}>{f.state}</span></div>))}
                </div>
              ) : null}
              {pfMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700 }}>{pfMsg}</div> : null}
              {pfErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{pfErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setPfOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
                <button onClick={savePlanFeature} disabled={pfBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: pfBusy ? 'default' : 'pointer', opacity: pfBusy ? 0.7 : 1 }}>{pfBusy ? 'Saving…' : 'Save plan feature'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {chOpen ? (
        <div role="dialog" aria-label="Set Channels and Fallback" onClick={() => setChOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 480, maxWidth: '94vw' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Set Channels &amp; Fallback</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>The backend decides the delivery order. Fallback stops on the first success — no duplicate sends.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reminder type<select aria-label="Channel reminder type" value={chForm.reminderType} onChange={(e) => loadChannels(e.target.value)} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{REMINDER_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Primary channel<select aria-label="Primary channel" value={chForm.primaryChannel} onChange={(e) => setChForm((f) => ({ ...f, primaryChannel: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['sms', 'email', 'push'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <div style={{ fontSize: 11.5, color: '#5C5240' }}>Fallback channels (in order)
                <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                  {['sms', 'email', 'push'].filter((c) => c !== chForm.primaryChannel).map((c) => (
                    <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}><input type="checkbox" aria-label={`Fallback ${c}`} checked={chForm.fallbackChannels.includes(c)} onChange={() => toggleFallback(c)} />{c}</label>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, background: '#F7F4EE', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8 }}>Delivery order: <strong style={{ color: TEXT }}>{sequencePreview.join(' → ')}</strong></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT }}><input type="checkbox" aria-label="Stop on success" checked={chForm.stopOnSuccess} onChange={(e) => setChForm((f) => ({ ...f, stopOnSuccess: e.target.checked }))} />Stop on first success (recommended)</label>
              {chMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700 }}>{chMsg}</div> : null}
              {chErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{chErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setChOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
                <button onClick={saveChannels} disabled={chBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: chBusy ? 'default' : 'pointer', opacity: chBusy ? 0.7 : 1 }}>{chBusy ? 'Saving…' : 'Save channels'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {fsOpen ? (
        <div role="dialog" aria-label="Disable Problematic Reminders" onClick={() => setFsOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 480, maxWidth: '94vw' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Disable Problematic Reminders</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Disabling stops new jobs for this reminder flow and preserves all history. A reason is required.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reminder flow<select aria-label="Flow reminder type" value={fsForm.reminderType} onChange={(e) => loadFlow(e.target.value)} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{REMINDER_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              <div style={{ fontSize: 11.5, color: MUTED }}>Current status: <strong style={{ color: fsState?.status === 'active' || !fsState ? SEM.good : SEM.bad }}>{fsState?.status ?? 'active'}</strong>{fsState?.reason ? ` — ${fsState.reason}` : ''}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Target status<select aria-label="Target status" value={fsForm.status} onChange={(e) => setFsForm((f) => ({ ...f, status: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['disabled', 'paused', 'under_review'].map((sx) => <option key={sx} value={sx}>{sx}</option>)}</select></label>
              </div>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reason (required)<textarea aria-label="Disable reason" value={fsForm.reason} onChange={(e) => setFsForm((f) => ({ ...f, reason: e.target.value }))} rows={2} placeholder="e.g. Excessive delivery failures on carrier" style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit' }} /></label>
              {fsMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700 }}>{fsMsg}</div> : null}
              {fsErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{fsErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                <button onClick={enableFlow} disabled={fsBusy || (fsState?.status ?? 'active') === 'active'} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: fsBusy || (fsState?.status ?? 'active') === 'active' ? 'default' : 'pointer', opacity: (fsState?.status ?? 'active') === 'active' ? 0.5 : 1 }}>Re-enable</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setFsOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
                  <button onClick={disableFlow} disabled={fsBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: SEM.bad, color: '#fff', fontWeight: 700, cursor: fsBusy ? 'default' : 'pointer', opacity: fsBusy ? 0.7 : 1 }}>{fsBusy ? 'Saving…' : 'Disable flow'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tcOpen ? (
        <div role="dialog" aria-label="Allow Tenant Customization" onClick={() => setTcOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Allow Tenant Customization</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Overrides are bounded by the platform default — timing must stay inside the allowed range and channels must be supported.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Tenant<select aria-label="Customization tenant" value={tcForm.tenantId} onChange={(e) => loadEffective(e.target.value, tcForm.reminderType)} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}><option value="">Select…</option>{data.tenantUsage.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reminder type<select aria-label="Customization reminder type" value={tcForm.reminderType} onChange={(e) => loadEffective(tcForm.tenantId, e.target.value)} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{REMINDER_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              </div>
              {tcEff ? (
                <div style={{ fontSize: 11, color: MUTED, background: '#F7F4EE', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8 }}>
                  Platform default: {tcEff.platform ? `${tcEff.platform.direction} ${tcEff.platform.offsetMinutes}m (allowed ${tcEff.platform.min}–${tcEff.platform.max}m)` : 'none set'} · Effective: {tcEff.effective.offsetMinutes}m ({tcEff.effective.offsetSource})
                </div>
              ) : null}
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Offset override (min, blank = inherit){tcEff?.effective.allowedBand ? <span style={{ color: MUTED }}> · allowed {tcEff.effective.allowedBand.min}–{tcEff.effective.allowedBand.max}</span> : null}<input aria-label="Override offset" value={tcForm.offsetMinutes} onChange={(e) => setTcForm((f) => ({ ...f, offsetMinutes: e.target.value }))} inputMode="numeric" placeholder="inherit" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Channels override (comma-separated: sms, email, push; blank = inherit)<input aria-label="Override channels" value={tcForm.channels} onChange={(e) => setTcForm((f) => ({ ...f, channels: e.target.value }))} placeholder="inherit" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
              {tcMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700 }}>{tcMsg}</div> : null}
              {tcErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{tcErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                <button onClick={revertOverride} disabled={tcBusy || !tcEff?.override} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: tcBusy || !tcEff?.override ? 'default' : 'pointer', opacity: !tcEff?.override ? 0.5 : 1 }}>Revert to default</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setTcOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
                  <button onClick={saveOverride} disabled={tcBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: tcBusy ? 'default' : 'pointer', opacity: tcBusy ? 0.7 : 1 }}>{tcBusy ? 'Saving…' : 'Save customization'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tmOpen ? (
        <div role="dialog" aria-label="Configure Default Timing" onClick={() => setTmOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Configure Default Timing</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Per reminder type. The allowed range is enforced on the backend for tenant customizations and scheduling.</div>
            {tmSaved ? (
              <div><div style={{ fontSize: 12.5, color: '#3E8F57', fontWeight: 700, marginBottom: 8 }}>Timing saved.</div><div style={{ textAlign: 'right' }}><button onClick={() => setTmOpen(false)} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Done</button></div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reminder type<select aria-label="Timing reminder type" value={tmForm.reminderType} onChange={(e) => loadTiming(e.target.value)} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{REMINDER_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Direction<select aria-label="Direction" value={tmForm.direction} onChange={(e) => setTmForm((f) => ({ ...f, direction: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['before', 'after', 'immediate'].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Offset (min)<input aria-label="Offset minutes" value={tmForm.offsetMinutes} onChange={(e) => setTmForm((f) => ({ ...f, offsetMinutes: e.target.value }))} disabled={tmForm.direction === 'immediate'} inputMode="numeric" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px', opacity: tmForm.direction === 'immediate' ? 0.5 : 1 }} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Min offset<input aria-label="Min offset" value={tmForm.minOffsetMinutes} onChange={(e) => setTmForm((f) => ({ ...f, minOffsetMinutes: e.target.value }))} inputMode="numeric" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Max offset<input aria-label="Max offset" value={tmForm.maxOffsetMinutes} onChange={(e) => setTmForm((f) => ({ ...f, maxOffsetMinutes: e.target.value }))} inputMode="numeric" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Quiet start (min of day)<input aria-label="Quiet start" value={tmForm.quietHoursStart} onChange={(e) => setTmForm((f) => ({ ...f, quietHoursStart: e.target.value }))} inputMode="numeric" placeholder="none" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Quiet end (min of day)<input aria-label="Quiet end" value={tmForm.quietHoursEnd} onChange={(e) => setTmForm((f) => ({ ...f, quietHoursEnd: e.target.value }))} inputMode="numeric" placeholder="none" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Quiet-hour policy<select aria-label="Quiet policy" value={tmForm.quietHoursPolicy} onChange={(e) => setTmForm((f) => ({ ...f, quietHoursPolicy: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['defer', 'skip', 'send'].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                  <label style={{ fontSize: 11.5, color: '#5C5240' }}>Timezone source<select aria-label="Timezone source" value={tmForm.timezoneSource} onChange={(e) => setTmForm((f) => ({ ...f, timezoneSource: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['tenant', 'branch', 'customer'].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                </div>
                {tmErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{tmErr}</div> : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setTmOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveTiming} disabled={tmBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: tmBusy ? 'default' : 'pointer', opacity: tmBusy ? 0.7 : 1 }}>{tmBusy ? 'Saving…' : 'Save timing'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tplOpen ? (
        <div role="dialog" aria-label="Reminder Templates" onClick={() => setTplOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 580, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Global Reminder Templates</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Bound to a reminder type. Editing creates a new version; published versions are never overwritten.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {tplList.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No templates yet.</div> : tplList.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: TEXT }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>{REMINDER_TYPE_OPTIONS.find((o) => o.key === t.reminder_type)?.label ?? t.reminder_type} · v{t.current_version || '—'} · {t.versions} version{t.versions === 1 ? '' : 's'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: t.status === 'published' ? SEM.good : MUTED }}>{t.status}</span>
                  {t.status !== 'published' ? <button onClick={() => publishTpl(t)} style={{ height: 26, padding: '0 10px', border: 'none', borderRadius: 6, background: ORANGE, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Publish</button> : null}
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: TEXT }}>New template</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Name<input aria-label="Template name" value={tplForm.name} onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reminder type<select aria-label="Reminder type" value={tplForm.reminderType} onChange={(e) => setTplForm((f) => ({ ...f, reminderType: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{REMINDER_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              </div>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>SMS content (use {'{{name}}'} placeholders)<textarea aria-label="SMS content" value={tplForm.sms} onChange={(e) => { setTplForm((f) => ({ ...f, sms: e.target.value })); setTplPreview(null); }} rows={2} style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Email body (optional)<textarea aria-label="Email body" value={tplForm.emailBody} onChange={(e) => { setTplForm((f) => ({ ...f, emailBody: e.target.value })); setTplPreview(null); }} rows={2} style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit' }} /></label>
              {tplPreview != null ? <div style={{ fontSize: 12, background: '#F7F4EE', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, color: TEXT }}>Preview: {tplPreview}</div> : null}
              {tplErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{tplErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={doPreview} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Preview</button>
                <button onClick={createTpl} disabled={tplBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: tplBusy ? 'default' : 'pointer', opacity: tplBusy ? 0.7 : 1 }}>{tplBusy ? 'Saving…' : 'Create template'}</button>
              </div>
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}><button onClick={() => setTplOpen(false)} style={{ height: 32, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button></div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div role="dialog" aria-label={modal} onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 420, maxWidth: '92vw' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: TEXT }}>{modal}</div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>This is a permissioned, audited workflow. The oversight dashboard is live and reconciles from real reminder data; this specific workflow is delivered in an upcoming unit of the Smart Reminders build.</div>
            <div style={{ marginTop: 16, textAlign: 'right' }}><button onClick={() => setModal(null)} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return <div style={{ ...card, padding: 16 }}><TableInner title={title} headers={headers} rows={rows} empty={empty} /></div>;
}
function TableInner({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? <div style={{ color: MUTED, fontSize: 12, padding: '12px 0' }}>{empty}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{headers.map((h) => <th key={h} style={{ textAlign: 'left', color: MUTED, fontWeight: 600, padding: '6px 8px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '7px 8px', borderBottom: `1px solid ${LINE}`, color: TEXT, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</td>)}</tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function Glance({ label, value, color, muted }: { label: string; value: string; color: string; muted?: boolean }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}1A`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Dot color={color} /></span><span style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{label}</span></div>
      <div style={{ fontSize: 14, fontWeight: 500, color: muted ? '#C62B3F' : TEXT }}>{value}</div>
    </div>
  );
}
