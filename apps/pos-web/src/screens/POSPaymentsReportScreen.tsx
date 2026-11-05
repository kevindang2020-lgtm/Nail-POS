// POSPaymentsReportScreen.tsx — Reports → Payments. Wired to GET /pos/reports/payments
// (permission-gated: financial). Payment-method breakdown for the selected period.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type PaymentsSummary = {
  cardCents: number; cashCents: number; giftCardCents: number; splitCount: number;
  refundsCents: number; cardSurchargeCents: number; processorStatus: string;
};

export function POSPaymentsReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [p, setP] = useState<PaymentsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.payments({ period })
      .then((d: any) => { if (alive) setP(d as PaymentsSummary); })
      .catch((e: any) => { if (alive) setError(reportError(e, t('admin.reports.noun.payments'))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  if (loading && !p) return <div className="work"><div className="state">{t('pos.loading_payments_report')}</div></div>;
  if (error && !p) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!p) return <div className="work"><div className="state">{t('pos.no_payment_data')}</div></div>;

  const collected = (p.cardCents || 0) + (p.cashCents || 0) + (p.giftCardCents || 0);
  const methods: [string, number][] = [[t('glossary.checkout.card'), p.cardCents || 0], [t('glossary.checkout.cash'), p.cashCents || 0], [t('glossary.checkout.giftCard'), p.giftCardCents || 0]];
  const maxM = Math.max(1, ...methods.map(([, v]) => v));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.payments_report')}</h1><div className="sub mb-3">{t('pos.payment_methods_refunds_and_surcharge')}</div></div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between mb-1">
        <PeriodTabs period={period} onChange={setPeriod} />
        <button className="btn ghost  sm:w-auto sm:ml-auto w-fit whitespace-nowrap" title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.payments_report'), { kpis: [{ label: t('pos.collected'), value: money(collected) }, { label: t('pos.refunds'), value: money(p.refundsCents) }, { label: t('pos.surcharge_2'), value: money(p.cardSurchargeCents) }], columns: [t('pos.method'), t('pos.amount_2')], rows: methods.map(([label, v]) => [label, money(v)]), periodLabel: period }))}>{t('pos.full_view')}</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.total_collected')}</div><div className="v">{money(collected)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.card')}</div><div className="v">{money(p.cardCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.cash')}</div><div className="v">{money(p.cashCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.gift_card_2')}</div><div className="v">{money(p.giftCardCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.refunds')}</div><div className="v">{money(p.refundsCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.card_surcharge')}</div><div className="v">{money(p.cardSurchargeCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.split_payments')}</div><div className="v">{p.splitCount ?? 0}</div></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <section className="panel">
          <div className="p-h">{t('pos.by_payment_method')}</div>
          {collected === 0 ? <div className="state">{t('pos.no_payments_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.collected_by_payment_method')}>
              {methods.map(([label, v]) => (
                <div className="bar-col" key={label} title={`${label}: ${money(v)}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((v / maxM) * 140))}px` }} />
                  <div className="bar-l">{label}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.processor_2')}</div>
          <div className="overflow-x-auto">
            <div className="min-w-[300px]">
              <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
                <tbody>
                  <tr><td>{t('pos.processor_status')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.processorStatus || '—'}</td></tr>
                  <tr><td>{t('pos.refunds_issued')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.refundsCents)}</td></tr>
                  <tr><td>{t('pos.card_surcharge_collected')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.cardSurchargeCents)}</td></tr>
                  <tr><td>{t('pos.split_payments_2')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.splitCount ?? 0}</td></tr>
                </tbody>
              </table></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
