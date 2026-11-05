// GlobalRewardsTender.tsx — Checkout: use AI PowerSalon Rewards points (Final Completion guide §04). English + Vietnamese.
// Shows what the ticket's customer may use HERE now (server quote: verified + opted in, whole $1 blocks, capped at what the
// ticket owes). "Use" places a HOLD paired with one tender row (one request key per intent; a retry re-sends it). The
// points are spent — and this salon is owed the value — only when the ticket is paid. "Remove" releases them on an unpaid
// ticket. Nothing about the customer's activity at other salons is shown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber } from '../i18n/format';
import { requestId } from './FitKit';

type Quote = { available: boolean; code?: string; availableTenths?: number; heldTenths?: number; maxBlocks?: number; pointsPerRedeemBlock?: number; redeemBlockValueCents?: number; dueCents?: number;
  current?: { redemptionId: string; pointTenths: number; valueCents: number; status: string; expiresAt: string | null } | null;
  /** C1 audit (Nov 4 2026): the expected earning of this sale (an estimate; decided when the ticket is paid) */
  earn?: { available: boolean; pointTenths?: number; belowMinimum?: boolean; reason?: string } | null };
const pts = (tenths: number) => fmtNumber((tenths || 0) / 10, 1);
const REASON: Record<string, string> = { REWARDS_NOT_OPTED_IN: 'rn.co.notJoined', REWARDS_IDENTITY_NOT_VERIFIED: 'rn.co.notVerified', LOYALTY_DISABLED: 'rn.co.off', MERCHANT_NOT_ENROLLED: 'rn.co.notEnrolled' };

export function GlobalRewardsTender({ ticketId, isPaid, onChanged }: { ticketId: string; isPaid: boolean; onChanged: () => void | Promise<void> }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [blocks, setBlocks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const intent = useRef<{ sig: string; key: string } | null>(null);
  const load = useCallback(() => { setErr(null); posCheckoutApi.rewardsQuote(ticketId).then((r) => { setQ(r); setBlocks((b) => Math.max(1, Math.min(b, r?.maxBlocks || 1))); }).catch(() => setQ(null)); }, [ticketId]);
  useEffect(() => { intent.current = null; load(); }, [load]);
  if (!q) return null;
  const cur = q.current && ['HELD', 'CONFIRMED_REDEEMED'].includes(q.current.status) ? q.current : null;
  const blockValue = q.redeemBlockValueCents ?? 100; const blockPts = q.pointsPerRedeemBlock ?? 10;

  const use = async () => {
    const sig = `${ticketId}:${blocks}`;
    if (!intent.current || intent.current.sig !== sig) intent.current = { sig, key: requestId() };   // same intent → same key on retry
    setBusy(true); setErr(null);
    try { await posCheckoutApi.payRewards(ticketId, blocks, intent.current.key); intent.current = null; await onChanged(); load(); }
    catch (e) { setErr(errorTextOf(e, tx('rn.co.failed'))); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await posCheckoutApi.removeRewards(ticketId); await onChanged(); load(); } catch (e) { setErr(errorTextOf(e, tx('rn.co.failed'))); } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap" data-testid="co-global-rewards">
      <label className="text-xs text-[var(--muted)] font-bold">{tx('rn.co.label')}</label>
      {cur ? (
        <span className="inline-flex items-center gap-1.5 bg-[#FFF3DD] text-[#7A5410] rounded-md px-2.5 py-1 text-xs font-bold" data-testid="co-global-rewards-applied">
          {tx(cur.status === 'HELD' ? 'rn.co.held' : 'rn.co.redeemed', { points: pts(cur.pointTenths), amount: fmtMoney(cur.valueCents) })}
          {!isPaid && cur.status === 'HELD' ? <button aria-label={tx('rn.co.remove')} title={tx('rn.co.remove')} disabled={busy} onClick={() => void remove()} className="border-none bg-transparent text-[#7A5410] cursor-pointer font-extrabold">×</button> : null}
        </span>
      ) : !q.available ? (
        <span className="text-xs text-[var(--muted)]" data-testid="co-global-rewards-unavailable">{tx(REASON[q.code ?? ''] ?? 'rn.co.off')}</span>
      ) : (q.maxBlocks ?? 0) < 1 ? (
        <span className="text-xs text-[var(--muted)]">{tx('rn.co.notEnough', { points: pts(q.availableTenths ?? 0), need: fmtNumber(blockPts) })}</span>
      ) : (
        <>
          <span className="text-xs">{tx('rn.co.has', { points: pts(q.availableTenths ?? 0) })}</span>
          <select aria-label={tx('rn.co.amount')} value={blocks} onChange={(e) => setBlocks(Number(e.target.value))} disabled={busy || isPaid} className="border border-[var(--line)] rounded-lg p-1 text-xs" data-testid="co-global-rewards-blocks">
            {Array.from({ length: q.maxBlocks ?? 0 }, (_, i) => i + 1).map((b) => <option key={b} value={b}>{tx('rn.co.option', { amount: fmtMoney(b * blockValue), points: fmtNumber(b * blockPts) })}</option>)}
          </select>
          <button disabled={busy || isPaid} onClick={() => void use()} className="border border-[var(--line)] bg-white rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer" data-testid="co-global-rewards-use">{tx('rn.co.use')}</button>
        </>
      )}
      {q.earn?.available && !isPaid ? <span className="text-xs text-[var(--muted)]" data-testid="co-global-rewards-earn">
        {(q.earn.pointTenths ?? 0) > 0 ? tx('rn.co.earns', { points: pts(q.earn.pointTenths ?? 0) }) : tx(q.earn.belowMinimum ? 'rn.co.earnsBelowMin' : 'rn.co.earnsNone')}</span> : null}
      {err ? <span role="alert" className="text-xs text-[#B4472A]">{err}</span> : null}
    </div>
  );
}
