// POSSplitPaymentsScreen.tsx — Payments → Split Payments. Read-only view of tickets settled with 2+
// tenders (e.g. part cash + part card), reusing the split-payments backend (pos.checkout.view).
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posSplitPaymentsApi } from '../api/posSplitPaymentsApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

type Tender = { paymentId: string; method: string; amountCents: number; createdAt: string };
type Ticket = { ticketId: string; ticketNumber: string | null; customerName: string | null; totalCents: number; tenderCount: number; methods: string[]; tenders: Tender[]; settledAt: string };
type State = { kpis: { splitTicketCount: number; totalSplitCents: number; averageTenders: number }; tickets: Ticket[] };

const fmtDateTime = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const methodLabel = (m: string) => m ? statusLabel('paymentMethod', m) : tx('payment.method.unknown');

export function POSSplitPaymentsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posSplitPaymentsApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'split payments')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_split_payments')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.no_data')}</div></div>;

  const tickets = s.tickets || [];
  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.split_payments')}</h1><div className="sub">{tx('pos.tickets_settled_with_more_than_one_vzjj')}</div></div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.split_tickets')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{s.kpis.splitTicketCount}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.split_total')}</div><div className="v">{money(s.kpis.totalSplitCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.avg_tenders_ticket')}</div><div className="v">{s.kpis.averageTenders}</div></div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.split_tender_tickets')}</div>
        {tickets.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_split_tender_payments_found')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <table className="tbl">
                <thead><tr><th>{tx('pos.ticket')}</th><th>{tx('pos.customer')}</th><th>{tx('pos.settled')}</th><th>{tx('pos.tenders')}</th><th style={{ textAlign: 'right' }}>{tx('pos.total')}</th></tr></thead>
                <tbody>{tickets.map((t) => (
                  <tr key={t.ticketId}>
                    <td style={{ fontWeight: 700 }}>{t.ticketNumber ? `#${t.ticketNumber}` : '—'}</td>
                    <td>{t.customerName || <span style={{ color: 'var(--muted)' }}>{tx('pos.walk_in_2')}</span>}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{fmtDateTime(t.settledAt)}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {t.tenders.map((tn) => (
                          <span key={tn.paymentId} style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: '#FBF3E6', color: '#B5821F' }}>
                            {methodLabel(tn.method)} {money(tn.amountCents)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(t.totalCents)}</td>
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
