// MembershipPlanChange.tsx — extras Membership Overview 13 · 10 "Smart subscription change preview". From a plan's dialog, a
// manager proposes a new price / trial / enrollment fee, previews it on the server (the same validation publishing runs)
// — what changes, how many live members stay on the terms they joined (by version), what new members will pay — and only
// then publishes the new version. Every term not changed (and the benefits) is carried forward by the server; existing
// members are never moved. Money is integer cents.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { PlanVersionChangePreview } from '@aipowersalon/api-contracts/tenant';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posMembershipsApi } from '../api/posMembershipsApi';
import { fmtMoney, fmtNumber } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { errorTextOf } from '../i18n/error-text';

const MONEY_FIELDS = new Set(['priceCents', 'enrollmentFeeCents', 'setupFeeCents']);

export function PlanChangePanel({ planId, onPublished }: { planId: string; onPublished: (versionNumber: number) => void }) {
  const [price, setPrice] = useState(''); const [trial, setTrial] = useState(''); const [fee, setFee] = useState('');
  const [pv, setPv] = useState<PlanVersionChangePreview | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const body = (): Record<string, unknown> => {
    const b: Record<string, unknown> = { carryForward: true };
    if (price.trim() !== '') b.priceCents = parseDollarsToCents(price) ?? -1;
    if (trial.trim() !== '') b.trialDays = Number.parseInt(trial, 10);
    if (fee.trim() !== '') b.enrollmentFeeCents = parseDollarsToCents(fee) ?? -1;
    return b;
  };
  const edit = (f: (v: string) => void) => (v: string) => { f(v); setPv(null); };
  const preview = async () => {
    setBusy(true); setErr(null);
    try { setPv(await posMembershipsApi.previewVersion(planId, body())); } catch (e) { setPv(null); setErr(errorTextOf(e, tx('mpc.failed'))); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!pv || pv.blockers.length) return;
    setBusy(true); setErr(null);
    try { const r = await posMembershipsApi.publishVersion(planId, body()) as { versionNumber?: number }; onPublished(Number(r?.versionNumber ?? pv.nextVersionNumber)); }
    catch (e) { setErr(errorTextOf(e, tx('mpc.publishFailed'))); } finally { setBusy(false); }
  };
  const show = (field: string, v: string | number | boolean | null) => (v == null ? '—' : MONEY_FIELDS.has(field) && typeof v === 'number' ? fmtMoney(v)
    : typeof v === 'boolean' ? (v ? tx('mpc.yes') : tx('mpc.no')) : field === 'billingInterval' || field === 'cancellationPolicy' || field === 'allocationTiming' ? codeLabel('mpc.code', String(v)) : String(v));
  return (
    <section data-testid="plan-change">
      <h3 className="fk-h3">{tx('mpc.title')}</h3>
      <div className="fk-row">
        <label className="fk-field"><span>{tx('mpc.price')}</span><input inputMode="decimal" value={price} onChange={(e) => edit(setPrice)(e.target.value)} placeholder={tx('mpc.keep')} data-testid="pc-price" /></label>
        <label className="fk-field"><span>{tx('mpc.trial')}</span><input inputMode="numeric" value={trial} onChange={(e) => edit(setTrial)(e.target.value.replace(/\D/g, ''))} placeholder={tx('mpc.keep')} data-testid="pc-trial" /></label>
        <label className="fk-field"><span>{tx('mpc.fee')}</span><input inputMode="decimal" value={fee} onChange={(e) => edit(setFee)(e.target.value)} placeholder={tx('mpc.keep')} data-testid="pc-fee" /></label>
      </div>
      <div className="fk-hint">{tx('mpc.carry')}</div>
      <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => void preview()} data-testid="pc-preview">{tx('mpc.preview')}</button>
      {err ? <div className="fk-err" role="alert" data-testid="pc-error">{err}</div> : null}
      {pv ? <div data-testid="pc-result">
        {pv.blockers.map((b) => <div key={b} className="fk-err" data-testid={'pc-blocker-' + b}>{tx('mpc.blocker.' + b)}</div>)}
        {pv.changes.length ? <table className="fk-table" data-testid="pc-changes"><thead><tr><th>{tx('mpc.col.term')}</th><th>{tx('mpc.col.now', { v: String(pv.currentVersionNumber ?? '—') })}</th><th>{tx('mpc.col.next', { v: String(pv.nextVersionNumber) })}</th></tr></thead>
          <tbody>{pv.changes.map((c) => <tr key={c.field}><td>{tx('mpc.f.' + c.field)}</td><td>{show(c.field, c.from)}</td><td><b>{show(c.field, c.to)}</b></td></tr>)}</tbody></table> : null}
        <div className="fk-note info" data-testid="pc-current">
          <b>{tx('mpc.current', { n: fmtNumber(pv.currentSubscribers.total) })}</b>
          <ul>{pv.currentSubscribers.byVersion.map((v) => <li key={v.versionNumber}>{tx('mpc.byVersion', { v: String(v.versionNumber), price: fmtMoney(v.priceCents), interval: codeLabel('mpc.code', v.billingInterval), n: fmtNumber(v.members) })}</li>)}</ul>
        </div>
        <div className="fk-note" data-testid="pc-future">{tx('mpc.future', { price: fmtMoney(pv.futureSubscribers.priceCents), interval: codeLabel('mpc.code', pv.futureSubscribers.billingInterval) })}
          {pv.futureSubscribers.priceDeltaCents ? ' ' + tx(pv.futureSubscribers.priceDeltaCents > 0 ? 'mpc.up' : 'mpc.down', { d: fmtMoney(Math.abs(pv.futureSubscribers.priceDeltaCents)) }) : ''}</div>
        <div className="fk-hint" data-testid="pc-benefits">{pv.benefits.carriedForward ? tx('mpc.benefitsKept', { n: fmtNumber(pv.benefits.proposed) }) : tx('mpc.benefitsCount', { a: fmtNumber(pv.benefits.current), b: fmtNumber(pv.benefits.proposed) })}</div>
        <button type="button" className="fk-btn primary" disabled={busy || pv.blockers.length > 0} onClick={() => void publish()} data-testid="pc-publish">{tx('mpc.publish', { v: String(pv.nextVersionNumber) })}</button>
      </div> : null}
    </section>
  );
}
