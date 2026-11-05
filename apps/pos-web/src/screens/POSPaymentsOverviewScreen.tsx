import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

// POS Payments & Money — Payments Overview. Reads the REAL /pos/payments/overview aggregation (payments + tickets +
// settlement/refund ledgers, tenant + branch scoped, integer cents). Every number is sourced from captured payments;
// the screen shows honest empty/zero state until payments exist rather than fabricating the mockup figures.
type Overview = {
  kpis: { todayRevenueCents: number; todayCollectionsCents: number; refundsIssuedCents: number; outstandingBalanceCents: number; totalTransactions: number; averageTicketCents: number; failedTransactions: number; pendingPayoutsCents: number };
  totals: { totalRevenueCents: number; totalCollectedCents: number; totalRefundsCents: number; outstandingBalanceCents: number; totalTipsCents: number; totalPayoutsCents: number };
  revenueTrend: { day: string; revenueCents: number }[];
  paymentMethods: { method: string; count: number; amountCents: number }[];
  topServices: { name: string; revenueCents: number }[];
  health: { successful: number; failed: number; chargebacks: number; refundRatePercent: number; collectionRatePercent: number; healthScorePercent: number };
  transactions: { paymentId: string; ticketNumber?: string; customerName?: string; serviceName?: string; method: string; amountCents: number; status: string; type: string; createdAt: string }[];
  upcomingPayouts: { label: string; amountCents: number; scheduledFor?: string | null }[];
};

const money = (c?: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const sTone = (s: string) => (/approv|paid|complete|settled/i.test(s) ? 'ok' : /declin|fail|refund|void/i.test(s) ? 'warn' : '');

const Donut = ({ items }: { items: { label: string; count: number; sub?: string }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_payments_captured_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 104, height: 104, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '1px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66' }}>{Math.round((it.count / total) * 100)}%{it.sub ? ` · ${it.sub}` : ''}</span></div>))}</div>
    </div>
  );
};

// tab ids are codes; their words come from ns/payment at render (WP-D2)
const TABS = ['All Transactions', 'Payments', 'Refunds', 'Voids', 'Pending', 'Failed'] as const;
const TAB_KEY: Record<typeof TABS[number], string> = { 'All Transactions': 'payment.tab.all', Payments: 'payment.tab.payments', Refunds: 'payment.tab.refunds', Voids: 'payment.tab.voids', Pending: 'payment.tab.pending', Failed: 'payment.tab.failed' };

