// HardwarePaymentsScreen.tsx — Super-Admin control for the Hardware Payment Recovery feature (build doc §14).
// Pick a tenant → see/manage its payment plan, revenue-split settings, monthly invoices and ledger, and run the
// money actions (recalculate a month from card volume, charge a shortfall, import residual volume, pause/resume).
// A global "Run Monthly" reconciles every active plan for a billing month. All amounts are integer cents server-side.
import { useEffect, useState } from 'react';
import { superAdminApi as A, type HwPlan, type HwInvoice, type HwLedgerRow, type HwSplitSettings } from '../api/superAdminApi';

const money = (c: any) => '$' + (Number(c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const arr = (x: any): any[] => (Array.isArray(x) ? x : x?.invoices ?? x?.ledger ?? x?.rows ?? x?.items ?? []);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const statusTone: Record<string, string> = {
  paid: 'var(--ok, #2e7d32)',
  payment_failed: 'var(--danger,#c0392b)',
  payment_method_required: '#b8860b',
  shortfall_pending: '#b8860b',
  past_due: 'var(--danger,#c0392b)',
};

export function HardwarePaymentsScreen() {
  const [tenants, setTenants] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [tid, setTid] = useState('');
  const [settings, setSettings] = useState<(HwSplitSettings & { hasOverride: boolean }) | null>(null);
  const [draft, setDraft] = useState<HwSplitSettings | null>(null);
  const [plan, setPlan] = useState<HwPlan | null>(null);
  const [invoices, setInvoices] = useState<HwInvoice[]>([]);
  const [ledger, setLedger] = useState<HwLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // forms
  const [recMonth, setRecMonth] = useState(thisMonth());
  const [recVol, setRecVol] = useState('50000');
  const [impMonth, setImpMonth] = useState(thisMonth());
  const [impVol, setImpVol] = useState('50000');
  const [runMonth, setRunMonth] = useState(thisMonth());
  const [newMonthly, setNewMonthly] = useState('250');
  const [newTotal, setNewTotal] = useState('3000');

  useEffect(() => {
    (A.state() as Promise<any>)
      .then((s) =>
        setTenants(
          (s?.tenants || []).map((t: any) => ({
            id: t.id,
            name: t.n || t.displayName || t.name || t.legalName || t.code || t.id,
            code: t.code,
          }))
        )
      )
      .catch(() => {});
  }, []);

  const loadTenant = (id: string) => {
    if (!id) return;
    setLoading(true); setErr(null); setNote(null);
    Promise.allSettled([A.hwPlan(id), A.hwTenantSettings(id), A.hwInvoices(id), A.hwLedger(id)]).then(([p, s, inv, led]) => {
      const planVal = p.status === 'fulfilled' ? (p.value?.plan ?? null) : null;
      setPlan(planVal && planVal.id ? planVal : null);
      const raw = s.status === 'fulfilled' ? (s.value ?? null) : null;
      const eff = raw?.effective ?? null;
      setSettings(eff ? { ...eff, hasOverride: !!raw?.hasOverride } : null);
      setDraft(eff ? { ...eff } : null);
      setInvoices(inv.status === 'fulfilled' ? arr(inv.value) : []);
      setLedger(led.status === 'fulfilled' ? arr(led.value) : []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { if (tid) loadTenant(tid); else { setPlan(null); setSettings(null); setInvoices([]); setLedger([]); } }, [tid]);

  const run = (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key); setErr(null); setNote(null);
    fn().then((r) => { setNote(typeof ok === 'function' ? (ok as any)(r) : ok); loadTenant(tid); }).catch((e: any) => setErr(e?.message || 'Action failed.')).finally(() => setBusy(null));
  };
  const toCents = (v: string) => Math.round((Number(v) || 0) * 100);

  const selectedTenant = tenants.find((t) => t.id === tid);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: '#FFF6E5', border: '1px solid #E2C686', fontSize: 11, fontWeight: 700, color: 'var(--g7, #A96F22)', marginBottom: 6 }}>
            <span>💳 Hardware Recovery Management</span>
          </div>
          <br />
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Hardware Payments</h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Revenue-split recovery · per-tenant plans, invoices &amp; auto-charge
          </div>
        </div>

        <div className="fieldrow" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={tid} onChange={(e) => setTid(e.target.value)} style={{ minWidth: 280, height: 40, border: '1px solid var(--line)', borderRadius: 10, background: '#FFFFFF', padding: '0 12px', fontSize: 13, fontWeight: 600 }}>
            <option value="">Select a tenant…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.code ? ` (${t.code})` : ''}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8,  }}>
            <input type="month" value={runMonth} onChange={(e) => setRunMonth(e.target.value)} title="Billing month" style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, background: '#FFFFFF', padding: '0 8px', fontSize: 12 }} />
            <button className="btn" disabled={busy === 'run'} onClick={() => run('run', () => A.hwRunMonthly(runMonth), 'Monthly reconciliation complete.')} style={{ height: 32, padding: '0 12px', fontSize: 12 }}>
              {busy === 'run' ? 'Running…' : 'Run Monthly (all active plans)'}
            </button>
          </div>
        </div>
      </div>

      {note ? <div className="note" style={{ color: 'var(--ok,#2e7d32)', background: '#EEF7EF', border: '1px solid #BFE3C6', padding: '10px 14px', borderRadius: 10, fontSize: 13 }}>{note}</div> : null}
      {err ? <div className="err" style={{ margin: 0 }}>{err}</div> : null}

      {!tid ? (
        /* ELEGANT EMPTY STATE */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#FFF4DE', display: 'grid', placeItems: 'center', fontSize: 26, marginBottom: 12 }}>
              🏪
            </div>
            <h2 style={{ margin: '0 0 6px', fontSize: 17, fontFamily: 'Playfair Display, serif', color: 'var(--text)' }}>
              Select a Salon to Manage Hardware Payments
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', maxWidth: 540, lineHeight: 1.5 }}>
              Choose a tenant from the dropdown above to view its hardware financing plan, customize revenue-split percentages, trigger manual reconciliations, or inspect monthly invoice ledgers.
            </p>
          </div>

          {/* 3 OVERVIEW GUIDES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>💳</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>1. Payment Plan Recovery</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
                Hardware is paid down automatically using monthly gross card transaction margin. No upfront friction for salon owners.
              </div>
            </div>

            <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>⚙️</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>2. Revenue Split Overrides</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
                Customize pricing bps, platform share %, Fiserv share %, and hardware credit allocation per tenant or use platform defaults.
              </div>
            </div>

            <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>⚡</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>3. Automated Shortfall Charging</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
                If card volume doesn't fully cover the monthly due amount, the shortfall is billed and auto-charged seamlessly.
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* TENANT CONTROL GRID */
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* Plan + Settings + Actions Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 1. Payment Plan Card */}
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Hardware Payment Plan</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Tenant: <strong>{selectedTenant?.name}</strong></div>
                </div>
                {plan ? (
                  <span className={plan.status === 'active' ? 'pill ok' : 'pill warn'} style={{ textTransform: 'capitalize', fontWeight: 800 }}>
                    {plan.status}
                  </span>
                ) : null}
              </div>

              {loading ? <div className="state" style={{ padding: 20 }}>Loading plan details…</div> : (
                <>
                  {plan ? (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#FFF9EF', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Monthly Payment</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{money(plan.monthlyPaymentCents)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Remaining Balance</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: '#A96F22', marginTop: 2 }}>{money(plan.remainingBalanceCents)}</div>
                        </div>
                        <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--line)', paddingTop: 8, marginTop: 4, fontSize: 12 }}>
                          <span style={{ color: 'var(--muted)' }}>Auto-charge shortfall:</span>
                          <span className={plan.autoChargeShortfallEnabled ? 'pill ok' : 'pill'} style={{ fontSize: 10.5 }}>
                            {plan.autoChargeShortfallEnabled ? 'Enabled (Active)' : 'Disabled'}
                          </span>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        {plan.status === 'paused'
                          ? <button className="btn" disabled={busy === 'resume'} onClick={() => run('resume', () => A.hwResume(tid, plan.id), 'Plan resumed.')}>Resume plan</button>
                          : <button className="btn ghost" disabled={busy === 'pause'} onClick={() => run('pause', () => A.hwPause(tid, plan.id), 'Plan paused.')}>Pause plan</button>}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '8px 0' }}>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>No active hardware financing plan for this salon. Create one below:</div>
                      <div className="fieldrow" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input style={{ width: 120, height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }} value={newMonthly} onChange={(e) => setNewMonthly(e.target.value)} placeholder="Monthly $" />
                        <input style={{ width: 120, height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }} value={newTotal} onChange={(e) => setNewTotal(e.target.value)} placeholder="Total $" />
                        <button className="btn" disabled={busy === 'create'} onClick={() => run('create', () => A.hwCreatePlan(tid, { status: 'active', monthlyPaymentCents: toCents(newMonthly), totalHardwareCostCents: toCents(newTotal) }), 'Plan created.')} style={{ height: 36 }}>
                          Create plan
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* 2. Revenue Split Settings Card */}
            {draft ? (
              <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Revenue Split Configuration</div>
                  <span className={settings?.hasOverride ? 'pill warn' : 'pill'} style={{ fontSize: 10.5 }}>
                    {settings?.hasOverride ? 'Tenant Override' : 'Platform Default'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Pricing Rate (bps)</span>
                    <input style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px', fontSize: 13 }} value={draft.pricingRateBps ?? ''} onChange={(e) => setDraft({ ...draft, pricingRateBps: Number(e.target.value) })} />
                  </label>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Expense Rate (bps)</span>
                    <input style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px', fontSize: 13 }} value={draft.expenseRateBps ?? ''} onChange={(e) => setDraft({ ...draft, expenseRateBps: Number(e.target.value) })} />
                  </label>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Platform Share %</span>
                    <input style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px', fontSize: 13 }} value={draft.platformSharePercent ?? ''} onChange={(e) => setDraft({ ...draft, platformSharePercent: Number(e.target.value) })} />
                  </label>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Fiserv Share %</span>
                    <input style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px', fontSize: 13 }} value={draft.fiservSharePercent ?? ''} onChange={(e) => setDraft({ ...draft, fiservSharePercent: Number(e.target.value) })} />
                  </label>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
                    <span>Salon Hardware Credit % of Platform Share</span>
                    <input style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px', fontSize: 13 }} value={draft.salonHardwareCreditPercentOfPlatformShare ?? ''} onChange={(e) => setDraft({ ...draft, salonHardwareCreditPercentOfPlatformShare: Number(e.target.value) })} />
                  </label>
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn" disabled={busy === 'settings'} onClick={() => run('settings', () => A.hwSetTenantSettings(tid, { pricingRateBps: draft.pricingRateBps, expenseRateBps: draft.expenseRateBps, platformSharePercent: draft.platformSharePercent, fiservSharePercent: draft.fiservSharePercent, salonHardwareCreditPercentOfPlatformShare: draft.salonHardwareCreditPercentOfPlatformShare }), 'Split settings saved.')}>
                    Save split
                  </button>
                </div>
              </section>
            ) : null}

            {/* 3. Actions Card */}
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: 8, marginBottom: 12 }}>
                Money Actions &amp; Volume Overrides
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: '#FFF9EF', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Reconcile Specific Month</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input type="month" value={recMonth} onChange={(e) => setRecMonth(e.target.value)} style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px' }} />
                    <input style={{ width: 120, height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px' }} value={recVol} onChange={(e) => setRecVol(e.target.value)} placeholder="Card volume $" />
                    <button className="btn" disabled={!plan || busy === 'recalc'} onClick={() => run('recalc', () => A.hwRecalc(tid, { planId: plan!.id, billingMonth: recMonth, cardVolumeCents: toCents(recVol) }), 'Month reconciled.')}>
                      Recalculate month
                    </button>
                    <button className="btn ghost" disabled={!plan || busy === 'charge'} onClick={() => run('charge', () => A.hwChargeShortfall(tid, { planId: plan!.id, billingMonth: recMonth }), 'Shortfall charge attempted.')}>
                      Charge shortfall
                    </button>
                  </div>
                </div>

                <div style={{ background: '#FFF9EF', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Import Residual Volume</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input type="month" value={impMonth} onChange={(e) => setImpMonth(e.target.value)} style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px' }} />
                    <input style={{ width: 120, height: 34, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '0 8px' }} value={impVol} onChange={(e) => setImpVol(e.target.value)} placeholder="Residual volume $" />
                    <button className="btn ghost" disabled={busy === 'import'} onClick={() => run('import', () => A.hwImportVolume(tid, { billingMonth: impMonth, cardVolumeCents: toCents(impVol), source: 'manual' }), 'Volume imported.')}>
                      Import volume
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Invoices & Ledger */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Invoices Panel */}
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Monthly Invoices</div>
                <span className="pill" style={{ fontSize: 11 }}>{invoices.length} total</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                {invoices.length === 0 ? (
                  <div className="state" style={{ padding: 24, textAlign: 'center' }}>No invoices generated for this salon yet.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: '#FFF9EF', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ padding: '8px 10px' }}>Month</th>
                        <th style={{ padding: '8px 8px' }}>Volume</th>
                        <th style={{ padding: '8px 8px' }}>Credit</th>
                        <th style={{ padding: '8px 8px' }}>Due</th>
                        <th style={{ padding: '8px 8px' }}>Shortfall</th>
                        <th style={{ padding: '8px 8px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i, idx) => (
                        <tr key={i.id} style={{ borderBottom: '1px solid var(--line)', background: idx % 2 === 1 ? '#FFFDF8' : '#fff' }}>
                          <td style={{ padding: '10px 10px', fontWeight: 600 }}>{i.billingMonth}</td>
                          <td style={{ padding: '10px 8px' }}>{money(i.cardVolumeCents)}</td>
                          <td style={{ padding: '10px 8px', color: 'var(--ok, #3E8F57)', fontWeight: 600 }}>{money(i.salonHardwareCreditCents)}</td>
                          <td style={{ padding: '10px 8px', fontWeight: 600 }}>{money(i.hardwareMonthlyDueCents)}</td>
                          <td style={{ padding: '10px 8px', color: i.shortfallCents > 0 ? 'var(--warn, #D09A36)' : 'var(--muted)' }}>{money(i.shortfallCents)}</td>
                          <td style={{ padding: '10px 8px' }}>
                            <span className="pill" style={{ color: statusTone[i.status] || 'inherit', fontWeight: 700 }}>
                              {i.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Ledger Panel */}
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Hardware Ledger</div>
                <span className="pill" style={{ fontSize: 11 }}>{ledger.length} entries</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                {ledger.length === 0 ? (
                  <div className="state" style={{ padding: 24, textAlign: 'center' }}>No ledger entries recorded.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: '#FFF9EF', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ padding: '8px 10px' }}>Type</th>
                        <th style={{ padding: '8px 10px' }}>Amount</th>
                        <th style={{ padding: '8px 10px' }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((l, idx) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--line)', background: idx % 2 === 1 ? '#FFFDF8' : '#fff' }}>
                          <td style={{ padding: '10px 10px', fontWeight: 600 }}>
                            <span className="pill" style={{ background: '#FFF9EF', borderColor: '#E2C686', textTransform: 'capitalize' }}>
                              {l.entryType}
                            </span>
                          </td>
                          <td style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--text)' }}>{money(l.amountCents)}</td>
                          <td style={{ padding: '10px 10px', color: 'var(--muted)' }}>{l.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
