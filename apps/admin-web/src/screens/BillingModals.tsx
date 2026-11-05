import { useState, useEffect } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { billingActionsApi, type BillingSubscriptionsOverviewResponse } from '../api/superAdminBillingApi';

// BillingModals — Unit 2 write workflows. Create Invoice (backend computes totals; draft → optional finalize),
// Apply Credit (ledger-based, no double-apply), Retry Payment (idempotent; recovered links to the failed obligation).
// All calls are audited server-side. Money is entered in dollars and converted to integer cents.

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '8vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 520, background: '#fff', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const dollars = (s: string) => (parseDollarsToCents(s || '0') ?? 0);

export function CreateInvoiceModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (msg: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [planCode, setPlanCode] = useState(ov.tenantOverview[0]?.plan ?? 'premium');
  const [amount, setAmount] = useState('199.00');
  const [discount, setDiscount] = useState('0');
  const [finalize, setFinalize] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await billingActionsApi.createInvoice({ tenantId, planCode, lines: [{ kind: 'plan', description: `${planCode} plan (monthly)`, quantity: 1, unitPriceCents: dollars(amount) }], discountCents: dollars(discount) });
      let msg = `Created ${r.invoiceNumber} (total computed on the backend: $${(r.totalCents / 100).toFixed(2)}).`;
      if (finalize) { const f = await billingActionsApi.finalizeInvoice(r.invoiceNumber); msg = `Created and finalized ${f.invoiceNumber} — line items are now immutable.`; }
      onDone(msg);
    } catch (e: any) { setErr(e?.message || 'Failed to create invoice'); } finally { setBusy(false); }
  };
  return (
    <Overlay title="Create Invoice" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
      <label className="flabel">Plan<select className="finput" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>{ov.planCatalog.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      <label className="flabel">Plan charge ($)<input className="finput" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
      <label className="flabel">Discount ($)<input className="finput" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '8px 0' }}><input type="checkbox" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} /> Finalize immediately (locks line items)</label>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Create Invoice'}</button>
    </Overlay>
  );
}

export function ApplyCreditModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (msg: string) => void }) {
  const openInvoices = ov.invoices.filter((i) => ['open', 'past_due', 'failed', 'partially_paid'].includes(i.status));
  const [invoiceNumber, setInvoiceNumber] = useState(openInvoices[0]?.invoiceNumber ?? '');
  const [creditId, setCreditId] = useState('');
  const [amount, setAmount] = useState('30.00');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!creditId) { setErr('Enter a credit ID (from the tenant billing profile).'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await billingActionsApi.applyCredit({ creditId, invoiceNumber, amountCents: dollars(amount) });
      onDone(`Applied credit to ${r.invoiceNumber}. Remaining credit: $${(r.creditRemainingCents / 100).toFixed(2)}; amount due: $${(r.amountDueCents / 100).toFixed(2)}.`);
    } catch (e: any) { setErr(e?.message || 'Failed to apply credit'); } finally { setBusy(false); }
  };
  return (
    <Overlay title="Apply Credit" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Invoice<select className="finput" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}>{openInvoices.map((i) => <option key={i.invoiceNumber} value={i.invoiceNumber}>{i.invoiceNumber} — {i.tenant}</option>)}</select></label>
      <label className="flabel">Credit ID<input className="finput" value={creditId} onChange={(e) => setCreditId(e.target.value)} placeholder="credit UUID" /></label>
      <label className="flabel">Amount ($)<input className="finput" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
      <div className="muted" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>Ledger-based: cannot exceed the remaining balance and cannot be applied twice.</div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Apply Credit'}</button>
    </Overlay>
  );
}

export function RetryPaymentModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (msg: string) => void }) {
  const eligible = ov.invoices.filter((i) => ['past_due', 'failed', 'open', 'partially_paid'].includes(i.status));
  const [invoiceNumber, setInvoiceNumber] = useState(eligible[0]?.invoiceNumber ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const key = `retry-${invoiceNumber}-${Date.now()}`;
      const r = await billingActionsApi.retryPayment({ invoiceNumber, idempotencyKey: key });
      onDone(r.recovered ? `Payment recovered for ${r.invoiceNumber} — linked to the prior failed obligation and marked paid.` : `Retry submitted for ${r.invoiceNumber} (status ${r.status}).`);
    } catch (e: any) { setErr(e?.message || 'Failed to retry payment'); } finally { setBusy(false); }
  };
  return (
    <Overlay title="Retry Failed Payment" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Invoice<select className="finput" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}>{eligible.map((i) => <option key={i.invoiceNumber} value={i.invoiceNumber}>{i.invoiceNumber} — {i.tenant} ({i.status})</option>)}</select></label>
      <div className="muted" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>Idempotent: a repeated attempt never double-charges; a recovery links back to the failed obligation.</div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Retry Payment'}</button>
    </Overlay>
  );
}

