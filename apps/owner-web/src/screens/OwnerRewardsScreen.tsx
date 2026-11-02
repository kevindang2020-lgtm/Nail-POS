// OwnerRewardsScreen.tsx — Owner App → Rewards (Final Completion guide §11). English only; the signed-in owner's salon only.
// What the salon FUNDED (token wallet), what customers EARNED here (points issued + token backing by rule version), what this
// salon ACCEPTED from other salons' customers, what the platform OWES this salon (ageing, on hold) and what payouts have
// ACTUALLY settled (with the provider reference) — owed is never shown as paid. Buy Tokens is not offered here: it sits
// behind the production payment-provider gate (shown as BLOCKED / TEST).
import { useCallback, useEffect, useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { formatCurrency } from '@aipowersalon/money';
import { ownerRewardsApi, type OwnerRewardsView } from '../api/ownerRewardsApi';

const money = (c: number) => formatCurrency(c);
const tokens = (c: number, tv: number) => (c / Math.max(1, tv)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const STATUS: Record<string, string> = { ACCRUED_OWED: 'Owed', PAYOUT_ELIGIBLE: 'Ready for payout', PAYOUT_PENDING: 'Payout in progress', PAID: 'Paid', PAYOUT_FAILED: 'Payout failed — still owed', ON_HOLD: 'On hold', ADJUSTED: 'Adjusted (refund)', OFFSET: 'Recovery claim',
  CONFIRMED_REDEEMED: 'Redeemed', REVERSED: 'Refunded', GLOBAL_DEFAULT: 'AI PowerSalon global rule', TENANT_OVERRIDE: 'Your custom rule' };

export function OwnerRewardsScreen() {
  const { back } = useOwnerNav();
  const [d, setD] = useState<OwnerRewardsView | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); ownerRewardsApi.get().then(setD).catch((e: any) => setErr(e?.message || 'Could not load rewards.')); }, []);
  useEffect(() => { load(); }, [load]);
  const tv = d?.tokenValueCents ?? 100;
  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Rewards</div></div>
        <div style={{ width: 40 }} />
      </header>
      {err ? <div className="owner-state" role="alert">{err} <button onClick={load}>Try again</button></div> : !d ? <div className="owner-state">Loading…</div> : (
        <div style={{ padding: '6px 16px 24px' }} data-testid="owner-rewards">
          {!d.networkOn || !d.enrolled ? <div className="owner-state">{!d.networkOn ? 'The AI PowerSalon Rewards network is not on for your salon yet.' : 'Your salon is not enrolled in the AI PowerSalon Rewards network.'}</div> : null}
          <div className="owner-sechead"><div className="h">Token wallet</div><div className="d">what you funded</div></div>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Available</div><div className="val">{tokens(d.wallet.availableCents, tv)}</div><div className="sub owner-text-muted">{money(d.wallet.availableCents)}</div></div>
            <div className="owner-kpi"><div className="label">Used this month</div><div className="val">{tokens(d.wallet.usedThisMonthCents, tv)}</div><div className="sub owner-text-muted">points funded</div></div>
            <div className="owner-kpi"><div className="label">Pending funding</div><div className="val">{tokens(d.wallet.pendingCents, tv)}</div><div className="sub owner-text-muted">not spendable yet</div></div>
          </div>
          <div className="owner-drill" style={{ marginBottom: 14 }}>
            <div className="owner-drillrow"><div>Funded to date</div><div className="owner-text-muted">{money(d.wallet.lifetimeFundedCents)}</div></div>
            <div className="owner-drillrow"><div>Buy Tokens</div><div className="owner-text-muted" data-testid="owner-buy-state">{d.buyTokens.state === 'TEST_SANDBOX' ? 'TEST — sandbox only, no real money (use the Front Desk POS)' : 'Not available — no approved payment provider yet'}</div></div>
            {d.wallet.deficitCents ? <div className="owner-drillrow"><div>Funding deficit</div><div style={{ color: '#B4472A' }}>{money(d.wallet.deficitCents)}</div></div> : null}
          </div>

          <div className="owner-sechead"><div className="h">Points issued at your salon</div><div className="d">by earning rule</div></div>
          <div className="owner-drill" style={{ marginBottom: 14 }}>{d.issued.byRule.length === 0 ? <div className="owner-drillrow"><div className="owner-text-muted">No points issued yet.</div></div> : d.issued.byRule.map((r, i) => (
            <div className="owner-drillrow" key={i}><div>{STATUS[r.source] ?? r.source}<div className="owner-text-muted" style={{ fontSize: 12 }}>{r.sales} sales · {money(r.backingCents)} of tokens</div></div><div style={{ fontWeight: 700 }}>{r.points} pts</div></div>))}
            {d.issued.blockedForTokens ? <div className="owner-drillrow"><div style={{ color: '#B4472A' }}>{d.issued.blockedForTokens} sale(s) earned nothing — not enough tokens</div></div> : null}</div>

          <div className="owner-sechead"><div className="h">Points accepted from other salons</div><div className="d">cross-salon</div></div>
          <div className="owner-drill" style={{ marginBottom: 14 }} data-testid="owner-rewards-accepted">{d.accepted.length === 0 ? <div className="owner-drillrow"><div className="owner-text-muted">None yet.</div></div> : d.accepted.map((a) => (
            <div className="owner-drillrow" key={a.ref}><div>{a.points} pts · {STATUS[a.status] ?? a.status}<div className="owner-text-muted" style={{ fontSize: 12 }}>{day(a.at)} · {a.ref}</div></div><div style={{ fontWeight: 700 }}>{money(a.valueCents)}</div></div>))}</div>

          <div className="owner-sechead"><div className="h">Owed to your salon</div><div className="d">not yet paid</div></div>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }} data-testid="owner-rewards-owed">
            <div className="owner-kpi"><div className="label">Owed</div><div className="val">{money(d.owed.totalCents)}</div><div className="sub owner-text-muted">{money(d.owed.onHoldCents)} on hold</div></div>
            <div className="owner-kpi"><div className="label">Under 7 days</div><div className="val">{money(d.owed.under7dCents)}</div></div>
            <div className="owner-kpi"><div className="label">Over 30 days</div><div className="val">{money(d.owed.over30Cents)}</div></div>
          </div>
          <div className="owner-drill" style={{ marginBottom: 14 }}>{d.owed.items.length === 0 ? <div className="owner-drillrow"><div className="owner-text-muted">Nothing owed yet.</div></div> : d.owed.items.map((m) => (
            <div className="owner-drillrow" key={m.id}><div>{STATUS[m.status] ?? m.status}<div className="owner-text-muted" style={{ fontSize: 12 }}>accrued {day(m.accruedAt)}{m.holdReason ? ` · ${m.holdReason}` : ''}{m.paidAt ? ` · paid ${day(m.paidAt)} · ref ${m.providerRef}` : ''}</div></div><div style={{ fontWeight: 700 }}>{money(m.amountCents)}</div></div>))}</div>

          <div className="owner-sechead"><div className="h">Payouts</div><div className="d">provider-confirmed only</div></div>
          <div className="owner-drill" style={{ marginBottom: 14 }}>
            <div className="owner-drillrow"><div>Paid to date</div><div style={{ fontWeight: 700 }}>{money(d.payouts.settledCents)}</div></div>
            <div className="owner-drillrow"><div className="owner-text-muted" data-testid="owner-payout-state">{d.payouts.state === 'BLOCKED_EXTERNAL' ? 'Payouts start once AI PowerSalon connects an approved payout provider. Until then amounts stay owed — they are never shown as paid.' : d.payouts.state}</div></div>
          </div>

          {d.alerts.length ? <><div className="owner-sechead"><div className="h">Alerts</div></div>
            <div className="owner-drill">{d.alerts.map((a, i) => <div className="owner-drillrow" key={i}><div><b>{a.title}</b><div className="owner-text-muted" style={{ fontSize: 12 }}>{a.body}</div></div><div className="owner-text-muted" style={{ fontSize: 12 }}>{day(a.at)}</div></div>)}</div></> : null}
        </div>
      )}
    </>
  );
}
