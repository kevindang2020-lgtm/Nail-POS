// LoyaltyBonusRequest.tsx — Customer Profile & Global Loyalty Protection guide (Nov 4 2026) §03 / §08.
//
// The ONE way the POS adds points by hand: "Request Bonus Points". The current balance is read-only; the manager enters a
// positive number and a reason; the preview (balance after approval, salon token cost) is the SERVER's; sending creates a
// pending request for the owner (Owner App → Approvals). Nothing moves until the owner approves. Below it, this customer's
// recent requests with their status (waiting / added / not approved / expired / not completed — e.g. not enough tokens).
// Used by the Customer Profile drawer, the Customer Profile screen and the Loyalty screen.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLoyaltyApi, type LoyaltyBonusPreview, type BonusRequestRow } from '../api/posLoyaltyApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';

const REASONS = ['service_recovery', 'birthday', 'loyal_customer', 'referral_thanks', 'other'] as const;
const nf = (n: number) => fmtNumber(n);
const tokens = (cents: number) => (cents / 100).toFixed(2);
export const BONUS_STATUS_KEY: Record<string, string> = {
  pending: 'lb.st.pending', approved: 'lb.st.processing', executed: 'lb.st.completed', execution_failed: 'lb.st.failed',
  rejected: 'lb.st.rejected', expired: 'lb.st.expired', cancelled: 'lb.st.withdrawn',
};

