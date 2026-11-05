// POSGiftCardSettingsScreen.tsx — Payments & Money → Gift Cards. Reads/writes the server-enforced
// `gift-card-settings` block (GET/PATCH /pos/settings/gift-card-settings). Owner-gated server-side (a 403 surfaces
// inline). Money is edited in dollars and saved as integer cents; the backend validates min≤max, positive whole-cent
// presets, and the token TTL range. Network gift cards are shown honestly as pending program approval — the toggles
// save tenant intent, but cross-salon redemption isn't active until the clearing/settlement phase ships.
import { useCallback, useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posSettingsApi } from '../api/posSettingsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const CAT = 'gift-card-settings';

type GC = {
  enabled: boolean; posSalesEnabled: boolean; customerAppSalesEnabled: boolean; sendToFriendEnabled: boolean;
  presetAmountsCents: number[]; customAmountEnabled: boolean; minAmountCents: number; maxAmountCents: number;
  crossBranchRedemption: boolean; expirationPolicy: string; partialRedemption: boolean; multiplePerCheckout: boolean;
  refundToCardDefault: boolean; transferable: boolean; scheduledDeliveryEnabled: boolean;
  deliveryChannels: { sms: boolean; email: boolean; inApp: boolean };
  barcodeFormat: string; presentationTokenTtlSeconds: number; managerApprovalOverCents: number;
  dailyPurchaseLimitCents: number; networkGiftCardsEnabled: boolean; sellNetworkGiftCards: boolean;
  redeemNetworkGiftCards: boolean; termsVersion: string;
};

const sectionStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' };
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${LINE}`, fontSize: 14 };
const inputStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', width: 90, textAlign: 'right' };

function MoneyField({ label, cents, onSave, disabled }: { label: string; cents: number; onSave: (c: number) => void; disabled?: boolean }) {
  const [v, setV] = useState((cents / 100).toFixed(2));
  useEffect(() => { setV((cents / 100).toFixed(2)); }, [cents]);
  return (
    <div style={rowStyle}>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: MUTED }}>$</span>
      <input value={v} disabled={disabled} inputMode="decimal" aria-label={label} style={inputStyle}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const c = (parseDollarsToCents(v || '0') ?? 0); if (Number.isFinite(c) && c >= 0) onSave(c); }} />
    </div>
  );
}

export function POSGiftCardSettingsScreen() {
  const [s, setS] = useState<GC | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setS(await posSettingsApi.getCategory(CAT) as GC); }
    catch { setErr(t('pos.could_not_load_gift_card_settings')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: Partial<GC>) => {
    setBusy(true); setErr(null);
    try { setS(await posSettingsApi.updateCategory(CAT, patch as Record<string, unknown>) as GC); }
    catch (e: any) {
      const m = String(e?.message || '');
      setErr(m.includes('403') ? t('pos.you_don_t_have_permission_to_f2gq') : (m || t('pos.could_not_save_2')));
    }
    finally { setBusy(false); }
  }, []);

  if (loading) return <div style={{ padding: 20, color: MUTED }}>{t('pos.loading_gift_card_settings')}</div>;
  if (!s) return <div style={{ padding: 20 }}><div style={{ color: '#a12d2d', fontSize: 13 }}>{err || t('pos.no_settings')}</div></div>;

  const off = !s.enabled;
  const Toggle = ({ k, label, disabled }: { k: keyof GC; label: string; disabled?: boolean }) => (
    <label style={rowStyle}>
      <input type="checkbox" checked={!!s[k]} disabled={busy || disabled} onChange={(e) => save({ [k]: e.target.checked } as Partial<GC>)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="p-4 sm:p-5 max-w-[720px]">
      <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{t('pos.gift_cards')}</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px' }}>{t('pos.configure_how_your_salon_sells_delivers_17ik')}</p>
      {err && <div style={{ color: '#a12d2d', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <section style={sectionStyle}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="flex items-center gap-2.5">
            <strong>{t('pos.gift_cards_2')}</strong>
            <span style={{ padding: '2px 8px', borderRadius: 20, border: `1px solid ${LINE}`, color: s.enabled ? GOLD : '#a12d2d', fontWeight: 700, fontSize: 12 }}>{s.enabled ? t('pos.enabled') : t('pos.disabled')}</span>
          </div>
          <button className="w-full sm:w-auto sm:ml-auto mt-2 sm:mt-0" style={{ border: 'none', background: GOLD, color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600 }} disabled={busy} onClick={() => save({ enabled: !s.enabled })}>
            {busy ? t('pos.saving_2') : s.enabled ? t('pos.turn_off') : t('pos.turn_on')}
          </button>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.where_cards_are_sold')}</div>
        <Toggle k="posSalesEnabled" label={t('pos.sell_at_the_pos')} disabled={off} />
        <Toggle k="customerAppSalesEnabled" label={t('pos.sell_in_the_customer_app')} disabled={off} />
        <Toggle k="sendToFriendEnabled" label={t('pos.let_customers_send_a_gift_to_91oj')} disabled={off} />
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.amounts')}</div>
        <div style={{ ...rowStyle, borderTop: 'none' }}>
          <span style={{ flex: 1 }}>{t('pos.preset_amounts')}</span>
          <span style={{ color: MUTED, fontSize: 13 }}>{s.presetAmountsCents.map((c) => '$' + (c / 100).toFixed(0)).join(' · ')}</span>
        </div>
        <Toggle k="customAmountEnabled" label={t('pos.allow_a_custom_amount')} disabled={off} />
        <MoneyField label={t('pos.minimum_amount')} cents={s.minAmountCents} disabled={busy || off} onSave={(c) => save({ minAmountCents: c })} />
        <MoneyField label={t('pos.maximum_amount')} cents={s.maxAmountCents} disabled={busy || off} onSave={(c) => save({ maxAmountCents: c })} />
        <MoneyField label={t('pos.daily_purchase_limit_per_customer')} cents={s.dailyPurchaseLimitCents} disabled={busy || off} onSave={(c) => save({ dailyPurchaseLimitCents: c })} />
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.redemption')}</div>
        <Toggle k="partialRedemption" label={t('pos.allow_partial_redemption')} disabled={off} />
        <Toggle k="multiplePerCheckout" label={t('pos.allow_multiple_gift_cards_per_checkout')} disabled={off} />
        <Toggle k="crossBranchRedemption" label={t('pos.redeemable_at_all_of_this_salon_1tof')} disabled={off} />
        <Toggle k="transferable" label={t('pos.allow_customer_to_customer_transfer')} disabled={off} />
        <Toggle k="refundToCardDefault" label={t('pos.refund_service_payments_back_to_the_1avs')} disabled={off} />
        <div style={rowStyle}>
          <span style={{ flex: 1, minWidth: 200 }}>{t('pos.expiration')}</span>
          <select value={s.expirationPolicy} className="w-full sm:w-auto" disabled={busy || off} aria-label={t('pos.expiration_policy')} onChange={(e) => save({ expirationPolicy: e.target.value })} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px' }}>
            <option value="none">{t('pos.no_expiration')}</option>
            <option value="12_months">{t('pos.12_months')}</option>
            <option value="24_months">{t('pos.24_months')}</option>
            <option value="36_months">{t('pos.36_months')}</option>
          </select>
        </div>
        <MoneyField label={t('pos.manager_approval_required_over')} cents={s.managerApprovalOverCents} disabled={busy || off} onSave={(c) => save({ managerApprovalOverCents: c })} />
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.delivery')}</div>
        <label style={rowStyle}>
          <input type="checkbox" checked={s.deliveryChannels.sms} disabled={busy || off} onChange={(e) => save({ deliveryChannels: { ...s.deliveryChannels, sms: e.target.checked } })} />
          <span>{t('pos.deliver_by_sms')}</span>
        </label>
        <label style={rowStyle}>
          <input type="checkbox" checked={s.deliveryChannels.email} disabled={busy || off} onChange={(e) => save({ deliveryChannels: { ...s.deliveryChannels, email: e.target.checked } })} />
          <span>{t('pos.deliver_by_email')}</span>
        </label>
        <label style={rowStyle}>
          <input type="checkbox" checked={s.deliveryChannels.inApp} disabled={busy || off} onChange={(e) => save({ deliveryChannels: { ...s.deliveryChannels, inApp: e.target.checked } })} />
          <span>{t('pos.deliver_in_the_customer_app')}</span>
        </label>
        <Toggle k="scheduledDeliveryEnabled" label={t('pos.allow_scheduling_delivery_for_a_future_1up7')} disabled={off} />
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.code_security')}</div>
        <div style={rowStyle}>
          <span style={{ flex: 1, minWidth: 200 }}>{t('pos.barcode_format')}</span>
          <select value={s.barcodeFormat} className="w-full sm:w-auto" disabled={busy || off} aria-label={t('pos.barcode_format')} onChange={(e) => save({ barcodeFormat: e.target.value })} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px' }}>
            <option value="qr">{t('pos.qr_code')}</option>
            <option value="code128">{t('pos.code_128_barcode')}</option>
          </select>
        </div>
        <div style={rowStyle}>
          <span style={{ flex: 1 }}>{t('pos.redemption_code_lifetime')}</span>
          <input type="number" min={30} max={600} defaultValue={s.presentationTokenTtlSeconds} disabled={busy || off} aria-label={t('pos.redemption_code_lifetime_seconds')} style={inputStyle}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n)) save({ presentationTokenTtlSeconds: n }); }} />
          <span style={{ color: MUTED, fontSize: 13 }}>{t('pos.sec')}</span>
        </div>
        <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>{t('pos.the_scanned_code_is_a_short_e0g0')}</p>
      </section>

      <section style={{ ...sectionStyle, borderColor: GOLD }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('pos.ai_powersalon_network_gift_cards')}</div>
        <div style={{ background: '#FBF3E4', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: MUTED, marginBottom: 8 }}>
          {t('pos.pending_program_approval_network_gift_cards_nmld')}
        </div>
        <Toggle k="networkGiftCardsEnabled" label={t('pos.interested_in_the_network_gift_card_9bt1')} disabled={off} />
        <Toggle k="sellNetworkGiftCards" label={t('pos.sell_network_gift_cards_once_approved')} disabled={off || !s.networkGiftCardsEnabled} />
        <Toggle k="redeemNetworkGiftCards" label={t('pos.accept_network_gift_cards_once_approved')} disabled={off || !s.networkGiftCardsEnabled} />
      </section>
    </div>
  );
}
