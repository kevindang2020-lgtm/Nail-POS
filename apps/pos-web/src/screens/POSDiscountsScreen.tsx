// POSDiscountsScreen.tsx — Services → Discounts. A catalog-side, read-focused reference for the discounts
// currently live in the salon-promotions engine (the same backend that powers Marketing → Promotions).
// It answers "what discounts apply right now and what do they do", and points to Marketing → Promotions
// for creating/editing. Reuses /pos/salon-promotions/state (pos.marketing.view) — no new backend.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { useNavigate } from 'react-router-dom';
import { posSalonPromotionsApi } from '../api/posSalonPromotionsApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Promo = { id: string; code: string; name: string; discountType: 'percent' | 'fixed'; discountPercent: number | null; discountCents: number | null; minPurchaseCents: number; status: string; startsAt: string | null; endsAt: string | null; maxRedemptions: number | null; redemptionCount: number; createdAt: string };
type State = { kpis: { total: number; active: number; paused: number; totalRedemptions: number; expiringSoon: number }; promotions: Promo[] };

const fmtDate = (iso?: string | null) => { if (!iso) return null; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };

// Effective discount label, e.g. "20% off" or "$5.00 off".
function effectiveLabel(p: Promo): string {
  if (p.discountType === 'percent') return t('pos.v0_off_2', { v0: String(p.discountPercent ?? 0) });
  return t('pos.v0_off', { v0: String(money(p.discountCents ?? 0)) });
}
// What the discount yields on a sample $100.00 ticket (catalog-manager reference).
function sampleValueCents(p: Promo, sampleCents = 10000): number {
  if (p.minPurchaseCents && sampleCents < p.minPurchaseCents) return 0;
  if (p.discountType === 'percent') return Math.round((sampleCents * (p.discountPercent ?? 0)) / 100);
  return Math.min(sampleCents, p.discountCents ?? 0);
}
function windowLabel(p: Promo): string {
  const s = fmtDate(p.startsAt); const e = fmtDate(p.endsAt);
  if (s && e) return `${s} – ${e}`;
  if (e) return t('pos.until_e', { e: String(e) });
  if (s) return t('pos.from_s', { s: String(s) });
  return t('pos.no_end_date');
}
function remainingLabel(p: Promo): string {
  if (p.maxRedemptions == null) return t('pos.redemptioncount_used', { redemptionCount: String(p.redemptionCount) });
  const remaining = Math.max(0, p.maxRedemptions - p.redemptionCount);
  return `${p.redemptionCount} / ${p.maxRedemptions} used · ${remaining} left`;
}

export function POSDiscountsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posSalonPromotionsApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'discounts')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_discounts')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const all = s.promotions || [];
  // Catalog lens: what's live or scheduled (exclude archived/expired), most valuable first.
  const live = all.filter((p) => p.status === 'active' || p.status === 'paused' || p.status === 'draft')
    .sort((a, b) => sampleValueCents(b) - sampleValueCents(a));
  const percentCount = live.filter((p) => p.discountType === 'percent').length;
  const fixedCount = live.filter((p) => p.discountType === 'fixed').length;
  const activeCount = live.filter((p) => p.status === 'active').length;

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between items-start xl:items-center">
        <div className="vh"><h1>{t('pos.discounts')}</h1><div className="sub">{t('pos.discount_rules_currently_live_across_your_1yi3')}</div></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.active_discounts')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{activeCount}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.percent_off_2')}</div><div className="v">{percentCount}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.fixed_amount')}</div><div className="v">{fixedCount}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.redemptions')}</div><div className="v">{s.kpis?.totalRedemptions ?? 0}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.expiring_soon')}</div><div className="v">{s.kpis?.expiringSoon ?? 0}</div></div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 my-3">
        <div className="sub" style={{ fontSize: 12.5 }}>{t('pos.discounts_are_managed_as_coupon_codes_w1qz')}</div>
        <button className="btn ghost" onClick={() => nav('/tenant/marketing/promotions')}>{t('pos.manage_in_promotions')}</button>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 10 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.live_scheduled_discounts')}</div>
        {live.length === 0 ? (
          <div className="state" style={{ padding: 16 }}>
            {t('pos.no_active_discounts_create_coupon_codes_112j')}{' '}<button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => nav('/tenant/marketing/promotions')}>{t('pos.marketing_promotions')}</button>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.code')}</th><th>{t('pos.discount_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.on_a_100_ticket')}</th><th>{t('pos.min_purchase')}</th><th>{t('pos.valid')}</th><th>{t('pos.usage')}</th><th>{t('pos.status')}</th></tr></thead>
                <tbody>{live.map((p) => {
                  const sample = sampleValueCents(p);
                  return (
                    <tr key={p.id} style={p.status !== 'active' ? { opacity: 0.6 } : undefined}>
                      <td style={{ fontWeight: 700 }}>{p.code}<div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400 }}>{p.name}</div></td>
                      <td style={{ color: 'var(--aps-orange)', fontWeight: 700 }}>{effectiveLabel(p)}</td>
                      <td style={{ textAlign: 'right' }}>{sample > 0 ? `−${money(sample)}` : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td>{p.minPurchaseCents > 0 ? money(p.minPurchaseCents) : <span style={{ color: 'var(--muted)' }}>{t('pos.none')}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{windowLabel(p)}</td>
                      <td style={{ fontSize: 12.5 }}>{remainingLabel(p)}</td>
                      <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: p.status === 'active' ? '#E9F6EC' : '#FFF4E0', color: p.status === 'active' ? '#2E9E54' : '#B5821F' }}>{p.status[0].toUpperCase() + p.status.slice(1)}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
