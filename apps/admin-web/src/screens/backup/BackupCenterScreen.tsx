// BackupCenterScreen.tsx — G9 Enterprise Backup & Disaster Recovery (Nov 5 2026): Super Admin → Backup & Disaster
// Recovery. English only (§15). Every number comes from the recovery catalog the server keeps — a dash while it loads,
// "Not reported" when the backup job has never reported, never an invented status (§16, §44).
//   Overview  — latest RECOVERABLE (verified) time, missed midnight checkpoint, RPO evidence, last restore test, storage.
//   Restore Center — search salon → scope → a VERIFIED point (others disabled) → reason → Preview impact (dry run) →
//                    a second operator approves (finance confirmation when money moved after that time) → Begin restore.
//   Restore Jobs — the real job states and their recorded events; no fake percentage.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { superAdminBackupsApi as api } from '../../api/superAdminBackupsApi';

const dash = (v: unknown) => (v == null || v === '' ? '—' : String(v));
const errText = (e: any, d: string) => e?.body?.message || e?.message || d;
const TZ = 'America/New_York';
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) + ' ET' : '—');
const bytes = (n: number | null | undefined) => (n == null ? '—' : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const key = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const MODES = [
  { id: 'NON_DESTRUCTIVE_PREVIEW', label: 'Compare only (no changes)' },
  { id: 'FULL_TENANT', label: 'Whole salon (all branches)' },
  { id: 'ONE_BRANCH', label: 'One branch' },
];
const STATUS_TONE: Record<string, string> = { VERIFIED: 'text-emerald-700', COMPLETED: 'text-emerald-700', FAILED: 'text-red-700', BLOCKED: 'text-amber-700', PARTIAL: 'text-amber-700', UNVERIFIED: 'text-[#7A6C57]', EXPIRED: 'text-[#7A6C57]' };
const Card = ({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) => (
  <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm" data-testid={testId}>
    <div className="text-xs text-[#7A6C57]">{label}</div><div className="mt-1 text-xl font-bold">{value}</div>{sub ? <div className="mt-1 text-xs text-[#7A6C57]">{sub}</div> : null}
  </div>);
const Btn = (p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'danger' }) => (
  <button {...p} className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${p.tone === 'danger' ? 'bg-red-700 text-white' : p.tone === 'primary' ? 'bg-[var(--gold,#B8892B)] text-white' : 'border border-[var(--line)] bg-white'}`} />);

export function BackupCenterScreen() {
  const [tab, setTab] = useState<'overview' | 'restore' | 'jobs'>('overview');
  return (
    <div className="space-y-4 p-4" data-testid="backup-center">
      <div><h1 className="text-2xl font-bold">Backup &amp; Disaster Recovery</h1>
        <p className="text-sm text-[#7A6C57]">Times are shown in Eastern Time ({TZ}). Only recovery points a real restore test verified can be restored.</p></div>
      <div className="flex gap-2" role="tablist">
        {(['overview', 'restore', 'jobs'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ${tab === t ? 'bg-[#2B2116] text-white' : 'border border-[var(--line)] bg-white'}`}>
            {t === 'overview' ? 'Overview' : t === 'restore' ? 'Restore Center' : 'Restore Jobs'}</button>))}
      </div>
      {tab === 'overview' ? <Overview /> : tab === 'restore' ? <RestoreCenter onStarted={() => setTab('jobs')} /> : <Jobs />}
    </div>);
}