export function LoyaltyBonusRequest({ customerId, currentPoints, canRequest, onSent }: { customerId: string; currentPoints: number | null; canRequest: boolean; onSent?: () => void }) {
  const [pts, setPts] = useState('');
  const [why, setWhy] = useState<(typeof REASONS)[number]>('service_recovery');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<LoyaltyBonusPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [hist, setHist] = useState<BonusRequestRow[] | null>(null);
  const [histErr, setHistErr] = useState(false);
  const n = Math.trunc(Number(pts) || 0);
  const valid = n >= 1 && n <= 5000 && (why !== 'other' || note.trim().length >= 3);

  const loadHist = useCallback(() => posLoyaltyApi.bonusRequests({ customerId, pageSize: 10 }).then((r) => { setHist(r.items); setHistErr(false); }).catch(() => setHistErr(true)), [customerId]);
  useEffect(() => { void loadHist(); }, [loadHist]);
  useEffect(() => {
    if (!valid && !(n >= 1 && n <= 5000)) { setPreview(null); return; }
    const t = setTimeout(() => { posLoyaltyApi.bonusPreview(customerId, n).then(setPreview).catch(() => setPreview(null)); }, 250);
    return () => clearTimeout(t);
  }, [customerId, n, valid]);

  const send = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null); setDone(null);
    const reason = why === 'other' ? note.trim() : `${tx('lb.reason.' + why)}${note.trim() ? ` — ${note.trim()}` : ''}`;
    try {
      await posLoyaltyApi.bonusRequest({ customerId, points: n, reason });
      setDone(tx('lb.sent', { n: nf(n) })); setPts(''); setNote('');
      await loadHist(); onSent?.();
    } catch (e) { setErr(errorTextOf(e, tx('pos.could_not_save'))); }
    finally { setBusy(false); }
  };
  const waiting = (hist ?? []).some((h) => h.status === 'pending');

  return (
    <div data-testid="lb-request" style={{ border: '1px solid #EADBB6', borderRadius: 16, padding: 16, marginBottom: 16, background: '#FAFAF9' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{tx('lb.title')}</div>
      <div style={{ fontSize: 12, color: '#8A7A6D', marginBottom: 12 }}>{tx('lb.subtitle')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div><div style={{ fontSize: 11.5, color: '#8A7A6D', fontWeight: 600 }}>{tx('lb.current')}</div>
          <div data-testid="lb-current" style={{ fontSize: 18, fontWeight: 700 }}>{preview ? nf(preview.currentPoints) : currentPoints == null ? '—' : nf(currentPoints)} {tx('lb.pts')}</div></div>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11.5, color: '#8A7A6D', fontWeight: 600 }}>{tx('lb.add')}</span>
          <input aria-label={tx('lb.add')} data-testid="lb-points" inputMode="numeric" value={pts} disabled={!canRequest || waiting} onChange={(e) => { setPts(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); setDone(null); }}
            placeholder="+10" style={{ border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 15, minHeight: 40 }} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11.5, color: '#8A7A6D', fontWeight: 600 }}>{tx('pos.reason_2')}</span>
          <select aria-label={tx('pos.reason_2')} value={why} disabled={!canRequest || waiting} onChange={(e) => setWhy(e.target.value as (typeof REASONS)[number])} style={{ minHeight: 40, borderRadius: 8, border: '1px solid #EFEAE1', padding: '0 8px' }}>
            {REASONS.map((r) => <option key={r} value={r}>{tx('lb.reason.' + r)}</option>)}
          </select></label>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11.5, color: '#8A7A6D', fontWeight: 600 }}>{tx('lb.note')}</span>
          <input aria-label={tx('lb.note')} value={note} maxLength={200} disabled={!canRequest || waiting} onChange={(e) => setNote(e.target.value)} style={{ border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 14, minHeight: 40 }} /></label>
      </div>
      {preview && n >= 1 ? (
        <div data-testid="lb-preview" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#FFF', border: '1px solid #F1ECE4', borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 13 }}>
          <div>{tx('lb.after')}<div style={{ fontWeight: 700 }}>{nf(preview.pointsAfter)} {tx('lb.pts')}</div></div>
          <div>{preview.tokenCostCents != null ? <>{tx('lb.cost')}<div style={{ fontWeight: 700 }}>{tokens(preview.tokenCostCents)} {tx('lb.tokens')}</div>
            {preview.walletAvailableCents != null && preview.walletAvailableCents < preview.tokenCostCents ? <div style={{ color: '#B3261E', fontSize: 12 }} data-testid="lb-short">{tx('lb.short', { have: tokens(preview.walletAvailableCents) })}</div> : null}</>
            : <>{tx('lb.salonProgram')}</>}</div>
        </div>
      ) : null}
      <div style={{ fontSize: 12, color: '#6B5F55', marginBottom: 10 }}>{tx('lb.previewNote')}</div>
      {waiting ? <div role="status" style={{ fontSize: 12.5, color: '#8B5A18', marginBottom: 8 }} data-testid="lb-waiting">{tx('lb.waiting')}</div> : null}
      {!canRequest ? <div style={{ fontSize: 12.5, color: '#8A7A6D', marginBottom: 8 }}>{tx('lb.noPerm')}</div> : null}
      <button data-testid="lb-send" disabled={!canRequest || waiting || !valid || busy} onClick={send}
        style={{ background: '#2C2A29', color: '#FFF', border: 'none', padding: '10px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 40 }}>{busy ? tx('pos.saving') : tx('lb.send')}</button>
      {done ? <div role="status" style={{ color: '#2E7D32', fontSize: 13, fontWeight: 600, marginTop: 8 }} data-testid="lb-done">{done}</div> : null}
      {err ? <div role="alert" style={{ color: '#B3261E', fontSize: 13, marginTop: 8 }}>{err}</div> : null}

      <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 6px' }}>{tx('lb.history')}</div>
      {histErr ? <div style={{ fontSize: 12.5, color: '#B3261E' }} data-testid="lb-hist-error">{tx('lb.histError')}</div>
        : hist == null ? <div style={{ fontSize: 12.5, color: '#8A7A6D' }}>{tx('pos.loading')}</div>
        : hist.length === 0 ? <div style={{ fontSize: 12.5, color: '#8A7A6D' }} data-testid="lb-hist-empty">{tx('lb.histEmpty')}</div>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="lb-hist">
            {hist.map((h) => (
              <li key={h.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #F1ECE4', fontSize: 12.5 }}>
                <b>+{nf(h.points)}</b>
                <span style={{ flex: 1, color: '#6B5F55' }}>{h.reason}{h.status === 'execution_failed' && h.failureCode === 'LOYALTY_BONUS_NEEDS_FUNDING' ? ` · ${tx('lb.failedFunding')}` : ''}{h.decisionNote ? ` · ${h.decisionNote}` : ''}</span>
                <span data-testid="lb-hist-status">{tx(BONUS_STATUS_KEY[h.status] ?? 'lb.st.pending')}</span>
                <span style={{ color: '#8A7A6D' }}>{fmtInZone(h.createdAt, { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
