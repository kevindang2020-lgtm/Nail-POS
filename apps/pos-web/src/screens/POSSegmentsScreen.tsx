// POSSegmentsScreen.tsx — Marketing → Segments. A marketing lens over the real customer base, reusing the
// customers list segment filter (GET /pos/customers?segment=new|returning|vip) plus the customers state for
// counts. Pick a segment to see who's in it — the audience for a targeted campaign. Read-only, real data.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Row = { customerId: string; fullName: string; phone: string; email?: string; visitsCount: number; loyaltyTier: string; lastVisitDate?: string; totalSpendCents: number };
const SEGMENTS = [
  { key: 'new', get label() { return t('pos.new'); }, get hint() { return t('pos.first_visit_nurture_into_regulars'); } },
  { key: 'returning', get label() { return t('pos.returning'); }, get hint() { return t('pos.two_or_more_visits_your_core_1yml'); } },
  { key: 'vip', label: 'VIP', get hint() { return t('pos.top_customers_reward_and_retain'); } },
] as const;

export function POSSegmentsScreen() {
  const [seg, setSeg] = useState<'new' | 'returning' | 'vip'>('returning');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCounts = useCallback(async () => {
    try {
      const s: any = await posCustomersApi.state();
      const k = s?.kpis ?? s ?? {};
      setCounts({ new: k.newCustomers, returning: k.returningCustomers, vip: k.vipCustomers });
    } catch { /* counts are best-effort; the list below is the source of truth */ }
  }, []);
  const loadSeg = useCallback(async (segment: string) => {
    setLoading(true); setError(null);
    try { const r: any = await posCustomersApi.bySegment(segment); setRows((r?.items ?? []) as Row[]); }
    catch (e: any) { setError(reportError(e, t('growth.noun.segments'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadSeg(seg); }, [seg, loadSeg]);

  const active = useMemo(() => SEGMENTS.find((s) => s.key === seg)!, [seg]);

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.customer_segments')}</h1><div className="sub">{t('pos.build_a_target_audience_for_a_t1q3')}</div></div>

      <div className="seg" style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {SEGMENTS.map((s) => (
          <button key={s.key} onClick={() => setSeg(s.key)}
            className={'btn' + (seg === s.key ? '' : ' ghost')}>
            {s.label}{counts[s.key] != null ? ` · ${counts[s.key]}` : ''}
          </button>
        ))}
      </div>
      <div className="sub" style={{ fontSize: 12.5, marginTop: 8 }}>{active.hint}</div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {loading ? <div className="state" style={{ padding: 16 }}>{t('pos.loading')}</div>
          : error ? <div className="err" style={{ margin: 12 }}>{error}</div>
          : !rows || rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_customers_in_this_segment_yet')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <table className="tbl">
                  <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.visits')}</th><th>{t('pos.tier')}</th><th>{t('pos.last_visit_3')}</th><th>{t('pos.lifetime_spend')}</th></tr></thead>
                  <tbody>{rows.map((c) => (
                    <tr key={c.customerId}>
                      <td><div style={{ fontWeight: 700 }}>{c.fullName}</div><div className="sub" style={{ fontSize: 12 }}>{c.phone || c.email || '—'}</div></td>
                      <td>{c.visitsCount}</td>
                      <td>{c.loyaltyTier || '—'}</td>
                      <td className="sub" style={{ fontSize: 12.5 }}>{c.lastVisitDate || '—'}</td>
                      <td>{money(c.totalSpendCents || 0)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 10 }}>{t('pos.segments_come_straight_from_visit_history_16xt')}</div>
    </div>
  );
}
