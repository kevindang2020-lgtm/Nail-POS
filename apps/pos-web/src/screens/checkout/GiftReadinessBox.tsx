import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../../i18n/format';
import { codeLabel } from '../../components/peopleLabels';
import { posCheckoutApi } from '../../api/posCheckoutApi';
import { giftReadiness, type GiftLookupAnswer, type GiftReadinessBlocker } from './giftReadiness';

const BLOCKER_KEY: Record<GiftReadinessBlocker, string> = {
  not_found: 'payment.giftReady.blocker.not_found', status: 'payment.giftReady.blocker.status', no_balance: 'payment.giftReady.blocker.no_balance',
  not_here: 'payment.giftReady.blocker.not_here', already_paid: 'payment.giftReady.blocker.already_paid', offline: 'payment.giftReady.blocker.offline',
  phone_claim: 'payment.giftReady.blocker.phone_claim', disabled: 'payment.giftReady.blocker.disabled',
};

/** Gift Cards · 03 Checkout Redemption Readiness: staff tap Check to see eligibility, card balance, ticket due, the
 *  split-tender effect and any blocker BEFORE paying. Read-only: one protected balance check (rate limited and audited on
 *  the server), no debit, no reservation. The answer is cleared as soon as the code or the ticket changes. */
export function GiftReadinessBox({ code, ticketId, dueCents, offline, phoneClaim, giftEnabled }: { code: string; ticketId: string | null; dueCents: number; offline?: boolean; phoneClaim?: boolean; giftEnabled?: boolean }) {
  const [answer, setAnswer] = useState<GiftLookupAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setAnswer(null); setErr(null); }, [code, ticketId]);
  const input = code.trim();
  const check = async () => {
    setBusy(true); setErr(null); setAnswer(null);
    try { setAnswer(await posCheckoutApi.giftCardLookup(input)); }
    catch (e) { setErr(e instanceof Error && e.message ? e.message : tx('payment.giftReady.failed')); }
    finally { setBusy(false); }
  };
  const v = answer ? giftReadiness(answer, dueCents, { offline, phoneClaim, giftEnabled }) : null;
  const row = (id: string, label: string, value: string, color?: string) => (
    <div className="flex justify-between" data-testid={'gift-ready-' + id}><span>{label}</span><b style={color ? { color } : undefined}>{value}</b></div>
  );
  return (
    <div className="text-xs w-full" data-testid="gift-readiness" style={{ background: 'var(--aps-surface-2,#f6f4f1)', borderRadius: 8, padding: '6px 8px' }}>
      <div className="flex items-center justify-between gap-2">
        <b>{tx('payment.giftReady.title')}</b>
        <button type="button" className="border border-[var(--line)] rounded-lg px-2 py-1 font-bold" style={{ minHeight: 32 }} disabled={busy || input.length < 6} onClick={() => { void check(); }} data-testid="gift-ready-check">
          {busy ? tx('pos.loading') : tx('payment.giftReady.check')}
        </button>
      </div>
      {v && answer ? (
        <div className="mt-1 flex flex-col gap-0.5" data-testid="gift-ready-result">
          <div style={{ fontWeight: 700, color: v.ready ? '#2E9E54' : '#C0392B' }} data-testid="gift-ready-verdict">{v.ready ? tx('payment.giftReady.ready') : tx('payment.giftReady.blocked')}</div>
          {answer.found ? row('status', tx('payment.giftReady.status'), codeLabel('gc.status.' + (answer.status ?? ''), answer.status ?? '—') + (answer.viaNetwork ? ` · ${tx('payment.giftReady.network')}` : '')) : null}
          {row('balance', tx('payment.giftReady.balance'), v.balanceCents == null ? '—' : fmtMoney(v.balanceCents))}
          {row('due', tx('payment.giftReady.due'), fmtMoney(v.dueCents))}
          {v.ready ? row('applied', tx('payment.giftReady.applied'), fmtMoney(v.appliedCents)) : null}
          {v.ready ? row('remaining', v.splitNeeded ? tx('payment.giftReady.remainingSplit') : tx('payment.giftReady.remaining'), fmtMoney(v.remainingDueCents), v.remainingDueCents > 0 ? '#C0392B' : '#2E9E54') : null}
          {v.ready && v.cardAfterCents != null ? row('after', tx('payment.giftReady.cardAfter'), fmtMoney(v.cardAfterCents)) : null}
          {v.blockers.map((b) => <div key={b} style={{ color: '#C0392B' }} data-testid={'gift-ready-blocker-' + b}>• {tx(BLOCKER_KEY[b])}</div>)}
          <div style={{ color: 'var(--muted)' }}>{tx('payment.giftReady.previewOnly')}</div>
        </div>
      ) : null}
      {err ? <div role="alert" style={{ color: '#C0392B' }}>{err}</div> : null}
    </div>
  );
}
