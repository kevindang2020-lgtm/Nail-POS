// aiUsageRound2.tsx — AI Usage & Limits, Four-Module Completion Guide (Oct 30 2026) items AI-01 and AI-02, used by
// POSAiUsageScreen (cost dialog, Package Details → Billing and → Settings).
//   InvoicedFigures  five figures kept apart: Recurring subscription price · Estimated current-period cost (with its
//                    assumptions) · Finalized invoiced · Paid · Outstanding. No finalized invoice → "No finalized invoice
//                    yet", never $0; tax is the provider's figure or Pending / Unknown, never invented.
//   InvoiceTable     the provider invoices (number, date, period, status, subtotal, prorations, tax, discounts / credits,
//                    total, paid, due) — only when a record exists — and "Re-check invoices" (read-only; never charges).
//   BranchSettings   per authorized branch: Salon default · Branch override (Inherit / On / Off) · Effective state ·
//                    Billing scope · Quota scope; owner-editable with the row's version (a stale save is refused).
import { useEffect, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiUsageScreenApi } from '../api/posAiUsageApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { requestId } from '../components/FitKit';

const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const dayText = (d: string | null) => (d ? fmtInZone(d + 'T12:00:00Z', { month: 'short', day: 'numeric', year: 'numeric' }) || d : '—');
const taxText = (cents: number | null, state: string) => (cents != null ? fmtMoney(cents) : tx('aiu2.tax.' + (state === 'pending' ? 'pending' : state === 'none' ? 'none' : 'unknown')));

export function InvoicedFigures({ x }: { x: any }) {
  const cp = x.currentPeriod;
  return (
    <div className="aiu2" data-testid="aiu-inv-figures">
      <div className="aiu2-figs">
        <div className="aiu2-fig" data-testid="aiu-fig-recurring"><span>{tx('aiu2.fig.recurring')}</span><b>{money(x.recurringCents)}</b><small>{tx('aiu2.fig.recurringSub')}</small></div>
        <div className="aiu2-fig est" data-testid="aiu-fig-estimate"><span>{tx('aiu2.fig.estimate')}</span><b>{money(x.estimate.cents)}</b><small>{tx('aiu2.fig.estimateSub')}</small></div>
        <div className="aiu2-fig" data-testid="aiu-fig-finalized"><span>{tx('aiu2.fig.finalized')}</span>
          <b>{cp.finalizedCents == null ? <span className="fk-muted">{tx('aiu2.noFinalized')}</span> : money(cp.finalizedCents)}</b>
          <small>{cp.finalizedCents == null ? (cp.draftInvoices ? tx('aiu2.drafts', { n: fmtNumber(cp.draftInvoices) }) : tx('aiu2.noInvoices'))
            : tx('aiu2.fig.finalizedSub', { n: fmtNumber(cp.finalizedInvoices), tax: taxText(cp.taxCents, cp.taxState), p: money(cp.prorationCents) })}</small></div>
        <div className="aiu2-fig" data-testid="aiu-fig-paid"><span>{tx('aiu2.fig.paid')}</span><b>{cp.finalizedCents == null ? '—' : money(cp.paidCents)}</b>
          <small>{cp.refundedCents ? tx('aiu2.refunded', { s: money(cp.refundedCents) }) : tx('aiu2.fig.paidSub')}</small></div>
        <div className={'aiu2-fig' + (cp.outstandingCents ? ' due' : '')} data-testid="aiu-fig-outstanding"><span>{tx('aiu2.fig.outstanding')}</span><b>{money(cp.outstandingCents)}</b>
          <small>{x.outstandingAllCents != null && x.outstandingAllCents !== cp.outstandingCents ? tx('aiu2.allOpen', { s: money(x.outstandingAllCents) }) : tx('aiu2.fig.outstandingSub')}</small></div>
      </div>
      <div className="fk-hint" data-testid="aiu-assumptions">{tx('aiu2.assumptions')} {x.estimate.assumptions.map((a: string) => tx('aiu2.assume.' + a)).join(' · ')}</div>
    </div>
  );
}

