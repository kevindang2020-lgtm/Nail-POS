// POSPaymentsReportScreen.tsx — Reports → Payments (SUNMI batch 9 guide 13, Nov 10 2026). GET /pos/reports/payments
// (financial). Preserved: title, Full View, the seven cards, By Payment Method and the Processor panel.
// Fixed: the period tabs did nothing (`period` sent, `preset` read); Total Collected summed only card + cash + gift card
// (cash to technician, rewards, deposits … fell out) — now every collected method, with "Other methods" shown; Split
// Payments was a constant 0 — now tickets paid with two or more payment rows.
// Added: custom dates (URL), every method in the chart, and the period's payment rows (the Daily Summary list: newest
// first, searchable, paged). Read only — refunds and voids stay in Transactions.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence, money, reportError, useUrlPeriod } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar } from '../components/FinanceKit';
import { statusLabel } from '../i18n/status-label';
import { TransactionsPage } from './POSReportsScreen';

type PaymentsSummary = {
  cardCents: number; cashCents: number; giftCardCents: number; splitCount: number;
  refundsCents: number; cardSurchargeCents: number; processorStatus: string;
  byMethod?: Record<string, number>; otherCents?: number; collectedCents?: number;
};

export function POSPaymentsReportScreen() {
  const { reloadKey } = useReportCadence();
  const { period, setPeriod, query } = useUrlPeriod('month');
  const [p, setP] = useState<PaymentsSummary | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; timezone?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    Promise.all([posReportsApi.payments(query), Promise.resolve(posReportsApi.state(query)).catch(() => null)])
      .then(([d, st]: any[]) => { if (alive) { setP(d as PaymentsSummary); setRange(st?.dateRange ?? null); } })
      .catch((e: any) => { if (alive) { setP(null); setError(reportError(e, t('admin.reports.noun.payments'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  const server = range ? { preset: period.preset, from: range.from, to: range.to, tz: range.timezone ?? '', today: range.to } : null;
  const collected = p ? (p.collectedCents ?? (p.cardCents || 0) + (p.cashCents || 0) + (p.giftCardCents || 0)) : 0;
  const methods: [string, number][] = p ? (p.byMethod && Object.keys(p.byMethod).length
    ? Object.entries(p.byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => [statusLabel('paymentMethod', m), v])
    : [[t('glossary.checkout.card'), p.cardCents || 0], [t('glossary.checkout.cash'), p.cashCents || 0], [t('glossary.checkout.giftCard'), p.giftCardCents || 0]]) : [];
  const maxM = Math.max(1, ...methods.map(([, v]) => v));
  const card = (label: string, value: string, testId?: string) => <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{label}</div><div className="v" data-testid={testId}>{value}</div></div>;

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.payments_report')}</h1><div className="sub mb-3">{t('pos.payment_methods_refunds_and_surcharge')}</div></div>
      <div className="flex flex-wrap gap-2 items-center justify-between mb-1">
        <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: t('rpt.basisPaid') }]} />
        <button className="btn ghost w-fit whitespace-nowrap" disabled={!p} title={t('pos.open_full_ipad_view')} onClick={() => p && openIPad(reportRequest(t('pos.payments_report'), { kpis: [{ label: t('pos.collected'), value: money(collected) }, { label: t('pos.refunds'), value: money(p.refundsCents) }, { label: t('pos.surcharge_2'), value: money(p.cardSurchargeCents) }], columns: [t('pos.method'), t('pos.amount_2')], rows: methods.map(([label, v]) => [label, money(v)]), periodLabel: range ? `${range.from} – ${range.to}` : undefined }))}>{t('pos.full_view')}</button>
      </div>
      {loading && !p ? <div className="state">{t('pos.loading_payments_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {p ? (<>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-3.5 mt-2.5">
          {card(t('pos.total_collected'), money(collected), 'pay-collected')}
          {card(t('pos.card'), money(p.cardCents))}
          {card(t('pos.cash'), money(p.cashCents))}
          {card(t('pos.gift_card_2'), money(p.giftCardCents))}
          {card(t('rpt.pay.other'), money(p.otherCents ?? 0), 'pay-other')}
          {card(t('pos.refunds'), money(p.refundsCents))}
          {card(t('pos.card_surcharge'), money(p.cardSurchargeCents))}
          {card(t('pos.split_payments'), String(p.splitCount ?? 0), 'pay-split')}
        </div>
        <div className="s mb-2" data-testid="pay-basis">{t('rpt.pay.basis')}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <section className="panel">
            <div className="p-h">{t('pos.by_payment_method')}</div>
            {collected === 0 ? <div className="state">{t('pos.no_payments_in_this_period')}</div> : (
              <div role="list" aria-label={t('pos.collected_by_payment_method')}>
                {methods.map(([label, v]) => (
                  <div key={label} role="listitem" title={`${label}: ${money(v)}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr) auto', gap: 10, alignItems: 'center', minHeight: 36 }}>
                    <span>{label}</span>
                    <span style={{ height: 12, background: 'var(--line)', borderRadius: 6 }}><span style={{ display: 'block', height: 12, width: `${Math.round((v / maxM) * 100)}%`, minWidth: v ? 3 : 0, background: 'var(--gold)', borderRadius: 6 }} /></span>
                    <span className="num">{money(v)} · {collected ? `${Math.round((v / collected) * 1000) / 10}%` : t('rpt.na')}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="p-h">{t('pos.processor_2')}</div>
            <div className="overflow-x-auto w-full"><table className="tbl w-full">
              <tbody>
                <tr><td>{t('pos.processor_status')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.processorStatus || '—'}</td></tr>
                <tr><td>{t('pos.refunds_issued')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.refundsCents)}</td></tr>
                <tr><td>{t('pos.card_surcharge_collected')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.cardSurchargeCents)}</td></tr>
                <tr><td>{t('pos.split_payments_2')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.splitCount ?? 0}</td></tr>
              </tbody>
            </table></div>
            <div className="s mt-1">{t('rpt.pay.processorNote')}</div>
          </section>
        </div>
        <section className="panel mb-3 mt-3">
          <h2>{t('pos.transactions')}</h2>
          <TransactionsPage period={query} money={money} />
        </section>
      </>) : null}
    </div>
  );
}