// ---- Unit 3 modals: Change Plan (with proration preview), Add/Remove Add-On, Extend Trial, Promotional Pricing ----
import { billingChangeApi } from '../api/superAdminBillingApi';

function Ovl({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '8vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 520, background: '#fff', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><strong style={{ fontSize: 14 }}>{title}</strong><button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function ChangePlanModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (m: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [toPlanCode, setToPlanCode] = useState(ov.planCatalog[0]?.code ?? '');
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const doPreview = async () => { setBusy(true); setErr(null); try { setPreview(await billingChangeApi.previewPlan({ tenantId, toPlanCode })); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); setErr(null); try { const r = await billingChangeApi.changePlan({ tenantId, toPlanCode, strategy: preview?.strategy }); onDone(`Plan change ${r.from} → ${r.to} (${r.strategy}); net ${r.proration.netCents >= 0 ? 'charge' : 'credit'} $${Math.abs(r.proration.netCents / 100).toFixed(2)}.`); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  return (
    <Ovl title="Change Plan" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPreview(null); }}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant} ({t.plan})</option>)}</select></label>
      <label className="flabel">New plan<select className="finput" value={toPlanCode} onChange={(e) => { setToPlanCode(e.target.value); setPreview(null); }}>{ov.planCatalog.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      {preview && (
        <div className="state" style={{ background: '#FBF6EC', border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '8px 0', fontSize: 12 }}>
          {preview.changeType} · {preview.strategy} · {preview.proration.daysRemaining}/{preview.proration.daysTotal} days left<br />
          Unused credit ${(preview.proration.creditCents / 100).toFixed(2)} · New charge ${(preview.proration.chargeCents / 100).toFixed(2)} · <strong>Net {preview.proration.netCents >= 0 ? 'charge' : 'credit'} ${Math.abs(preview.proration.netCents / 100).toFixed(2)}</strong>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {!preview ? <button className="btn ghost" disabled={busy} onClick={doPreview}>Preview Proration</button>
          : <button className="btn" disabled={busy} onClick={apply}>{busy ? 'Working…' : 'Confirm Change'}</button>}
      </div>
    </Ovl>
  );
}

export function AddOnModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (m: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [addOnCode, setAddOnCode] = useState(ov.addOnCatalog[0]?.code ?? '');
  const [action, setAction] = useState<'add' | 'remove'>('add');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => { setBusy(true); setErr(null); try { const r = await billingChangeApi.changeAddOn({ tenantId, addOnCode, action }); onDone(`${r.action === 'add' ? 'Added' : 'Removed'} ${r.addOn}.`); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  return (
    <Ovl title="Add or Remove Add-On" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
      <label className="flabel">Add-On<select className="finput" value={addOnCode} onChange={(e) => setAddOnCode(e.target.value)}>{ov.addOnCatalog.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select></label>
      <label className="flabel">Action<select className="finput" value={action} onChange={(e) => setAction(e.target.value as any)}><option value="add">Add</option><option value="remove">Remove</option></select></label>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Apply'}</button>
    </Ovl>
  );
}

export function ExtendTrialModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (m: string) => void }) {
  const trials = ov.tenantOverview.filter((t) => t.state === 'trialing');
  const [tenantId, setTenantId] = useState(trials[0]?.tenantId ?? ov.tenantOverview[0]?.tenantId ?? '');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => { setBusy(true); setErr(null); try { const r = await billingChangeApi.extendTrial({ tenantId, days: parseInt(days, 10) }); onDone(`Trial extended by ${r.days} days → ${r.newTrialEnd}.`); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  return (
    <Ovl title="Extend Trial" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant (trialing)<select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant} ({t.state})</option>)}</select></label>
      <label className="flabel">Extension days<input className="finput" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label>
      <div className="muted" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>Cumulative extension is capped (30 days) and recalculates the billing date.</div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Extend Trial'}</button>
    </Ovl>
  );
}

export function PromoModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (m: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [code, setCode] = useState('');
  const [discountType, setType] = useState<'percent' | 'fixed'>('percent');
  const [percent, setPercent] = useState('20');
  const [amount, setAmount] = useState('10.00');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => { setBusy(true); setErr(null); try { const r = await billingChangeApi.createDiscount({ tenantId, code, discountType, percent: discountType === 'percent' ? parseInt(percent, 10) : undefined, amountCents: discountType === 'fixed' ? (parseDollarsToCents(amount) ?? 0) : undefined }); onDone(`Promotional pricing ${r.code} created.`); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  return (
    <Ovl title="Apply Promotional Pricing" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
      <label className="flabel">Code<input className="finput" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER25" /></label>
      <label className="flabel">Type<select className="finput" value={discountType} onChange={(e) => setType(e.target.value as any)}><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></label>
      {discountType === 'percent' ? <label className="flabel">Percent (%)<input className="finput" value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="numeric" /></label>
        : <label className="flabel">Amount ($)<input className="finput" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>}
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Create Promotion'}</button>
    </Ovl>
  );
}

// ---- Unit 4 modals: Pause, Resume, Cancel (with impact preview) ----
import { billingLifecycleApi } from '../api/superAdminBillingApi';

export function PauseModal({ ov, mode, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; mode: 'pause' | 'resume'; onClose: () => void; onDone: (m: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [resumeDate, setResumeDate] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === 'pause') { const r = await billingLifecycleApi.pause({ tenantId, resumeDate: resumeDate || undefined }); onDone(`Subscription paused${r.pauseEnd ? ` until ${new Date(r.pauseEnd).toLocaleDateString()}` : ''}. Data and history preserved.`); }
      else { await billingLifecycleApi.resume({ tenantId }); onDone('Subscription resumed.'); }
    } catch (e: any) { setErr(e?.message); } finally { setBusy(false); }
  };
  return (
    <Ovl title={mode === 'pause' ? 'Pause Subscription' : 'Resume Subscription'} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant} ({t.state})</option>)}</select></label>
      {mode === 'pause' && <label className="flabel">Resume date (optional)<input className="finput" type="date" value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} /></label>}
      <div className="muted" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>Pause is not cancellation — subscription history and tenant data are preserved.</div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : mode === 'pause' ? 'Pause' : 'Resume'}</button>
    </Ovl>
  );
}