export function InvoiceTable({ x, onReconciled }: { x: any; onReconciled: () => void }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const key = useRef(requestId());
  const recheck = async () => {
    if (busy) return; setBusy(true); setMsg(null);
    try {
      const r = await posAiUsageScreenApi.reconcileInvoices({ idempotencyKey: key.current });
      setMsg(r.status === 'failed' ? tx(r.errorCode === 'provider_not_configured' ? 'aiu2.run.notConfigured' : 'aiu2.run.failed')
        : tx('aiu2.run.done', { n: fmtNumber(r.seen), c: fmtNumber(r.created), u: fmtNumber(r.updated), s: fmtNumber(r.unchanged) }));
      onReconciled();
    } catch (e) { setMsg(errorTextOf(e, tx('aiu2.run.failed'))); }
    finally { key.current = requestId(); setBusy(false); }
  };
  const run = x.lastRun;
  return (
    <div className="aiu2">
      <div className="aiu2-runbar">
        <span className="fk-hint" data-testid="aiu-last-run">{run ? tx('aiu2.lastRun', { t: when(run.at), s: tx('aiu2.runStatus.' + run.status) }) + (run.errorCode ? ` · ${tx('aiu2.err.' + (run.errorCode === 'provider_not_configured' ? 'provider_not_configured' : 'provider_error'))}` : '') : tx('aiu2.noRun')}</span>
        {x.canReconcile ? <button type="button" className="fk-btn ghost sm" onClick={recheck} disabled={busy} data-testid="aiu-reconcile">{busy ? tx('pos.loading') : tx('aiu2.recheck')}</button> : null}
      </div>
      {msg ? <div className="fk-hint" role="status" data-testid="aiu-reconcile-msg">{msg}</div> : null}
      {x.invoices.length === 0 ? <div className="fk-hint" data-testid="aiu-no-invoices">{tx('aiu2.noInvoicesLong')}</div> : (
        <div className="aiu2-scroll"><table className="fk-table aiu2-inv" data-testid="aiu-invoices"><thead><tr>
          <th>{tx('aiu2.col.invoice')}</th><th>{tx('aiu2.col.date')}</th><th>{tx('aiu2.col.period')}</th><th>{tx('aiu2.col.status')}</th><th className="num">{tx('aiu2.col.subtotal')}</th>
          <th className="num">{tx('aiu2.col.proration')}</th><th className="num">{tx('aiu2.col.tax')}</th><th className="num">{tx('aiu2.col.discounts')}</th><th className="num">{tx('aiu2.col.total')}</th>
          <th className="num">{tx('aiu2.col.paid')}</th><th className="num">{tx('aiu2.col.due')}</th></tr></thead>
          <tbody>{x.invoices.map((i: any) => <tr key={i.id} data-testid="aiu-invoice-row">
            <td>{i.number ?? i.reference ?? '—'}</td><td>{dayText(i.date)}</td><td>{i.periodStart ? `${dayText(i.periodStart)} – ${dayText(i.periodEnd)}` : '—'}</td>
            <td><span className={'fk-chip ' + (i.status === 'paid' ? 'ok' : i.status === 'void' ? 'mut' : i.finalized ? 'warn' : 'info')}>{tx('aiu2.inv.' + i.status)}</span></td>
            <td className="num">{money(i.subtotalCents)}</td><td className="num">{i.prorationCents ? money(i.prorationCents) : '—'}</td><td className="num">{taxText(i.taxCents, i.taxState)}</td>
            <td className="num">{i.discountCents + i.creditCents ? money(-(i.discountCents + i.creditCents)) : '—'}</td><td className="num"><b>{money(i.totalCents)}</b></td>
            <td className="num">{money(i.paidCents)}{i.refundedCents ? <span className="fk-muted"> ({tx('aiu2.refunded', { s: money(i.refundedCents) })})</span> : null}</td>
            <td className="num">{money(i.dueCents)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

type BranchItem = { branchId: string; name: string; override: boolean | null; settings: Record<string, boolean>; version: number; updatedAt: string | null; updatedBy: string | null;
  effective: 'on' | 'off_platform' | 'off_not_entitled' | 'off_branch'; source: string; usedThisPeriod: number | null };
const ovKey = (v: boolean | null) => (v === true ? 'on' : v === false ? 'off' : 'inherit');
const ovVal = (k: string) => (k === 'on' ? true : k === 'off' ? false : null);

export function BranchSettings({ code, b, onSaved }: { code: string; b: any; onSaved: (text: string) => void }) {
  const q = b.quota;
  return (
    <div className="aiu2" data-testid="aiu-branches">
      <h3 className="fk-h3">{tx('aiu2.branchTitle')}</h3>
      <div className="fk-hint">{tx('aiu2.branchRule')}</div>
      <div className="aiu2-quota" data-testid="aiu-quota">{tx('aiu2.quotaLine', { used: q.used == null ? '—' : fmtNumber(q.used), limit: q.limit > 0 ? fmtNumber(q.limit) : tx('aiu.noFixedLimit') })}
        {' · '}{tx('aiu2.attr.' + q.attribution, { n: fmtNumber(q.unattributed) })}</div>
      {b.items.length === 0 ? <div className="fk-hint">{tx('aiu2.noBranches')}</div> : (
        <div className="aiu2-scroll"><table className="fk-table aiu2-br"><thead><tr><th>{tx('aiu2.col.branch')}</th><th>{tx('aiu2.col.default')}</th><th>{tx('aiu2.col.override')}</th>
          <th>{tx('aiu2.col.effective')}</th><th>{tx('aiu2.col.billing')}</th><th>{tx('aiu2.col.quota')}</th>{b.fields.length ? <th>{tx('aiu2.col.settings')}</th> : null}{b.canEdit ? <th /> : null}</tr></thead>
          <tbody>{b.items.map((it: BranchItem) => <BranchRow key={it.branchId} code={code} it={it} b={b} onSaved={onSaved} />)}</tbody></table></div>
      )}
    </div>
  );
}

function BranchRow({ code, it, b, onSaved }: { code: string; it: BranchItem; b: any; onSaved: (text: string) => void }) {
  const [ov, setOv] = useState(ovKey(it.override)); const [st, setSt] = useState<Record<string, boolean>>(it.settings ?? {});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setOv(ovKey(it.override)); setSt(it.settings ?? {}); }, [it.version, it.override, it.settings]);
  const dirty = ov !== ovKey(it.override) || JSON.stringify(st) !== JSON.stringify(it.settings ?? {});
  const canOn = b.tenantDefault.entitled && b.tenantDefault.globallyEnabled;
  const save = async () => {
    if (busy || !dirty) return; setBusy(true); setErr(null);
    try {
      await posAiUsageScreenApi.setBranch(code, it.branchId, { overrideEnabled: ovVal(ov), settings: st, expectedVersion: it.version });
      onSaved(tx('aiu2.saved', { b: it.name }));
    } catch (e) { setErr(errorTextOf(e, tx('aiu2.saveFailed'))); }
    finally { setBusy(false); }
  };
  const tone = it.effective === 'on' ? 'ok' : it.effective === 'off_branch' ? 'warn' : 'mut';
  return (
    <tr data-testid="aiu-branch-row" data-branch={it.name}>
      <td><b>{it.name}</b>{it.updatedAt ? <div className="fk-muted aiu2-sm">{tx('aiu2.changed', { t: when(it.updatedAt), who: it.updatedBy ?? '—' })}</div> : null}</td>
      <td>{b.tenantDefault.entitled ? tx('aiu2.default.on', { s: tx('aiu.state.' + b.tenantDefault.state) }) : tx('aiu2.default.off', { s: tx('aiu.state.' + b.tenantDefault.state) })}</td>
      <td>{b.canEdit ? <select className="fk-select" aria-label={tx('aiu2.overrideFor', { b: it.name })} value={ov} onChange={(e) => setOv(e.target.value)} data-testid="aiu-branch-override">
          <option value="inherit">{tx('aiu2.ov.inherit')}</option><option value="on" disabled={!canOn}>{tx('aiu2.ov.on')}</option><option value="off">{tx('aiu2.ov.off')}</option></select>
        : tx('aiu2.ov.' + ovKey(it.override))}</td>
      <td><span className={'fk-chip ' + tone} data-testid="aiu-branch-effective">{tx('aiu2.eff.' + it.effective)}</span></td>
      <td>{tx('aiu2.billingScope')}</td>
      <td>{tx('aiu2.quotaScope')}<div className="fk-muted aiu2-sm">{it.usedThisPeriod == null ? tx('aiu2.attrUnavailable') : tx('aiu2.branchUsed', { n: fmtNumber(it.usedThisPeriod) })}</div></td>
      {b.fields.length ? <td>{b.fields.map((f: { key: string }) => <label key={f.key} className="aiu2-chk"><input type="checkbox" disabled={!b.canEdit} checked={!!st[f.key]}
        onChange={(e) => setSt((s) => ({ ...s, [f.key]: e.target.checked }))} data-testid={'aiu-branch-set-' + f.key} />{tx('aiu2.set.' + f.key)}</label>)}</td> : null}
      {b.canEdit ? <td><button type="button" className="fk-btn primary sm" onClick={save} disabled={busy || !dirty} data-testid="aiu-branch-save">{busy ? tx('pos.saving_2') : tx('aiu2.save')}</button>
        {err ? <div className="fk-err" role="alert">{err}</div> : null}</td> : null}
    </tr>
  );
}
