// POSTransactionsScreen.tsx — Payments → Transactions. Wired to GET /pos/reports/transactions
// (permission-gated: financial). A line-by-line transaction ledger for the selected period.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posReportsApi } from '../api/posReportsApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { TicketRefundPanel } from '../components/TicketRefundPanel';
import { useCan } from '../components/usePermissions';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

type TxRow = {
  id: string; ticketId?: string | null; at: string; customer: string; technician: string; service: string;
  paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string;
};
const fmtTime = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };

export function POSTransactionsScreen() {
  const [period, setPeriod] = useState('month');
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Decision 20: refunds from the POS (managers / owners — the checkout override permission the server checks).
  const canRefund = useCan()('checkout.manage_overrides');
  const [refunding, setRefunding] = useState<TxRow | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.transactions({ period })
      .then((d: any) => { if (alive) setRows(Array.isArray(d) ? d : (d?.rows ?? d?.transactions ?? [])); })
      .catch((e: any) => { if (alive) setError(reportError(e, 'transactions')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reload]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_transactions')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = rows || [];
  const gross = list.reduce((a, r) => a + (r.grossCents || 0), 0);
  const tips = list.reduce((a, r) => a + (r.tipCents || 0), 0);
  const net = list.reduce((a, r) => a + (r.netCents || 0), 0);

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.transactions')}</h1><div className="sub">{t('pos.every_payment_for_the_selected_period')}</div></div>
     <div className="overflow-x-auto">
  <div className="min-w-[350px] flex flex-col sm:flex-row justify-between items-stretch sm:items-center mt-3 gap-2"><PeriodTabs period={period} onChange={setPeriod} />
  </div>
  </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.transactions')}</div><div className="v">{list.length}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.gross')}</div><div className="v">{money(gross)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.tips')}</div><div className="v">{money(tips)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.net')}</div><div className="v">{money(net)}</div></div>
      </div>
      {refunding?.ticketId && (
        <div style={{ marginBottom: 12 }}>
          <TicketRefundPanel ticketId={refunding.ticketId} label={refunding.customer || undefined} onClose={() => setRefunding(null)} onDone={() => setReload((n) => n + 1)} />
        </div>
      )}
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {list.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_transactions_in_this_period')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.time')}</th><th>{t('pos.customer')}</th><th>{t('pos.technician')}</th><th>{t('pos.method')}</th><th style={{ textAlign: 'right' }}>{t('pos.gross')}</th><th style={{ textAlign: 'right' }}>{t('pos.tip_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.net')}</th><th>{t('pos.status')}</th>{canRefund && <th />}</tr></thead>
                <tbody>{list.slice(0, 100).map((r) => (
                  <tr key={r.id}>
                    <td>{fmtTime(r.at)}</td><td>{r.customer || '—'}</td><td>{r.technician || '—'}</td><td>{r.paymentMethod ? statusLabel('paymentMethod', r.paymentMethod) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.grossCents)}</td><td style={{ textAlign: 'right' }}>{money(r.tipCents)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.netCents)}</td><td>{statusLabel(['checkoutTicket', 'payment'], r.status)}</td>
                    {canRefund && <td>{r.ticketId && r.status !== 'refunded' ? <button className="btn ghost" onClick={() => setRefunding(r)}>{t('pos.refund')}</button> : null}</td>}
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