export function CancelModal({ ov, onClose, onDone }: { ov: BillingSubscriptionsOverviewResponse; onClose: () => void; onDone: (m: string) => void }) {
  const [tenantId, setTenantId] = useState(ov.tenantOverview[0]?.tenantId ?? '');
  const [strategy, setStrategy] = useState('end_of_period');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const doPreview = async () => { setBusy(true); setErr(null); try { setPreview(await billingLifecycleApi.previewCancel({ tenantId, strategy })); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  const apply = async () => { if (reason.trim().length < 3) { setErr('A cancellation reason is required.'); return; } setBusy(true); setErr(null); try { const r = await billingLifecycleApi.cancel({ tenantId, strategy, reason }); onDone(`Cancellation recorded (${r.strategy}) — effective ${new Date(r.effectiveAt).toLocaleDateString()}. Billing history preserved.`); } catch (e: any) { setErr(e?.message); } finally { setBusy(false); } };
  return (
    <Ovl title="Cancel Subscription" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Tenant<select className="finput" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPreview(null); }}>{ov.tenantOverview.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenant}</option>)}</select></label>
      <label className="flabel">Strategy<select className="finput" value={strategy} onChange={(e) => { setStrategy(e.target.value); setPreview(null); }}><option value="end_of_period">End of billing period</option><option value="immediate">Immediate</option></select></label>
      <label className="flabel">Reason<input className="finput" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required" /></label>
      {preview && (
        <div className="state" style={{ background: '#FBEAEA', border: '1px solid #E4B9B2', borderRadius: 8, padding: 8, margin: '8px 0', fontSize: 12 }}>
          Result: <strong>{preview.resultStatus.replace(/_/g, ' ')}</strong> · effective {new Date(preview.effectiveAt).toLocaleDateString()}<br />
          Impact: {preview.impact.outstandingInvoices} outstanding invoice(s) (${(preview.impact.outstandingCents / 100).toFixed(2)}), ${(preview.impact.creditRemainingCents / 100).toFixed(2)} credit remaining, {preview.impact.activeAddOns} add-on(s), {preview.impact.dataRetentionDays}-day data retention. History is preserved.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {!preview ? <button className="btn ghost" disabled={busy} onClick={doPreview}>Preview Impact</button>
          : <button className="btn" disabled={busy} onClick={apply}>{busy ? 'Working…' : 'Confirm Cancellation'}</button>}
      </div>
    </Ovl>
  );
}

