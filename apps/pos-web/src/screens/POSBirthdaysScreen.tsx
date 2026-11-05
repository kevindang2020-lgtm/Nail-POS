// POSBirthdaysScreen.tsx — Marketing → Birthdays. Customers celebrating a birthday in the selected month,
// reusing the real customers list birthday filter (GET /pos/customers?birthdayMonth=N). Defaults to the
// current month — the audience for a birthday offer. Read-only, real data (empty when no birthdays on file).
import { useCallback, useEffect, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { monthLong } from '../components/codeLabel';

type Row = { customerId: string; fullName: string; phone: string; email?: string; visitsCount: number; loyaltyTier: string; totalSpendCents: number };
// month names in the POS language, read at render
const MONTHS = (): string[] => Array.from({ length: 12 }, (_, i) => monthLong(i));

export function POSBirthdaysScreen() {
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: number) => {
    setLoading(true); setError(null);
    try { const r: any = await posCustomersApi.byBirthdayMonth(m); setRows((r?.items ?? []) as Row[]); }
    catch (e: any) { setError(reportError(e, 'birthdays')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.birthdays')}</h1><div className="sub">{t('pos.reach_customers_celebrating_this_month')}</div></div>

      <div className="flex items-center gap-3 mt-2 mb-4">
        <label className="sub text-[13px] font-semibold">{t('pos.month')}</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 px-3 border border-[var(--line)] rounded-lg bg-[#FFFDF8] text-sm">
          {MONTHS().map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        {rows ? <span className="sub text-[13px]">{rows.length} {rows.length === 1 ? 'customer' : 'customers'}</span> : null}
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {loading ? <div className="state" style={{ padding: 16 }}>{t('pos.loading')}</div>
          : error ? <div className="err" style={{ margin: 12 }}>{error}</div>
          : !rows || rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_customers_with_a_birthday_in')}{' '}{monthLong(month - 1)}{t('pos.birthdays_appear_here_once_they_re_k7sv')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <table className="tbl">
                  <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.visits')}</th><th>{t('pos.tier')}</th><th>{t('pos.lifetime_spend')}</th></tr></thead>
                  <tbody>{rows.map((c) => (
                    <tr key={c.customerId}>
                      <td><div style={{ fontWeight: 700 }}>{c.fullName}</div><div className="sub" style={{ fontSize: 12 }}>{c.phone || c.email || '—'}</div></td>
                      <td>{c.visitsCount}</td>
                      <td>{c.loyaltyTier || '—'}</td>
                      <td>{money(c.totalSpendCents || 0)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 10 }}>{t('pos.only_customers_with_a_birthday_saved_1t73')}</div>
    </div>
  );
}