export function POSPaymentsOverviewScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('All Transactions');

  useEffect(() => {
    (api.get('/pos/payments/overview') as Promise<Overview>)
      .then((d) => setS(d))
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_payments_overview')));
  }, []);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_payments')}</div></div>;

  const k = s.kpis;
  const kpis = [
    { l: tx('pos.today_s_revenue'), v: money(k.todayRevenueCents) },
    { l: tx('pos.today_s_collections'), v: money(k.todayCollectionsCents) },
    { l: tx('pos.refunds_issued_3'), v: money(k.refundsIssuedCents) },
    { l: tx('pos.outstanding_balance'), v: money(k.outstandingBalanceCents) },
    { l: tx('pos.total_transactions'), v: String(k.totalTransactions) },
    { l: tx('pos.average_ticket'), v: k.averageTicketCents > 0 ? money(k.averageTicketCents) : '—' },
    { l: tx('pos.failed_transactions'), v: String(k.failedTransactions), warn: k.failedTransactions > 0 },
    { l: tx('pos.pending_payouts'), v: money(k.pendingPayoutsCents) },
  ];
  const trendMax = Math.max(1, ...s.revenueTrend.map((x) => x.revenueCents));
  const methodItems = s.paymentMethods.map((m) => ({ label: statusLabel('paymentMethod', m.method), count: m.amountCents, sub: money(m.amountCents) }));
  const topMax = Math.max(1, ...s.topServices.map((x) => x.revenueCents));
  const txFiltered = s.transactions.filter((t) => {
    if (tab === 'All Transactions') return true;
    if (tab === 'Payments') return t.type === 'Payment';
    if (tab === 'Refunds') return t.type === 'Refund';
    if (tab === 'Voids') return t.type === 'Void';
    if (tab === 'Pending') return /processing|pending/i.test(t.status);
    if (tab === 'Failed') return /declin|fail/i.test(t.status);
    return true;
  });
  const totals = [
    { l: tx('pos.total_revenue'), v: money(s.totals.totalRevenueCents) },
    { l: tx('pos.total_collected'), v: money(s.totals.totalCollectedCents) },
    { l: tx('pos.total_refunds'), v: money(s.totals.totalRefundsCents) },
    { l: tx('pos.outstanding_balance'), v: money(s.totals.outstandingBalanceCents) },
    { l: tx('pos.total_tips'), v: money(s.totals.totalTipsCents) },
    { l: tx('pos.total_payouts'), v: money(s.totals.totalPayoutsCents) },
  ];

  return (
    <div className="work">
      <div className="vh"><h1>{tx('pos.payments_money')}</h1><div className="sub">{tx('pos.manage_all_payments_transactions_refunds_and_c0nn')}</div></div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5 mb-3.5 mt-2.5">{kpis.map((c) => (<div className="kpi" key={c.l} style={{ width: '100%', margin: 0 }}><div className="l">{c.l}</div><div className="v" style={(c as any).warn ? { color: 'var(--danger)' } : undefined}>{c.v}</div></div>))}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
        <section className="panel">
          <h2>{tx('pos.revenue_overview')}{' '}<span className="s">{tx('pos.last_7_days')}</span></h2>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#A96F22', margin: '4px 0 8px' }}>{money(s.totals.totalRevenueCents)}</div>
          {s.revenueTrend.length === 0 ? <div className="muted">{tx('pos.no_revenue_yet')}</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 96 }}>
              {s.revenueTrend.map((x) => (
                <div key={x.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ width: '64%', height: `${Math.round((x.revenueCents / trendMax) * 76)}px`, minHeight: 2, background: '#A96F22', borderRadius: 3 }} title={tx('pos.revenuecents_on_day', { revenueCents: String(money(x.revenueCents)), day: String(x.day) })} />
                  <div style={{ fontSize: 9, color: '#8A7A66' }}>{x.day.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel"><h2>{tx('pos.payment_methods_breakdown')}</h2><Donut items={methodItems} /></section>
        <section className="panel">
          <h2>{tx('pos.top_services_by_revenue')}</h2>
          {s.topServices.length === 0 ? <div className="muted">{tx('pos.no_paid_services_yet')}</div> : (
            <div className="list">
              {s.topServices.map((x, i) => (
                <div key={x.name} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', fontSize: 12 }}><span>{i + 1}. {x.name}</span><span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(x.revenueCents)}</span></div>
                  <div style={{ height: 6, background: '#EFE6D6', borderRadius: 3 }}><div style={{ width: `${Math.round((x.revenueCents / topMax) * 100)}%`, height: 6, background: '#A96F22', borderRadius: 3 }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>{tx('pos.payment_health')}</h2>
          <div style={{ fontSize: 28, fontWeight: 800, color: s.health.healthScorePercent >= 90 ? '#6BAF92' : '#A96F22' }}>{s.health.healthScorePercent}%</div>
          <div className="s" style={{ marginBottom: 8 }}>{s.health.healthScorePercent >= 90 ? tx('pos.excellent') : s.health.successful + s.health.failed === 0 ? tx('pos.no_activity_yet_2') : tx('admin.payments.monitor')}</div>
          <div className="list">
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.successful_transactions')}</div><div style={{ marginLeft: 'auto' }}>{s.health.successful}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.failed_transactions')}</div><div style={{ marginLeft: 'auto' }}>{s.health.failed}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.chargebacks')}</div><div style={{ marginLeft: 'auto' }}>{s.health.chargebacks}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.refund_rate')}</div><div style={{ marginLeft: 'auto' }}>{s.health.refundRatePercent}%</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.collection_rate')}</div><div style={{ marginLeft: 'auto' }}>{s.health.collectionRatePercent}%</div></div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2.2fr_1fr] gap-3 mt-3">
        <section className="panel">
          <h2>{tx('pos.transactions')}</h2>
          <div className="inv-tabs overflow-x-auto whitespace-nowrap flex overflow-y-hidden" style={{ margin: '4px 0 10px' }}>
            {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>{tx(TAB_KEY[t])}</button>)}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <div className="list">
                {txFiltered.length === 0 ? <div className="muted">{tx('pos.no_transactions_in_this_view_yet')}</div> : null}
                {txFiltered.map((t) => (
                  <div className="row" key={t.paymentId}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">{t.customerName || tx('pos.guest')}{t.ticketNumber ? <span className="s" style={{ marginLeft: 6 }}>#{t.ticketNumber}</span> : null}</div>
                      <div className="s">{t.serviceName || '—'} · {statusLabel('paymentMethod', t.method)} · {fmtTime(t.createdAt)}</div>
                    </div>
                    <div style={{ fontWeight: 700, marginRight: 10 }}>{money(t.amountCents)}</div>
                    <span className={'pill ' + sTone(t.status)}>{statusLabel(['payment', 'refund'], t.status)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel">
            <h2>{tx('pos.upcoming_payouts')}</h2>
            {s.upcomingPayouts.length === 0 ? <div className="muted">{tx('pos.no_pending_payouts')}</div> : (
              <div className="overflow-x-auto">
                <div className="min-w-[400px]">
                  <div className="list">
                    {s.upcomingPayouts.map((p, i) => (
                      <div className="row" key={i}><div className="t" style={{ flex: 1 }}>{p.label}{p.scheduledFor ? <div className="s">{fmtTime(p.scheduledFor)}</div> : null}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(p.amountCents)}</div></div>
                    ))}
                    <div className="row" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 6 }}><div className="t" style={{ flex: 1, fontWeight: 700 }}>{tx('pos.total_pending')}</div><div style={{ marginLeft: 'auto', fontWeight: 800 }}>{money(k.pendingPayoutsCents)}</div></div>
                  </div>
                </div>
              </div>
            )}
          </section>
          <section className="panel">
            <h2>{tx('pos.recent_transactions')}</h2>
            {s.transactions.length === 0 ? <div className="muted">{tx('pos.no_recent_transactions')}</div> : (
              
                  <div className="list">
                    {s.transactions.slice(0, 6).map((t) => (
                      <div className="row" key={t.paymentId}><div className="t" style={{ flex: 1, minWidth: 0 }}>{t.customerName || tx('pos.guest')}<div className="s">{t.serviceName || '—'}</div></div><div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{money(t.amountCents)}</div><span className={'pill ' + sTone(t.status)} style={{ fontSize: 10 }}>{statusLabel('payment', String(t.status))}</span></div></div>
                    ))}
                  </div>
            
            )}
          </section>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-3">{totals.map((c) => (<div className="kpi" key={c.l} style={{ width: '100%', margin: 0 }}><div className="l">{c.l}</div><div className="v">{c.v}</div></div>))}</div>

      <section className="panel" style={{ marginTop: 12 }}>
        <h2>{tx('pos.quick_actions_2')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {[
            { l: tx('pos.record_payment'), fn: () => nav('/checkout') },
            { l: tx('pos.issue_refund'), fn: () => nav('/tenant/payments/refunds-voids') },
            { l: tx('pos.new_invoice_2'), fn: () => nav('/tenant/payments/invoices') },
            { l: tx('pos.add_tip'), fn: () => nav('/tenant/payments/tips') },
            { l: tx('pos.process_payout'), fn: () => nav('/tenant/payments/settlements') },
            { l: tx('pos.financial_report'), fn: () => nav('/reports') },
            { l: tx('pos.reconcile'), fn: () => nav('/tenant/payments/transactions') },
            { l: tx('pos.settings'), fn: () => nav('/tenant/payments/terminals') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>
    </div>
  );
}