// ---- Unit 6: Export Accounting Report (report picker → filter-aware, audited CSV; no card/credential columns) ----
import { billingExportApi } from '../api/superAdminBillingApi';

export function ExportModal({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [report, setReport] = useState('subscriptions');
  const [format, setFormat] = useState('csv');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await billingExportApi.exportReport({ report, format });
      let blob: Blob;
      if (res.base64) { const bin = atob(res.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); blob = new Blob([bytes], { type: res.contentType }); }
      else blob = new Blob([res.csv ?? ''], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      onDone(`Exported ${res.filename} (${res.rowCount} rows) — audited, no card or credential data.`);
    } catch (e: any) { setErr(e?.message || 'Export failed'); } finally { setBusy(false); }
  };
  return (
    <Ovl title="Export Accounting Report" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <label className="flabel">Report<select className="finput" value={report} onChange={(e) => setReport(e.target.value)}>
        <option value="subscriptions">Tenant Subscriptions</option>
        <option value="invoices">Invoices &amp; Failed Payments</option>
        <option value="credits">Credits</option>
        <option value="discounts">Discounts</option>
        <option value="recurring-revenue">Recurring Revenue</option>
      </select></label>
      <label className="flabel">Format<select className="finput" value={format} onChange={(e) => setFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (XLSX)</option><option value="pdf">PDF</option></select></label>
      <div className="muted" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>Respects active filters, is formula-injection-safe, and never includes card or credential data.</div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Exporting…' : 'Export'}</button>
    </Ovl>
  );
}

// ---- Unit 7: KPI click-through drill-downs (built from the overview data already loaded — no extra request) ----
export function BillingDrillModal({ ov, drill, onClose }: { ov: BillingSubscriptionsOverviewResponse; drill: string; onClose: () => void }) {
  const money2 = (c: number) => '$' + ((c ?? 0) / 100).toFixed(2);
  const dd2 = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
  let title = 'Details'; let head: string[] = []; let rows: string[][] = [];
  if (drill === 'active' || drill === 'trialing') {
    title = drill === 'active' ? 'Active Subscriptions' : 'Trial Accounts';
    head = ['Tenant', 'Plan', 'State', 'Monthly', 'Renewal'];
    rows = ov.tenantOverview.filter((t) => t.state === drill).map((t) => [t.tenant, t.plan ?? '—', t.state, money2(t.monthlyCents), dd2(t.renewalDate)]);
  } else if (drill === 'past_due' || drill === 'failed') {
    title = drill === 'past_due' ? 'Past-Due Invoices' : 'Failed Payments';
    head = ['Invoice', 'Tenant', 'Amount', 'Due', 'Status', 'Retry'];
    const want = drill === 'past_due' ? ['past_due'] : ['failed'];
    rows = ov.invoices.filter((i) => want.includes(i.status)).map((i) => [i.invoiceNumber, i.tenant, money2(i.amountCents), dd2(i.dueDate), i.status, i.retryStatus ?? '—']);
  } else if (drill === 'invoices') {
    title = 'Invoices'; head = ['Invoice', 'Tenant', 'Amount', 'Due', 'Status'];
    rows = ov.invoices.map((i) => [i.invoiceNumber, i.tenant, money2(i.amountCents), dd2(i.dueDate), i.status]);
  } else if (drill === 'changes') {
    title = 'Subscription Changes & Cancellation Requests'; head = ['Tenant', 'Requested', 'Effective', 'Status'];
    rows = ov.changes.map((c) => [c.tenant, c.requested, dd2(c.effectiveAt), c.status]);
  } else if (drill === 'renewals') {
    title = 'Upcoming Renewals'; head = ['Tenant', 'Plan', 'Renewal', 'Amount', 'Auto-Renew'];
    rows = ov.upcomingRenewals.map((r) => [r.tenant, r.plan ?? '—', dd2(r.renewalDate), money2(r.amountCents), r.autoRenew ? 'ON' : 'OFF']);
  }
  return (
    <Ovl title={title} onClose={onClose}>
      {rows.length === 0 ? <div className="state muted" style={{ fontSize: 12 }}>No matching records.</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{head.map((h) => <th key={h} style={{ padding: '4px 6px' }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>{r.map((c, j) => <td key={j} style={{ padding: '5px 6px' }}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </Ovl>
  );
}

// ---- §27 Tenant Billing Profile (masked payment method; never full PAN/CVV/token/secrets) ----
import { billingProfileApi } from '../api/superAdminBillingApi';

export function TenantProfileModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [p, setP] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { billingProfileApi.profile(tenantId).then((d) => setP(d.profile)).catch((e: any) => setErr(e?.message)); }, [tenantId]);
  const m = (c: number) => '$' + ((c ?? 0) / 100).toFixed(2);
  const d = (v: any) => (v ? new Date(v).toLocaleDateString() : '—');
  return (
    <Ovl title="Tenant Billing Profile" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!p ? <div className="state">Loading…</div> : (
        <div style={{ fontSize: 12 }}>
          <div style={{ marginBottom: 8 }}><strong style={{ fontSize: 14 }}>{p.tenant}</strong><div className="muted">{p.legalName || p.tenant} · {p.currency}</div></div>
          <div className="state" style={{ background: '#FBF6EC', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div><strong>Subscription:</strong> {p.subscription.plan ?? '—'} · {p.subscription.status} · {m(p.subscription.monthlyCents)}/mo</div>
            <div className="muted">Renewal {d(p.subscription.currentPeriodEnd)}{p.subscription.trialEnd ? ` · Trial ends ${d(p.subscription.trialEnd)}` : ''}{p.subscription.cancelAt ? ` · Cancels ${d(p.subscription.cancelAt)}` : ''}{p.subscription.pauseEnd ? ` · Resumes ${d(p.subscription.pauseEnd)}` : ''}</div>
            <div><strong>Outstanding:</strong> {m(p.outstandingCents)} · <strong>Payment method:</strong> {p.maskedPaymentMethod ? `${p.maskedPaymentMethod.brand} ····${p.maskedPaymentMethod.last4}` : 'None on file (tokenized)'}</div>
          </div>
          <Section title={`Add-Ons (${p.addOns.length})`}>{p.addOns.map((a: any, i: number) => <div key={i}>{a.name} ×{a.quantity} — {m(a.priceCents)} <span className="muted">({a.status})</span></div>)}</Section>
          <Section title={`Invoices (${p.invoices.length})`}>{p.invoices.map((v: any, i: number) => <div key={i}>{v.invoiceNumber} — {m(v.totalCents)} · {v.status} · due {d(v.dueDate)}{v.retryStatus ? ` · ${v.retryStatus}` : ''}</div>)}</Section>
          <Section title={`Credits (${p.credits.length})`}>{p.credits.map((c: any, i: number) => <div key={i}>{m(c.amountCents)} ({m(c.remainingCents)} left) — {c.reason} <span className="muted">({c.status})</span></div>)}</Section>
          <Section title={`Discounts (${p.discounts.length})`}>{p.discounts.map((c: any, i: number) => <div key={i}>{c.code} — {c.discountType === 'percent' ? `${c.percent}%` : m(c.amountCents)} <span className="muted">({c.status})</span></div>)}</Section>
          <Section title={`Audit History (${p.auditHistory.length})`}>{p.auditHistory.length === 0 ? <span className="muted">No recent billing activity.</span> : p.auditHistory.map((h: any, i: number) => <div key={i} className="muted">{new Date(h.at).toLocaleString()} — {h.action}</div>)}</Section>
        </div>
      )}
    </Ovl>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 8 }}><div style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)', margin: '6px 0 2px' }}>{title}</div>{children}</div>;
}
