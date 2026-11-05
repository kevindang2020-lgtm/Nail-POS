// SmsVerificationPackagesScreen.tsx — Super Admin → SMS Verification Packages (spec §3-§5 + §44, P4).
// Two sections, one screen (Kevin's §3: one area, no duplicate sidebar modules):
//   1) The three packages (§4 table), each with an inline §5 edit expander — every number Super Admin controls
//      lives here; prices type as dollars and travel as integer cents.
//   2) The §44 all-tenants usage table with filter chips and a per-row expander for Assign Package (reason
//      required; effective immediate / next cycle / default per §28) and Add Credit (§29).
// Honest rendering: tenants without a package show "—", never fabricated zeros presented as billing truth.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { superAdminSmsApi, type SmsPackage, type TenantPlanRow, type TenantPlanDetail, type ReconFinding, type SmsAnalytics, type SmsChargesFeed, type SmsControls } from '../api/superAdminSmsApi';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { useCan } from '../auth/useCan';

const fmtUsd = (cents: number | null | undefined) => cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString() : '—';

type Filter = 'all' | 'no_package' | 'near_limit' | 'over_limit' | 'hard_limit';

export default function SmsVerificationPackagesScreen() {
  const [packages, setPackages] = useState<SmsPackage[]>([]);
  const [tenants, setTenants] = useState<TenantPlanRow[]>([]);
  const [findings, setFindings] = useState<ReconFinding[]>([]);
  const [analytics, setAnalytics] = useState<SmsAnalytics | null>(null);
  const [charges, setCharges] = useState<SmsChargesFeed | null>(null);
  const [controls, setControls] = useState<SmsControls | null>(null);
  const [defaultPkg, setDefaultPkg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // SCAN (Oct 12 2026): reconciliation findings need sms_usage.view and the billing feeds sms_billing.view — a role without
  // them (PLATFORM_BILLING_ADMIN) was refused one read and the Promise.all turned the WHOLE screen into an error page.
  const can = useCan(); const mayUsage = can('super_admin.sms_usage.view'), mayBilling = can('super_admin.sms_billing.view');
  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, t, f, a, ch, ctl, dp] = await Promise.all([superAdminSmsApi.listPackages(), superAdminSmsApi.listTenantPlans(),
        mayUsage ? superAdminSmsApi.listFindings() : Promise.resolve({ findings: [] }),
        mayBilling ? superAdminSmsApi.analytics() : Promise.resolve(null), mayBilling ? superAdminSmsApi.charges() : Promise.resolve(null),
        superAdminSmsApi.getControls(), superAdminSmsApi.getDefaultPackage()]);
      setPackages(p.packages);
      setTenants(t.tenants);
      setFindings(f.findings);
      setAnalytics(a);
      setCharges(ch);
      setControls(ctl);
      setDefaultPkg(dp.defaultPackageCode);
    } catch (e) {
      setLoadError('Could not load SMS package data. Check your connection and permissions, then retry.');
    } finally { setLoading(false); }
  }, [mayUsage, mayBilling]);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="work sa-sms-packages" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      <div className="vh flex flex-col xl:flex-row justify-between gap-3">
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            SMS Verification Packages
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 12.5, marginTop: 3 }}>
            Three Super Admin–controlled packages for tenant SMS verification. Pricing is data, not code — edit any number here, no deploy needed.
          </p>
        </div>
      </div>
      
      {note && <div className="inline-note" role="status" style={{ background: '#FFF9EF', border: '1px solid #E2C686', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#8B5A18' }}>{note}</div>}
      {loadError && <div className="inline-note error" role="alert" style={{ background: '#FBEAEA', border: '1px solid #F0C9C9', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{loadError} <button style={btn(false, false)} onClick={() => { setLoading(true); void refresh(); }}>Retry</button></div>}
      
      {loading ? <div className="loading" style={{ padding: 24, fontSize: 13, color: 'var(--muted)' }}>Loading…</div> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
            <MasterControlsSection controls={controls} onActed={(msg) => { setNote(msg); void refresh(); }} />
            <DefaultPackageSection current={defaultPkg} packages={packages} onActed={(msg) => { setNote(msg); void refresh(); }} />
          </div>
          
          <PackagesSection packages={packages} onSaved={(msg) => { setNote(msg); void refresh(); }} />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
            <RevenueSection analytics={analytics} charges={charges} />
            <FindingsSection findings={findings} onActed={(msg) => { setNote(msg); void refresh(); }} />
          </div>
          
          <TenantUsageSection tenants={tenants} packages={packages} onActed={(msg) => { setNote(msg); void refresh(); }} />
        </>
      )}
    </div>
  );
}

function PackagesSection({ packages, onSaved }: { packages: SmsPackage[]; onSaved: (msg: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="panel !min-h-[291px]" aria-label="Packages" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Packages</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl()}>
          <thead><tr><th style={th()}>Package</th><th style={th()}>Status</th><th style={thR()}>Monthly Price</th><th style={thR()}>Included</th><th style={thR()}>Overage</th><th style={thR()}>Tenants</th><th style={th()}>Updated</th><th style={th()}>Actions</th></tr></thead>
          <tbody>
            {packages.map((p) => (
              <PackageRow key={p.id} p={p} open={editing === p.id} onToggle={() => setEditing(editing === p.id ? null : p.id)} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PackageRow({ p, open, onToggle, onSaved }: { p: SmsPackage; open: boolean; onToggle: () => void; onSaved: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const toggleActive = async () => {
    setBusy(true);
    try { await superAdminSmsApi.setPackageActive(p.id, !p.active); onSaved(`${p.name} ${p.active ? 'disabled' : 'enabled'}.`); }
    catch { onSaved(`Could not update ${p.name}.`); }
    finally { setBusy(false); }
  };
  return (
    <>
      <tr>
        <td style={td()}><strong>{p.name}</strong><div className="muted" style={{ fontSize: 11 }}>{p.code}</div></td>
        <td style={td()}>{p.active ? <span style={{ ...badgeStyle('#E8F5EC', '#1F7A43', '#BFE3CC') }}>Active</span> : <span style={{ ...badgeStyle('#F3EDE6', '#7A6A57', '#E2D3BF') }}>Disabled</span>}</td>
        <td style={tdR()}>{fmtUsd(p.monthlyPriceCents)}</td>
        <td style={tdR()}>{p.includedVerificationCount.toLocaleString()}</td>
        <td style={tdR()}>{p.overageEnabled ? `${fmtUsd(p.overageUnitPriceCents)}/msg` : (p.hardLimitEnabled ? 'Hard limit' : 'Off')}</td>
        <td style={tdR()}>{p.tenantCount ?? 0}</td>
        <td style={td()}>{fmtDate(p.updatedAt)}</td>
        <td style={td()}>
          <button style={btn(false, false)} onClick={onToggle}>{open ? 'Close' : 'Edit'}</button>{' '}
          <button style={btn(busy, false)} disabled={busy} onClick={() => void toggleActive()}>{p.active ? 'Disable' : 'Enable'}</button>
        </td>
      </tr>
      {open && <tr><td colSpan={8} style={{ padding: '16px', background: '#FAFAFA', borderBottom: '1px solid var(--cream2)' }}><PackageEditor p={p} onSaved={onSaved} /></td></tr>}
    </>
  );
}

function PackageEditor({ p, onSaved }: { p: SmsPackage; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? '');
  const [priceUsd, setPriceUsd] = useState((p.monthlyPriceCents / 100).toFixed(2));
  const [included, setIncluded] = useState(String(p.includedVerificationCount));
  const [overageEnabled, setOverageEnabled] = useState(p.overageEnabled);
  const [overageUsd, setOverageUsd] = useState((p.overageUnitPriceCents / 100).toFixed(2));
  const [hardLimit, setHardLimit] = useState(p.hardLimitEnabled);
  const [warnPct, setWarnPct] = useState(String(p.warningThresholdPercent));
  const [critPct, setCritPct] = useState(String(p.criticalThresholdPercent));
  const [selfService, setSelfService] = useState(p.selfServiceAvailable);
  const [displayOrder, setDisplayOrder] = useState(String(p.displayOrder));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr(null);
    const priceCents = parseDollarsToCents(priceUsd);
    const overageCents = parseDollarsToCents(overageUsd);
    const inc = Number(included); const w = Number(warnPct); const c = Number(critPct); const ord = Number(displayOrder);
    if (priceCents == null || priceCents < 0) { setErr('Monthly price must be a valid dollar amount.'); return; }
    if (overageCents == null || overageCents < 0) { setErr('Overage price must be a valid dollar amount.'); return; }
    if (!Number.isInteger(inc) || inc < 0) { setErr('Included verifications must be a whole number.'); return; }
    if (!Number.isInteger(w) || !Number.isInteger(c) || w < 1 || c > 100 || w >= c) { setErr('Thresholds must be whole percents with warning below critical.'); return; }
    if (!Number.isInteger(ord) || ord < 0) { setErr('Display order must be a whole number.'); return; }
    setBusy(true);
    try {
      const r: any = await superAdminSmsApi.updatePackage(p.id, {
        name: name.trim(), description: description.trim() || null,
        monthly_price_cents: priceCents, included_verification_count: inc,
        overage_enabled: overageEnabled, overage_unit_price_cents: overageCents,
        hard_limit_enabled: hardLimit, warning_threshold_percent: w, critical_threshold_percent: c,
        self_service_available: selfService, display_order: ord,
      });
      if (r && r.ok === false) { setErr(r.message || r.error || 'Save failed.'); return; }
      onSaved(`${name.trim()} saved.`);
    } catch { setErr('Save failed. Nothing was changed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="expander sa-sms-edit" aria-label={`Edit ${p.name}`}>
      <div className="form-grid">
        <label>Package Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label>Monthly Price ($)<input inputMode="decimal" value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} /></label>
        <label>Included Verifications<input inputMode="numeric" value={included} onChange={(e) => setIncluded(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={overageEnabled} onChange={(e) => setOverageEnabled(e.target.checked)} /> Overage Enabled</label>
        <label>Overage Price ($/msg)<input inputMode="decimal" value={overageUsd} onChange={(e) => setOverageUsd(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={hardLimit} onChange={(e) => setHardLimit(e.target.checked)} /> Hard Limit at allowance</label>
        <label>Warning Threshold %<input inputMode="numeric" value={warnPct} onChange={(e) => setWarnPct(e.target.value)} /></label>
        <label>Critical Threshold %<input inputMode="numeric" value={critPct} onChange={(e) => setCritPct(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={selfService} onChange={(e) => setSelfService(e.target.checked)} /> Tenant self-service selectable</label>
        <label>Display Order<input inputMode="numeric" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} /></label>
      </div>
      {err && <div className="inline-note error" role="alert">{err}</div>}
      <button className="btn" disabled={busy} onClick={() => void save()}>Save Package</button>
    </div>
  );
}

function TenantUsageSection({ tenants, packages, onActed }: { tenants: TenantPlanRow[]; packages: SmsPackage[]; onActed: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const filtered = useMemo(() => tenants.filter((t) => {
    if (filter === 'no_package') return !t.packageCode;
    if (filter === 'near_limit') return t.pctUsed != null && t.pctUsed >= 80 && t.overage === 0;
    if (filter === 'over_limit') return t.overage > 0 || (t.pctUsed != null && t.pctUsed >= 100);
    if (filter === 'hard_limit') return t.hardLimit;
    return true;
  }), [tenants, filter]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'no_package', label: 'No Package' },
    { key: 'near_limit', label: 'Near Limit' }, { key: 'over_limit', label: 'Over Limit' },
    { key: 'hard_limit', label: 'Hard Limit' },
  ];

  return (
    <section className="panel !min-h-[291px]" aria-label="Tenant usage" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Tenant Usage</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {chips.map((c) => (
            <button key={c.key} role="tab" aria-selected={filter === c.key} style={btn(false, filter === c.key)} onClick={() => setFilter(c.key)}>{c.label}</button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl()}>
          <thead><tr><th style={th()}>Tenant</th><th style={th()}>Package</th><th style={thR()}>Included</th><th style={thR()}>Used</th><th style={thR()}>%</th><th style={thR()}>Overage</th><th style={thR()}>Est. Bill</th><th style={th()}>Last SMS</th><th style={th()}>Actions</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 16, textAlign: 'center' }}>No tenants match this filter.</td></tr>}
            {filtered.map((t) => (
              <TenantRow key={t.tenantId} t={t} packages={packages} open={openRow === t.tenantId} onToggle={() => setOpenRow(openRow === t.tenantId ? null : t.tenantId)} onActed={onActed} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TenantRow({ t, packages, open, onToggle, onActed }: { t: TenantPlanRow; packages: SmsPackage[]; open: boolean; onToggle: () => void; onActed: (msg: string) => void }) {
  return (
    <>
      <tr>
        <td style={td()}><strong>{t.tenantName}</strong>{t.pendingChange && <span style={{ ...badgeStyle('#FFF6E5', '#D09A36', 'var(--line)'), marginLeft: 8 }}>change pending</span>}</td>
        <td style={td()}>{t.packageName ?? '—'}</td>
        <td style={tdR()}>{t.included == null ? '—' : t.included.toLocaleString()}</td>
        <td style={tdR()}>{t.used == null ? '—' : t.used.toLocaleString()}</td>
        <td style={tdR()}>{t.pctUsed == null ? '—' : `${t.pctUsed}%`}</td>
        <td style={tdR()}>{t.packageCode ? t.overage.toLocaleString() : '—'}</td>
        <td style={tdR()}>{fmtUsd(t.estimatedBillCents)}</td>
        <td style={td()}>{t.lastSmsAt ? new Date(t.lastSmsAt).toLocaleString() : '—'}</td>
        <td style={td()}><button style={btn(false, false)} onClick={onToggle}>{open ? 'Close' : 'Manage'}</button></td>
      </tr>
      {open && <tr><td colSpan={9} style={{ padding: '16px', background: '#FAFAFA', borderBottom: '1px solid var(--cream2)' }}><TenantActions t={t} packages={packages} onActed={onActed} /></td></tr>}
    </>
  );
}

function TenantActions({ t, packages, onActed }: { t: TenantPlanRow; packages: SmsPackage[]; onActed: (msg: string) => void }) {
  const active = packages.filter((p) => p.active);
  // §7: the per-tenant detail — pending change + recent history with reasons — loads when the expander opens.
  const [detail, setDetail] = useState<TenantPlanDetail | null>(null);
  const [usage, setUsage] = useState<{ requestedAt: string; purpose: string; status: string; billable: boolean; recipientMasked: string | null }[] | null>(null);
  useEffect(() => {
    let on = true;
    superAdminSmsApi.tenantPlan(t.tenantId).then((d) => { if (on) setDetail(d); }).catch(() => {});
    superAdminSmsApi.tenantUsage(t.tenantId, 10).then((u) => { if (on) setUsage(u.records); }).catch(() => {});
    return () => { on = false; };
  }, [t.tenantId]);
  const [pkg, setPkg] = useState(active[0]?.id ?? '');
  const [effective, setEffective] = useState<'default' | 'immediate' | 'next_cycle'>('default');
  const [assignReason, setAssignReason] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assign = async () => {
    setErr(null);
    if (!pkg) { setErr('Pick a package.'); return; }
    if (!assignReason.trim()) { setErr('A reason is required for every package change.'); return; }
    setBusy(true);
    try {
      const r: any = await superAdminSmsApi.assignPackage(t.tenantId, { packageId: pkg, reason: assignReason.trim(), ...(effective === 'default' ? {} : { effective }) });
      if (r && r.ok === false) { setErr(r.message || r.error || 'Assignment failed.'); return; }
      onActed(`Package assigned to ${t.tenantName} (${r.effective}).`);
    } catch { setErr('Assignment failed. Nothing was changed.'); }
    finally { setBusy(false); }
  };
  const credit = async () => {
    setErr(null);
    const n = Number(creditAmount);
    if (!Number.isInteger(n) || n <= 0) { setErr('Credit must be a positive whole number of verifications.'); return; }
    if (!creditReason.trim()) { setErr('A reason is required for every manual credit.'); return; }
    setBusy(true);
    try {
      const r: any = await superAdminSmsApi.addCredit(t.tenantId, { amount: n, reason: creditReason.trim() });
      if (r && r.ok === false) { setErr(r.message || r.error || 'Credit failed.'); return; }
      onActed(`+${n} verifications credited to ${t.tenantName} (expires at cycle end).`);
    } catch { setErr('Credit failed. Nothing was changed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="expander sa-sms-tenant-actions">
      <div className="action-block" aria-label="Assign package">
        <h3>Assign Package</h3>
        <select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package">
          {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={effective} onChange={(e) => setEffective(e.target.value as any)} aria-label="Effective">
          <option value="default">Default (downgrades wait for next cycle)</option>
          <option value="immediate">Immediately</option>
          <option value="next_cycle">Next billing cycle</option>
        </select>
        <input placeholder="Reason (required)" value={assignReason} onChange={(e) => setAssignReason(e.target.value)} aria-label="Assign reason" />
        <button className="btn" disabled={busy} onClick={() => void assign()}>Assign</button>
      </div>
      <div className="action-block" aria-label="Add credit">
        <h3>Add SMS Credit</h3>
        <input placeholder="Amount" inputMode="numeric" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} aria-label="Credit amount" />
        <input placeholder="Reason (required)" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} aria-label="Credit reason" />
        <button className="btn" disabled={busy} onClick={() => void credit()}>Add Credit</button>
        <div className="cell-sub">Credit expires at the end of the current billing cycle.</div>
      </div>
      {err && <div className="inline-note error" role="alert">{err}</div>}
      {usage && usage.length > 0 && (
        <div className="action-block" aria-label="Recent usage">
          <h3>Recent Usage</h3>
          <table className="data-table">
            <thead><tr><th>When</th><th>Purpose</th><th>Status</th><th>Billable</th><th>Recipient</th></tr></thead>
            <tbody>
              {usage.map((u, i) => (
                <tr key={i}><td>{new Date(u.requestedAt).toLocaleString()}</td><td>{u.purpose}</td><td>{u.status}</td><td>{u.billable ? 'Yes' : 'No'}</td><td>{u.recipientMasked ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div className="action-block" aria-label="Plan history">
          <h3>Plan History</h3>
          {detail.assignment?.pending && (
            <div className="cell-sub">Pending: {detail.assignment.pending.packageName} effective {new Date(detail.assignment.pending.effectiveAt).toLocaleDateString()}</div>
          )}
          {detail.recentChanges.length === 0 ? <div className="cell-sub">No package changes yet.</div> : (
            <ul className="history-list">
              {detail.recentChanges.slice(0, 3).map((c, i) => (
                <li key={i}>{new Date(c.changedAt).toLocaleDateString()}: {c.from ? `${c.from} → ` : ''}{c.to} — “{c.reason}”</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const FINDING_LABEL: Record<string, string> = {
  counter_ledger_mismatch: 'Counter vs ledger mismatch',
  unbilled_usage_no_package: 'Usage with no package',
  hard_limit_reached: 'Hard limit reached',
};

function FindingsSection({ findings, onActed }: { findings: ReconFinding[]; onActed: (msg: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (findings.length === 0) return (
    <section aria-label="Reconciliation findings"><h2>Reconciliation Findings</h2><p className="cell-sub">No open findings — the nightly reconciliation has nothing flagged.</p></section>
  );
  const act = async (id: string, disposition: 'resolved' | 'dismissed') => {
    setBusy(id);
    try { await superAdminSmsApi.resolveFinding(id, disposition); onActed(`Finding ${disposition}.`); }
    catch { onActed('Could not update the finding.'); }
    finally { setBusy(null); }
  };
  return (
    <section className="panel" aria-label="Reconciliation findings" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Reconciliation Findings</h2>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Filed by the nightly §58 run. Nothing is auto-corrected — review the numbers, fix the cause, then resolve.</p>
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={tbl()}>
          <thead><tr><th style={th()}>Date</th><th style={th()}>Tenant</th><th style={th()}>Finding</th><th style={th()}>Details</th><th style={th()}>Actions</th></tr></thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id}>
                <td style={td()}>{new Date(f.updatedAt).toLocaleDateString()}</td>
                <td style={td()}>{f.tenantName}</td>
                <td style={td()}>{FINDING_LABEL[f.findingType] ?? f.findingType}</td>
                <td style={td()} className="muted">{Object.entries(f.details).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}</td>
                <td style={td()}>
                  <button style={{...btn(busy === f.id, false), marginRight: 6}} disabled={busy === f.id} onClick={() => void act(f.id, 'resolved')}>Resolve</button>
                  <button style={btn(busy === f.id, false)} disabled={busy === f.id} onClick={() => void act(f.id, 'dismissed')}>Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RevenueSection({ analytics, charges }: { analytics: SmsAnalytics | null; charges: SmsChargesFeed | null }) {
  if (!analytics) return null;
  const t = analytics.totals;
  return (
    <section className="panel" aria-label="Revenue and analytics" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Revenue &amp; Analytics — {analytics.month}</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, padding: 16 }}>
        <div style={limCard()}><div className="muted" style={{ fontSize: 11 }}>Subscription Revenue</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{fmtUsd(t.subscriptionRevenueCents)}</div></div>
        <div style={limCard()}><div className="muted" style={{ fontSize: 11 }}>Overage Revenue</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{fmtUsd(t.overageRevenueCents)}</div></div>
        <div style={limCard()}><div className="muted" style={{ fontSize: 11 }}>Provider Cost</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{t.costAvailable ? fmtUsd(t.providerCostCents) : 'Provider Cost Not Available'}</div></div>
        <div style={limCard()}><div className="muted" style={{ fontSize: 11 }}>Gross Margin</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{t.costAvailable ? `${fmtUsd(t.grossMarginCents)} (${t.grossMarginPct}%)` : '—'}</div></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl()}>
          <thead><tr><th style={th()}>Package</th><th style={thR()}>Tenants</th><th style={thR()}>Subscription</th><th style={thR()}>Overage</th><th style={thR()}>SMS Sent</th><th style={thR()}>Failed</th></tr></thead>
          <tbody>
            {analytics.perPackage.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16, textAlign: 'center' }}>No billing cycles this month yet.</td></tr>}
            {analytics.perPackage.map((p) => (
              <tr key={p.packageCode}><td style={td()}>{p.packageName}</td><td style={tdR()}>{p.tenants}</td><td style={tdR()}>{fmtUsd(p.subscriptionRevenueCents)}</td><td style={tdR()}>{fmtUsd(p.overageRevenueCents)}</td><td style={tdR()}>{p.smsSent.toLocaleString()}</td><td style={tdR()}>{p.smsFailed}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {analytics.byPurpose.length > 0 && (
        <div className="muted" style={{ fontSize: 11, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>Usage by purpose: {analytics.byPurpose.map((x) => `${x.purpose} ${x.count}`).join(' · ')}. Statuses: {analytics.byStatus.map((x) => `${x.status} ${x.count}`).join(' · ')}.</div>
      )}
      {/* Sep 2026 merge: the redesign loaded the month's charges but no longer showed them — the billing feed is back */}
      {charges && charges.tenants.length > 0 && (
        <details className="charges-feed" style={{ padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
          <summary>Month charges — billing feed ({fmtUsd(charges.totalCents)} across {charges.tenants.length} tenants; invoice-line shaped for the existing billing engine)</summary>
          <table className="data-table">
            <thead><tr><th>Tenant</th><th>Package</th><th>Base</th><th>Overage</th><th>Total</th></tr></thead>
            <tbody>
              {charges.tenants.map((c) => (
                <tr key={c.tenantId}><td>{c.tenantName}</td><td>{c.packageCode}</td><td>{fmtUsd(c.baseCents)}</td><td>{fmtUsd(c.overageCents)}</td><td>{fmtUsd(c.totalCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

const CONTROL_LABELS: { key: keyof SmsControls; label: string; help: string; danger?: boolean }[] = [
  { key: 'sms.verification_platform_enabled', label: 'SMS Verification Platform', help: 'Off refuses every tenant-funded verification send.' },
  { key: 'sms.package_billing_enabled', label: 'Package Billing', help: 'Off pauses billing only — sends continue, unbilled.' },
  { key: 'sms.new_tenant_enrollment_enabled', label: 'New Tenant Enrollment', help: 'Off blocks new package assignments; existing tenants unaffected.' },
  { key: 'sms.emergency_send_disabled', label: 'Emergency Disable Sending', help: 'On is the stop button: all tenant verification sends refused immediately.', danger: true },
];

function MasterControlsSection({ controls, onActed }: { controls: SmsControls | null; onActed: (msg: string) => void }) {
  const [pending, setPending] = useState<{ key: keyof SmsControls; next: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!controls) return null;

  const submit = async () => {
    if (!pending) return;
    if (!reason.trim()) { setErr('A reason is required for every master-control change.'); return; }
    setBusy(true); setErr(null);
    try {
      const r: any = await superAdminSmsApi.setControl(pending.key, pending.next, reason.trim());
      if (r && r.ok === false) { setErr(r.message || r.error || 'Change failed.'); return; }
      onActed('Master control updated.');
      setPending(null); setReason('');
    } catch { setErr('Change failed. Nothing was updated.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel" aria-label="Master controls" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Master Controls</h2>
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={tbl()}>
          <thead><tr><th style={th()}>Control</th><th style={th()}>State</th><th style={th()}>Effect</th><th style={th()}>Actions</th></tr></thead>
          <tbody>
            {CONTROL_LABELS.map((c) => {
              const on = controls[c.key];
              const active = c.danger ? on : !on;
              return (
                <tr key={c.key}>
                  <td style={td()}><strong>{c.label}</strong></td>
                  <td style={td()}>{c.danger ? (on ? <strong style={{ color: '#9B2C2C' }}>ENGAGED</strong> : 'Off') : (on ? 'On' : 'Off')}</td>
                  <td style={td()} className="muted">{c.help}</td>
                  <td style={td()}>
                    <button style={btn(false, active && c.danger)} onClick={() => { setPending({ key: c.key, next: !on }); setReason(''); setErr(null); }}>
                      {c.danger ? (on ? 'Release' : 'Engage') : (on ? 'Turn Off' : 'Turn On')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending && (
        <div style={{ padding: 16, background: '#FAFAFA', borderTop: '1px solid var(--line)', fontSize: 12 }}>
          <div style={{ marginBottom: 10 }}>{CONTROL_LABELS.find((c) => c.key === pending.key)!.label} → <strong>{String(pending.next)}</strong>. This takes effect immediately.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Reason (required)" aria-label="Control reason" value={reason} onChange={(e) => setReason(e.target.value)} style={inp()} />   {/* Sep 2026 merge: the redesign dropped the field's accessible name */}
            <button style={btn()} disabled={busy} onClick={() => void submit()}>Confirm</button>
            <button style={btn(busy, false)} disabled={busy} onClick={() => { setPending(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div className="inline-note error" role="alert" style={{ margin: 16, background: '#FBEAEA', border: '1px solid #F0C9C9', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{err}</div>}
    </section>
  );
}

function DefaultPackageSection({ current, packages, onActed }: { current: string | null; packages: SmsPackage[]; onActed: (msg: string) => void }) {
  const [choice, setChoice] = useState<string>(current ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChoice(current ?? ''); }, [current]);
  const save = async () => {
    if (!reason.trim()) { setErr('A reason is required to change the default package.'); return; }
    setBusy(true); setErr(null);
    try {
      const r: any = await superAdminSmsApi.setDefaultPackage(choice || null, reason.trim());
      if (r && r.ok === false) { setErr(r.message || r.error || 'Change failed.'); return; }
      onActed('Default package for new tenants updated.');
      setReason('');
    } catch { setErr('Change failed. Nothing was updated.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-label="Default package" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
      <div className="phead"><h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Default Package for New Tenants</h2></div>
      <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>Applied automatically when a tenant is created (direct creation and application approval). "None" means new salons start without a package — verification works, unbilled.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Default package choice" style={inp()}>
          <option value="">None</option>
          {packages.filter((p) => p.active).map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
        </select>
        <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Default package reason" style={inp()} />
        <button style={btn()} disabled={busy} onClick={() => void save()}>Save Default</button>
      </div>
      {err && <div className="inline-note error" role="alert" style={{ marginTop: 16, background: '#FBEAEA', border: '1px solid #F0C9C9', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{err}</div>}
    </section>
  );
}

// inline cream/gold style helpers
function btn(disabled = false, primary = false) {
  return {
    height: 34, padding: '0 12px', borderRadius: 9, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    border: '1px solid ' + (primary ? 'var(--g7)' : 'var(--line)'),
    background: disabled ? '#F3EDE3' : primary ? 'var(--g7)' : '#FFFDF8',
    color: disabled ? 'var(--muted)' : primary ? '#fff' : 'var(--text)', opacity: disabled ? 0.85 : 1,
  };
}
const inp = (w?: number) => ({ height: 32, width: w || 'auto', border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', padding: '0 10px', fontFamily: 'inherit', fontSize: 12 });
const tbl = () => ({ width: '100%', borderCollapse: 'collapse', fontSize: 12 } as any);
const th = () => ({ textAlign: 'left', padding: '10px 16px', background: 'var(--card)', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--soft)', whiteSpace: 'nowrap', fontWeight: 600 } as any);
const thR = () => ({ ...th(), textAlign: 'right' } as any);
const td = () => ({ padding: '10px 16px', borderBottom: '1px solid var(--cream2)', verticalAlign: 'middle', whiteSpace: 'nowrap' } as any);
const tdR = () => ({ ...td(), textAlign: 'right' } as any);
const limCard = () => ({ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#FFFDF8' });
const badgeStyle = (bg: string, fg: string, bd: string) => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: bg, color: fg, border: '1px solid ' + bd });
