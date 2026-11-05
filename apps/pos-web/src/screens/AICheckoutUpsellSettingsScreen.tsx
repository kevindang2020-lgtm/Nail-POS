// AICheckoutUpsellSettingsScreen.tsx — AI Center → Checkout Upsell Assistant. Enable/disable (kill switch), category
// toggles, and fatigue caps. Reads effective settings; writes at the tenant level. Manager-gated server-side (a 403
// surfaces inline). Disabling the assistant never affects checkout, payments, or any domain module.
import { useCallback, useEffect, useState } from 'react';
import { posAiCheckoutUpsellApi as apiU } from '../api/posAiCheckoutUpsellApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'addOnsEnabled', get label() { return tx('pos.service_add_ons'); } }, { key: 'productsEnabled', get label() { return tx('pos.retail_products'); } },
  { key: 'membershipEnabled', get label() { return tx('pos.memberships'); } }, { key: 'loyaltyEnrollEnabled', get label() { return tx('pos.loyalty_enrollment'); } },
  { key: 'loyaltyRedeemEnabled', get label() { return tx('pos.loyalty_redemption'); } }, { key: 'giftCardEnabled', get label() { return tx('pos.gift_cards_2'); } },
  { key: 'rebookingEnabled', get label() { return tx('pos.rebooking'); } },
];
const CAPS: { key: string; label: string; max: number }[] = [
  { key: 'maxTotal', get label() { return tx('pos.max_suggestions_shown'); }, max: 8 }, { key: 'maxAddOn', get label() { return tx('pos.max_add_ons'); }, max: 5 }, { key: 'maxProduct', get label() { return tx('pos.max_products'); }, max: 5 },
];

export function AICheckoutUpsellSettingsScreen() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setS(await apiU.settings()); } catch { setErr(tx('pos.could_not_load_settings')); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: { enabled?: boolean; tunables?: any }) => {
    setBusy(true); setErr(null);
    try { setS(await apiU.updateSettings('tenant', patch)); }
    catch (e: any) { setErr(String(e?.message || '').includes('403') ? tx('pos.you_don_t_have_permission_to_144i') : tx('pos.could_not_save_2')); }
    finally { setBusy(false); }
  }, []);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_settings')}</div></div>;

  const t = s?.tunables || {};
  const toggleCategory = (key: string, val: boolean) => save({ tunables: { ...t, [key]: val } });
  const setCap = (key: string, val: number) => save({ tunables: { ...t, [key]: val } });

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.checkout_upsell_assistant')}</h1>
        <div className="sub mb-3">{tx('pos.suggests_relevant_add_ons_products_memberships_14pd')}</div>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: '#F9FAFB', border: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.assistant_status')}</div>
        <span style={{ background: s?.enabled ? '#E8F5E9' : '#FDECEC', color: s?.enabled ? '#2E7D32' : '#B3261E', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', display: 'inline-block' }}>{s?.enabled ? tx('pos.enabled_2') : tx('pos.disabled_3')}</span>
        {!s?.enabled && s?.disabledAtLevel && <span style={{ fontSize: 13, color: '#6B7280' }}>{tx('pos.off_at_the')}{' '}{s.disabledAtLevel} {tx('pos.level')}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn whitespace-nowrap" style={{ height: 34, padding: '0 16px', fontSize: 13 }} disabled={busy} onClick={() => save({ enabled: !s?.enabled })}>
          {busy ? tx('pos.saving_2') : s?.enabled ? tx('pos.disable_for_this_salon') : tx('pos.enable_for_this_salon')}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="panel" style={{ flex: '1 1 300px', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.suggestion_categories')}</div>
          <div style={{ padding: '0 16px' }}>
            {CATEGORIES.map((c, i) => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < CATEGORIES.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14, color: '#374151', cursor: (busy || !s?.enabled) ? 'not-allowed' : 'pointer', opacity: (busy || !s?.enabled) ? 0.6 : 1 }}>
                <input type="checkbox" checked={t[c.key] !== false} disabled={busy || !s?.enabled} onChange={(e) => toggleCategory(c.key, e.target.checked)} style={{ width: 16, height: 16, cursor: 'inherit' }} />
                {c.label}
              </label>
            ))}
          </div>
        </section>

        <section className="panel" style={{ flex: '1 1 300px', padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
          <div style={{ padding: '14px 16px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.limits')}</div>
          <div style={{ padding: '0 16px' }}>
            {/* Functional Decision 27: suggestions may add at most the LOWER of these two to a visit (defaults $30 / 30%). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{tx('pos.max_added_value_per_visit')}</span>
              <select className="in" aria-label={tx('pos.max_added_value_per_visit')} value={Number(t.maxAddedValueCents ?? 3000)} disabled={busy || !s?.enabled} onChange={(e) => setCap('maxAddedValueCents', Number(e.target.value))} style={{ border: '1px solid var(--line)' }}>
                {[1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000].map((c) => <option key={c} value={c}>${c / 100}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{tx('pos.and_at_most_this_share_of_6115')}</span>
              <select className="in" aria-label={tx('pos.max_share_of_booked_services')} value={Number(t.maxAddedPercent ?? 30)} disabled={busy || !s?.enabled} onChange={(e) => setCap('maxAddedPercent', Number(e.target.value))} style={{ border: '1px solid var(--line)' }}>
                {[10, 15, 20, 25, 30, 40, 50].map((pc) => <option key={pc} value={pc}>{pc}%</option>)}
              </select>
            </div>
            {CAPS.map((c, i) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: i < CAPS.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14, color: '#374151', opacity: (busy || !s?.enabled) ? 0.6 : 1 }}>
                <span>{c.label}</span>
                <select className="in" value={Number(t[c.key] ?? 2)} disabled={busy || !s?.enabled} onChange={(e) => setCap(c.key, Number(e.target.value))} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: '#fff', outline: 'none', cursor: (busy || !s?.enabled) ? 'not-allowed' : 'pointer', width: 64, textAlign: 'center' }}>
                  {Array.from({ length: c.max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
