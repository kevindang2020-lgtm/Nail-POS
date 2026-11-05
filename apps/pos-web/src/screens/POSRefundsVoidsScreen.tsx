// POSRefundsVoidsScreen.tsx — Payments → Refunds & Voids. Wired to /pos/refunds-voids (pos.checkout.view).
// Read-only money-reversal visibility: refunded and voided payments with per-kind rollups.
import { useCallback, useEffect, useState } from 'react';
import { posRefundsVoidsApi } from '../api/posRefundsVoidsApi';
import { money, reportError } from './reportsCommon';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { fmtInZone } from '../i18n/format';

type Row = { id: string; kind: 'refund' | 'void'; status: string; method: string; amountCents: number; ticketId: string | null; ticketNumber: string | null; processedByName: string | null; createdAt: string };
type Kpis = { refundCount: number; refundedCents: number; voidCount: number; voidedCents: number; totalReversalCount: number; totalReversalCents: number };
type State = { kpis: Kpis; rows: Row[] };

const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const methodLabel = (m: string) => (m ? statusLabel('paymentMethod', m === 'giftCard' ? 'gift_card' : m) : '—');

export function POSRefundsVoidsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posRefundsVoidsApi.state() as State); }
    catch (e: any) { setError(reportError(e, t('admin.refund.noun'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_refunds_voids')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const k = s.kpis;
  const rows = s.rows || [];

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.refunds_voids')}</h1><div className="sub">{t('pos.money_reversal_visibility_across_the_payment_1wqe')}</div></div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.refunds')}</div><div className="v">{money(k.refundedCents)}</div><div className="d">{k.refundCount} {t('pos.refund_3')}{enPlural(k.refundCount === 1 ? '' : 's')}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.voids')}</div><div className="v">{money(k.voidedCents)}</div><div className="d">{k.voidCount} {t('pos.void_2')}{enPlural(k.voidCount === 1 ? '' : 's')}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.total_reversed')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(k.totalReversalCents)}</div><div className="d">{k.totalReversalCount} {t('pos.total_3')}</div></div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.reversal_ledger')}</div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_refunds_or_voids_recorded')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.type')}</th><th>{t('pos.ticket')}</th><th>{t('pos.method')}</th><th style={{ textAlign: 'right' }}>{t('pos.amount_2')}</th><th>{t('pos.processed_by')}</th><th>{t('pos.date')}</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: r.kind === 'void' ? '#FBEAE8' : '#FFF4E0', color: r.kind === 'void' ? '#C0392B' : '#B5821F' }}>{r.kind === 'void' ? t('pos.void') : t('pos.refund')}</span></td>
                    <td>{r.ticketNumber || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>{methodLabel(r.method)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.amountCents)}</td>
                    <td>{r.processedByName || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
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
