// POSPromotionsScreen.tsx — Marketing → Promotions. Wired to /pos/salon-promotions
// (pos.marketing.view read, pos.marketing.manage write). Manage salon coupon codes: create,
// pause/activate/archive, and view the portfolio + redemption counts.
import { useCallback, useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posSalonPromotionsApi } from '../api/posSalonPromotionsApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

type Promo = { id: string; code: string; name: string; discountType: 'percent' | 'fixed'; discountPercent: number | null; discountCents: number | null; minPurchaseCents: number; status: string; startsAt: string | null; endsAt: string | null; maxRedemptions: number | null; redemptionCount: number; createdAt: string };
type Summary = { total: number; active: number; paused: number; totalRedemptions: number; expiringSoon: number };
type State = { kpis: Summary; promotions: Promo[] };

const discountLabel = (p: Promo) => p.discountType === 'percent' ? `${p.discountPercent ?? 0}%` : money(p.discountCents || 0);
const statusTone = (s: string) => s === 'active' ? 'var(--ok)' : s === 'archived' || s === 'expired' ? '#B4453C' : 'var(--muted)';

export function POSPromotionsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', discountType: 'percent', discountValue: '', minPurchase: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posSalonPromotionsApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'promotions')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy('create'); setNote(null);
    try {
      const body: Record<string, unknown> = { code: form.code.trim(), name: form.name.trim(), discountType: form.discountType, minPurchaseCents: (parseDollarsToCents(form.minPurchase) ?? 0) };
      if (form.discountType === 'percent') body.discountPercent = parseFloat(form.discountValue) || 0;
      else body.discountCents = (parseDollarsToCents(form.discountValue) ?? 0);
      await posSalonPromotionsApi.create(body);
      setShowAdd(false); setForm({ code: '', name: '', discountType: 'percent', discountValue: '', minPurchase: '' });
      setNote(t('pos.promotion_created')); await load();
    } catch (e: any) { setNote(e?.message || t('pos.could_not_create_the_promotion')); }
    finally { setBusy(null); }
  };

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    try { await posSalonPromotionsApi.setStatus(id, status); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_update_the_promotion')); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_promotions')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_promotion_data')}</div></div>;

  const k = s.kpis;
  const promos = s.promotions || [];

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.promotions')}</h1><div className="sub">{t('pos.coupon_codes_and_discounts_for_your_1gks')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.total')}</div><div className="v">{k.total ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.active_3')}</div><div className="v">{k.active ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.paused')}</div><div className="v">{k.paused ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.redemptions')}</div><div className="v">{k.totalRedemptions ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.expiring_soon')}</div><div className="v">{k.expiringSoon ?? 0}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button className={showAdd ? "btn" : "btn primary"} onClick={() => { setShowAdd((v) => !v); setNote(null); }}>{showAdd ? t('pos.close') : t('pos.new_promotion')}</button>
        {note ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>{note}</span> : null}
      </div>

      {showAdd ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="p-h">{t('pos.create_promotion')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
            <label className="lf"><span>{t('pos.code')}</span><input placeholder={t('pos.e_g_spring20')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ width: '100%' }} /></label>
            <label className="lf"><span>{t('pos.name')}</span><input placeholder={t('pos.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} /></label>
            <div className="lf">
              <label>{t('pos.discount_type')}</label>
              <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })} style={{ width: '100%' }}>
                <option value="percent">{t('pos.percent')}</option>
                <option value="fixed">{t('pos.fixed')}</option>
              </select>
            </div>
            <label className="lf"><span>{form.discountType === 'percent' ? t('pos.discount_3') : t('pos.discount_4')}</span><input placeholder={form.discountType === 'percent' ? '20' : '10.00'} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} style={{ width: '100%' }} /></label>
            <label className="lf"><span>{t('pos.min_purchase_2')}</span><input placeholder={t('pos.optional_2')} value={form.minPurchase} onChange={(e) => setForm({ ...form, minPurchase: e.target.value })} style={{ width: '100%' }} /></label>
          </div>
          <div className="mt-4 pt-4 flex gap-3" style={{ borderTop: '1px solid var(--line)' }}>
            <button className="btn" disabled={busy === 'create' || !form.code.trim() || !form.name.trim()} onClick={create}>{busy === 'create' ? t('pos.creating') : t('pos.create_promotion')}</button>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {promos.length === 0 ? (
          <div className="state" style={{ padding: 16 }}>{t('pos.no_promotions_yet_create_a_coupon_17xb')}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.code')}</th><th>{t('pos.name')}</th><th style={{ textAlign: 'right' }}>{t('pos.discount_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.redemptions')}</th><th>{t('pos.status')}</th><th></th></tr></thead>
                <tbody>{promos.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{p.code}</td>
                    <td>{p.name}</td>
                    <td style={{ textAlign: 'right' }}>{discountLabel(p)}</td>
                    <td style={{ textAlign: 'right' }}>{p.redemptionCount}{p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ''}</td>
                    <td style={{ fontWeight: 700, color: statusTone(p.status) }}>{codeLabel('admin.promotions.status', p.status, 'deal')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {p.status === 'active' ? <button className="btn ghost" disabled={busy === p.id} onClick={() => setStatus(p.id, 'paused')}>{t('pos.pause')}</button> : null}
                      {p.status === 'paused' ? <button className="btn ghost" disabled={busy === p.id} onClick={() => setStatus(p.id, 'active')}>{t('pos.activate')}</button> : null}
                      {p.status !== 'archived' ? <button className="btn ghost" style={{ marginLeft: 6 }} disabled={busy === p.id} onClick={() => setStatus(p.id, 'archived')}>{t('pos.archive')}</button> : null}
                    </td>
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