function Overview() {
  const [o, setO] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.overview().then(setO).catch((e) => setErr(errText(e, 'Could not load the backup overview.'))); }, []);
  if (err) return <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</div>;
  if (!o) return <div className="text-sm text-[#7A6C57]">Loading…</div>;
  if (!o.catalogConfigured) return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm" data-testid="backup-not-reported">
      <b>Not reported.</b> No backup job has reported a recovery point yet, so nothing can be restored from this screen.
      Connect the provider backup job (docs/backup/BACKUP_AND_DR.md §2).</div>);
  const missed = o.schedule?.missed?.missed;
  return (
    <div className="space-y-3">
      {missed ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800" data-testid="midnight-missed">The 12:00 AM checkpoint for {fmt(o.schedule.missed.scheduledAt)} was not reported.</div> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card testId="latest-recoverable" label="Latest recoverable time" value={fmt(o.points.latestRecoverableTimestamp)} sub={o.evidence.rpoSeconds == null ? 'No verified point' : `RPO now: ${Math.round(o.evidence.rpoSeconds / 60)} min`} />
        <Card label="Last full-platform point" value={fmt(o.points.lastPlatformPoint?.recoveryTimestamp)} sub={dash(o.points.lastPlatformPoint?.verificationStatus)} />
        <Card label="Next midnight checkpoint" value={fmt(o.schedule.nextMidnightCheckpoint)} />
        <Card label="Last restore test" value={fmt(o.evidence.lastRestoreDrill?.completedAt)} sub={o.evidence.lastRestoreDrill ? `${o.evidence.lastRestoreDrill.status}${o.evidence.lastRestoreDrill.durationSeconds != null ? ` · ${o.evidence.lastRestoreDrill.durationSeconds}s` : ''}` : 'Never reported'} />
        <Card label="Salons protected" value={`${dash(o.tenants.protectedByLatestVerifiedPlatformPoint)} / ${dash(o.tenants.total)}`} sub="by the latest verified platform point" />
        <Card label="Last 7 days" value={`${o.points.last7Days.recorded} points`} sub={`${o.points.last7Days.failed} failed · ${o.points.last7Days.unverified} unverified`} />
        <Card label="Verified without immutable copy" value={String(o.points.verifiedWithoutImmutableCopy)} />
        <Card label="Catalogued backup storage" value={bytes(o.points.storageBytes)} sub={o.pitr ? `PITR ${fmt(o.pitr.windowStart)} – ${fmt(o.pitr.windowEnd)}` : 'No verified PITR window'} />
      </div>
    </div>);
}

