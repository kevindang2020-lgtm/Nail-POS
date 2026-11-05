// POSGiftCardsScreen.tsx — Customers → Gift Cards. Wired to GET /pos/gift-cards/state
// (permission-gated pos.checkout.view). Portfolio of issued gift cards + outstanding liability.
import { useEffect, useState } from 'react';
import { posGiftCardsApi, type GiftCardLiabilityReport } from '../api/posGiftCardsApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { fmtInZone } from '../i18n/format';

type Card = { id: string; code: string; initialBalanceCents: number; balanceCents: number; status: string; customerId: string | null; createdAt: string };
type Summary = { totalCards: number; activeCards: number; redeemedCards: number; voidCards: number; outstandingCents: number; issuedTotalCents: number; redeemedValueCents: number };
type State = { kpis: Summary; cards: Card[] };

const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const statusTone = (s: string) => s === 'active' ? 'var(--ok)' : s === 'void' ? '#B4453C' : 'var(--muted)';

// Functional Decision 31 — gift-card value is the salon's liability; each branch recognizes what it sells and redeems.
// Clearing is per card: when Branch B redeems a card Branch A sold, A holds the payment for B's work, so A owes B. Value
// still on cards is the salon's liability to card holders, not something one branch owes another.
// Reports permission: anyone without it simply doesn't see this panel (the card list above stays available).
export function GiftCardBranchLiability() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [r, setR] = useState<GiftCardLiabilityReport | null>(null);
  const [hidden, setHidden] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = async (f?: string, t?: string) => {
    setError(null);
    try { const d = await posGiftCardsApi.liability(f, t); setR(d); if (!from) setFrom(d.from); if (!to) setTo(d.to); }
    catch (e: any) { if (e?.status === 403) setHidden(true); else setError(e?.message || tx('pos.could_not_load_branch_liability')); }
  };
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden) return null;
  const clearing = (c: number) => c > 0 ? tx('pos.is_owed_c', { c: String(money(c)) }) : c < 0 ? tx('pos.owes_v0', { v0: String(money(-c)) }) : tx('admin.giftCards.even');   // net = owed − owes
  return (
    <section className="panel" style={{ marginBottom: 14 }} aria-label={tx('pos.branch_gift_card_liability')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 8 }}>
        <div><h3 style={{ margin: 0 }}>{tx('pos.branch_liability_clearing')}</h3><div className="s muted">{tx('pos.when_a_branch_redeems_a_card_gpu8')}</div></div>
        <label className="s" style={{ marginLeft: 'auto' }}>{tx('pos.from')}{' '}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="s">{tx('pos.to_2')}{' '}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost" onClick={() => load(from, to)}>{tx('pos.update')}</button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {r ? (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>{tx('pos.branch')}</th><th style={{ textAlign: 'right' }}>{tx('pos.sold')}</th><th style={{ textAlign: 'right' }}>{tx('pos.redeemed')}</th><th style={{ textAlign: 'right' }}>{tx('pos.adjustments')}</th><th style={{ textAlign: 'right' }}>{tx('pos.inter_branch_clearing')}</th></tr></thead>
            <tbody>
              {r.branches.length === 0 ? <tr><td colSpan={5} className="muted">{tx('pos.no_gift_card_activity_in_this_dcys')}</td></tr> : r.branches.map((b) => (
                <tr key={b.branchId ?? 'none'}>
                  <td>{b.branchName}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.soldCents)}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.redeemedCents)}</td>
                  <td style={{ textAlign: 'right' }}>{b.adjustedCents ? money(b.adjustedCents) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{b.branchId === null ? '—' : clearing(b.netClearingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.transfers?.length ? (
            <div style={{ marginTop: 8 }}>
              <div className="s" style={{ fontWeight: 700 }}>{tx('pos.settle_up_for_this_period')}</div>
              <ul className="s" style={{ margin: '4px 0 0 18px' }}>{r.transfers.map((t) => <li key={t.fromBranchId + t.toBranchId}>{t.fromBranchName} {tx('pos.pays')}{' '}{t.toBranchName} {money(t.amountCents)}</li>)}</ul>
            </div>
          ) : null}
          {r.unclearableRedeemedCents ? <div className="s muted" style={{ marginTop: 4 }}>{money(r.unclearableRedeemedCents)} {tx('pos.redeemed_on_cards_whose_selling_branch_110z')}</div> : null}
          <div className="s" style={{ marginTop: 6 }}>{tx('pos.salon_wide_gift_card_liability_today')}{' '}<b>{money(r.outstandingLiabilityCents)}</b></div>
        </div>
      ) : null}
    </section>
  );
}

export function POSGiftCardsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posGiftCardsApi.state() as State; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, tx('pos.gift_cards_4'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_gift_cards')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.no_gift_card_data')}</div></div>;

  const k = s.kpis;
  const cards = (s.cards || []).filter((c) => filter === 'all' || c.status === filter);
  const TABS: [string, string][] = [['all', tx('pos.all')], ['active', codeLabel('admin.giftCards.status', 'active')], ['redeemed', codeLabel('admin.giftCards.status', 'redeemed')], ['void', codeLabel('admin.giftCards.status', 'void')]];

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.gift_cards')}</h1><div className="sub">{tx('pos.issued_gift_cards_and_outstanding_balance_kif6')}</div></div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.outstanding_liability')}</div><div className="v">{money(k.outstandingCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.active_cards')}</div><div className="v">{k.activeCards ?? 0}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.total_issued')}</div><div className="v">{money(k.issuedTotalCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.redeemed_value')}</div><div className="v">{money(k.redeemedValueCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.total_cards')}</div><div className="v">{k.totalCards ?? 0}</div></div>
      </div>
      <GiftCardBranchLiability />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div className="inv-tabs overflow-x-auto whitespace-nowrap flex overflow-y-hidden" role="tablist" aria-label={tx('pos.gift_card_status')} style={{ marginBottom: 0 }}>
          {TABS.map(([val, label]) => (
            <button key={val} role="tab" aria-selected={filter === val} className={filter === val ? 'active' : ''} onClick={() => setFilter(val)}>{label}</button>
          ))}
        </div>
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {cards.length === 0 ? (
          <div className="state" style={{ padding: 16 }}>{s.cards.length === 0 ? tx('pos.no_gift_cards_issued_yet') : tx('pos.no_cards_match_this_filter')}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <table className="tbl">
                <thead><tr><th>{tx('pos.code')}</th><th>{tx('pos.issued')}</th><th style={{ textAlign: 'right' }}>{tx('pos.initial')}</th><th style={{ textAlign: 'right' }}>{tx('pos.balance')}</th><th>{tx('pos.status')}</th></tr></thead>
                <tbody>{cards.slice(0, 200).map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.code}</td>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>{money(c.initialBalanceCents)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.balanceCents)}</td>
                    <td style={{ fontWeight: 700, color: statusTone(c.status) }}>{codeLabel('admin.giftCards.status', c.status)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
