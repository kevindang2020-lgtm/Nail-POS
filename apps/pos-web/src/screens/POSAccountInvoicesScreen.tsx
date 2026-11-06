// POSAccountInvoicesScreen.tsx — Account → Invoices. The tenant's own PLATFORM billing invoices
// (subscription/software billing), reusing GET /tenant/account/invoices/state (settings.view). Read-only.
// This is distinct from Payments → Invoices (invoices the salon issues to its customers).
import { useCallback, useEffect, useState } from 'react';
import { fmtYmd } from '../i18n/format';
import { posAccountInvoicesApi } from '../api/posAccountInvoicesApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
type Invoice = { invoiceNumber: string; totalCents: number; amountDueCents: number; status: string; invoiceDate: string | null; dueDate: string | null; retryStatus: string | null };
type Credit = { amountCents: number; remainingCents: number; reason: string | null; status: string };
type State = { tenantId: string; currency: string; plan: string | null; planStatus: string | null; outstandingCents: number; invoices: Invoice[]; credits: Credit[] };

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return fmtYmd(iso, { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const statusChip = (status: string) => {
  const m: Record<string, { bg: string; fg: string }> = {
    paid: { bg: '#E9F6EC', fg: '#2E9E54' }, open: { bg: '#EAF2FB', fg: '#2D6CBF' },
    past_due: { bg: '#FDEEEE', fg: '#C0392B' }, failed: { bg: '#FDEEEE', fg: '#C0392B' },
    partially_paid: { bg: '#FEF2E7', fg: '#B5651D' }, void: { bg: '#F0F0F0', fg: '#777' }, draft: { bg: '#F0F0F0', fg: '#777' },
  };
  const s = m[status] || { bg: '#F0F0F0', fg: '#666' };
  const label = statusLabel('invoice', status);
  return <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{label}</span>;
};

export function POSAccountInvoicesScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posAccountInvoicesApi.state() as State); }
    catch (e: any) { setError(reportError(e, t('admin.noun.billingInvoices'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_invoices')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const availableCredit = (s.credits || []).filter((c) => c.status === 'active' || c.status === 'open').reduce((a, c) => a + (c.remainingCents || 0), 0);

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.billing_invoices')}</h1><div className="sub mb-3">{t('pos.your_subscription_invoices_and_balance')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.amount_due')}</div><div className="v" style={{ color: s.outstandingCents > 0 ? '#C0392B' : 'var(--aps-orange)' }}>{money(s.outstandingCents)}</div></div>
        <div className="kpi"><div className="l">{t('pos.plan')}</div><div className="v" style={{ fontSize: 18 }}>{s.plan || '—'}</div>{s.planStatus ? <div className="d">{s.planStatus}</div> : null}</div>
        <div className="kpi"><div className="l">{t('pos.available_credit')}</div><div className="v">{money(availableCredit)}</div></div>
        <div className="kpi"><div className="l">{t('pos.invoices')}</div><div className="v">{s.invoices.length}</div></div>
      </div>

      <section className="panel mb-3" style={{ padding: 0, overflow: "hidden" }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.invoices')}</div>
        {s.invoices.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_invoices_yet')}</div> : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{t('pos.number')}</th><th>{t('pos.date')}</th><th>{t('pos.due')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.total')}</th><th style={{ textAlign: 'right' }}>{t('pos.amount_due')}</th></tr></thead>
            <tbody>{s.invoices.map((inv) => (
              <tr key={inv.invoiceNumber}>
                <td style={{ fontWeight: 700 }}>{inv.invoiceNumber}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.invoiceDate)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.dueDate)}</td>
                <td>{statusChip(inv.status)}{inv.retryStatus ? <span className="sub" style={{ fontSize: 11, marginLeft: 6 }}>{t('pos.retry_2')}{' '}{inv.retryStatus}</span> : null}</td>
                <td style={{ textAlign: 'right' }}>{money(inv.totalCents)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: inv.amountDueCents > 0 ? '#C0392B' : undefined }}>{money(inv.amountDueCents)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.these_are_your_aipowersalon_subscription_invoices_1q7n')}</div>
    </div>
  );
}