function RestoreCenter({ onStarted }: { onStarted: () => void }) {
  const [q, setQ] = useState(''); const [found, setFound] = useState<any[] | null>(null);
  const [tenant, setTenant] = useState<any | null>(null); const [branchId, setBranchId] = useState('');
  const [mode, setMode] = useState('NON_DESTRUCTIVE_PREVIEW');
  const [points, setPoints] = useState<any | null>(null); const [pointId, setPointId] = useState(''); const [target, setTarget] = useState('');
  const [reason, setReason] = useState(''); const [plan, setPlan] = useState<any | null>(null); const [finance, setFinance] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [reqKey, setReqKey] = useState(key());
  const search = async () => { setErr(null); try { setFound((await api.tenants(q)).items); } catch (e) { setErr(errText(e, 'Search failed.')); } };
  const loadPoints = useCallback(() => { if (!tenant) return; api.points(tenant.id, branchId || undefined).then(setPoints).catch((e) => setErr(errText(e, 'Could not load recovery points.'))); }, [tenant, branchId]);
  useEffect(() => { loadPoints(); }, [loadPoints]);
  const point = useMemo(() => points?.items?.find((p: any) => p.id === pointId) ?? null, [points, pointId]);
  const reset = () => { setPlan(null); setReqKey(key()); };
  const preview = async () => {
    if (!tenant || !point) return; setBusy(true); setErr(null);
    try {
      setPlan(await api.createPlan({ mode, tenantId: tenant.id, branchId: mode === 'FULL_TENANT' ? null : branchId || null, recoveryPointId: point.id,
        targetTimestamp: point.source === 'pitr_window' && target ? new Date(target).toISOString() : null, reason, idempotencyKey: reqKey }));
    } catch (e) { setErr(errText(e, 'The preview could not be created.')); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<any>, after?: () => void) => { setBusy(true); setErr(null); try { setPlan(await fn()); after?.(); } catch (e) { setErr(errText(e, 'That did not work.')); } finally { setBusy(false); } };
  const needsFinance = Number(plan?.plan?.financialEventsAfterTarget ?? 0) > 0;
  return (
    <div className="space-y-4">
      {err ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <h2 className="font-semibold">1. Find the salon</h2>
        <div className="flex gap-2"><input aria-label="Search salon" className="min-h-[44px] flex-1 rounded-xl border border-[var(--line)] px-3" placeholder="Salon name, tenant ID, store code or branch" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} /><Btn onClick={() => void search()}>Search</Btn></div>
        {found ? (found.length ? <ul className="divide-y">{found.map((t) => (
          <li key={t.id}><button className="min-h-[44px] w-full text-left text-sm" onClick={() => { setTenant(t); setBranchId(''); setPointId(''); reset(); }}>{t.name} <span className="text-[#7A6C57]">· {dash(t.tenantCode)} · {t.branches.length} branch(es)</span>{tenant?.id === t.id ? ' ✓' : ''}</button></li>))}</ul>
          : <div className="text-sm text-[#7A6C57]">No salon matches.</div>) : null}
      </section>
      {tenant ? (
        <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="font-semibold">2. Scope and recovery point — {tenant.name}</h2>
          <div className="flex flex-wrap gap-2">{MODES.map((m) => <label key={m.id} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-sm"><input type="radio" name="mode" checked={mode === m.id} onChange={() => { setMode(m.id); reset(); }} />{m.label}</label>)}</div>
          {mode !== 'FULL_TENANT' ? (
            <select aria-label="Branch" className="min-h-[44px] rounded-xl border border-[var(--line)] px-3" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPointId(''); reset(); }}>
              <option value="">{mode === 'ONE_BRANCH' ? 'Choose a branch' : 'All branches'}</option>{tenant.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}{b.salonCode ? ` (${b.salonCode})` : ''}</option>)}
            </select>) : null}
          <div className="text-xs text-[#7A6C57]">Days with verified coverage: {points?.calendar?.length ? points.calendar.slice(0, 14).map((d: any) => `${d.date}${d.pitr ? ' (PITR)' : ''}`).join(', ') : 'none'}</div>
          <ul className="max-h-64 divide-y overflow-auto" data-testid="recovery-points">
            {(points?.items ?? []).map((p: any) => {
              const usable = p.verificationStatus === 'VERIFIED';
              return (<li key={p.id}><label className={`flex min-h-[44px] items-center gap-2 text-sm ${usable ? '' : 'opacity-60'}`}>
                <input type="radio" name="point" disabled={!usable} checked={pointId === p.id} onChange={() => { setPointId(p.id); reset(); }} />
                <span>{p.source === 'pitr_window' ? `PITR ${fmt(p.pitrWindowStart)} – ${fmt(p.pitrWindowEnd)}` : fmt(p.recoveryTimestamp)} · {p.scope}</span>
                <span className={`font-semibold ${STATUS_TONE[p.verificationStatus] ?? ''}`}>{p.verificationStatus}</span>{p.immutableReplica !== 'present' ? <span className="text-xs text-amber-700">no immutable copy</span> : null}
              </label></li>);
            })}
            {points && !points.items.length ? <li className="text-sm text-[#7A6C57]">No recovery points cover this salon.</li> : null}
          </ul>
          {point?.source === 'pitr_window' ? <label className="block text-sm">Restore to (your local time; converted exactly)<input type="datetime-local" className="ml-2 min-h-[44px] rounded-xl border border-[var(--line)] px-3" value={target} onChange={(e) => { setTarget(e.target.value); reset(); }} /></label> : null}
          <textarea aria-label="Reason" className="min-h-[88px] w-full rounded-xl border border-[var(--line)] p-3 text-sm" placeholder="Reason (at least 10 characters, recorded)" value={reason} onChange={(e) => { setReason(e.target.value); reset(); }} />
          <Btn tone="primary" disabled={busy || !point || reason.trim().length < 10 || (mode === 'ONE_BRANCH' && !branchId)} onClick={() => void preview()}>Preview impact</Btn>
        </section>) : null}
      {plan ? (
        <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4" data-testid="restore-plan">
          <h2 className="font-semibold">3. Plan <span className={STATUS_TONE[plan.status] ?? ''}>{plan.status}</span></h2>
          <div className="text-xs text-[#7A6C57]">Plan checksum {plan.planSha256.slice(0, 12)}… · restore time {fmt(plan.targetTimestamp)} · schema {dash(plan.plan.point.schemaVersion)} (current {dash(plan.plan.currentSchemaVersion)})</div>
          {plan.plan.blockers.map((b: any) => <div key={b.code} className="rounded-xl bg-red-50 p-2 text-sm text-red-800"><b>{b.code}</b> — {b.message}</div>)}
          {plan.plan.warnings.map((w: any) => <div key={w.code} className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900"><b>{w.code}</b> — {w.message}</div>)}
          {plan.status === 'AWAITING_APPROVAL' ? (<>
            {needsFinance ? <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={finance} onChange={(e) => setFinance(e.target.checked)} />The payments, payouts and ledger entries after this time were reviewed with finance.</label> : null}
            <div className="text-xs text-[#7A6C57]">{plan.mode === 'NON_DESTRUCTIVE_PREVIEW' ? 'A comparison never changes data.' : 'A different Super Admin must approve this plan.'} Approval lasts 30 minutes.</div>
            <div className="flex gap-2"><Btn tone="primary" disabled={busy || (needsFinance && !finance)} onClick={() => void act(() => api.approve(plan.id, plan.planSha256, finance))}>Approve plan</Btn>
              <Btn disabled={busy} onClick={() => void act(() => api.cancel(plan.id, 'Cancelled from the Restore Center'))}>Cancel</Btn></div></>) : null}
          {plan.status === 'APPROVED' ? <Btn tone="danger" disabled={busy} onClick={() => void act(() => api.execute(plan.id, plan.planSha256), onStarted)}>{plan.mode === 'NON_DESTRUCTIVE_PREVIEW' ? 'Begin comparison' : 'Begin restore'}</Btn> : null}
        </section>) : null}
    </div>);
}

function Jobs() {
  const [list, setList] = useState<any | null>(null); const [open, setOpen] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.plans({}).then(setList).catch((e) => setErr(errText(e, 'Could not load restore jobs.'))); }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  return (
    <div className="space-y-3">
      {err ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      <table className="w-full text-sm" data-testid="restore-jobs"><thead><tr className="text-left text-[#7A6C57]"><th>Created</th><th>Mode</th><th>Status</th><th>Reason code</th><th /></tr></thead>
        <tbody>{(list?.items ?? []).map((p: any) => (
          <tr key={p.id} className="border-t border-[var(--line)]"><td>{fmt(p.createdAt)}</td><td>{p.mode}</td><td className={`font-semibold ${STATUS_TONE[p.status] ?? ''}`}>{p.status}</td><td>{dash(p.failureCode)}</td>
            <td><Btn onClick={() => api.plan(p.id).then(setOpen).catch((e) => setErr(errText(e, 'Could not load the job.')))}>Details</Btn></td></tr>))}
          {list && !list.items.length ? <tr><td colSpan={5} className="py-3 text-[#7A6C57]">No restore plans yet.</td></tr> : null}</tbody></table>
      {open ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm" data-testid="restore-job-detail">
          <div className="font-semibold">{open.mode} · {open.status}</div>
          {open.failureDetail ? <div className="mt-1 text-amber-800">{open.failureDetail}</div> : null}
          <ol className="mt-2 list-decimal pl-5">{open.events.map((e: any, i: number) => <li key={i}>{fmt(e.at)} — {e.from ? `${e.from} → ` : ''}{e.to} ({e.action}{e.actor ? `, ${e.actor}` : ''})</li>)}</ol>
          {open.evidence?.tables ? <div className="mt-2">Compared {open.evidence.tables.length} tables · {open.evidence.differing.length} differ · live rows {open.evidence.totals.live} / staged rows {open.evidence.totals.staged} · live database written: {open.evidence.liveWritten ? 'yes' : 'no'}</div> : null}
        </div>) : null}
    </div>);
}
