import { parseDollarsToCents } from '@aipowersalon/money';
import React from 'react';
import { FiClock, FiPlus, FiCheck } from 'react-icons/fi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';

// Types
export interface ServiceCatalogItem {
  serviceId: string;
  name: string;
  category: string;
  priceCents: number;
  durationMinutes: number;
  icon?: React.ReactNode;
}

export interface AddonItem {
  serviceId: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

// (REFERENCE_SERVICES / REFERENCE_ADDONS — a demo catalog with made-up ids and prices — removed Oct 2 2026: the New
// Booking and Walk-In screens showed it before the real catalog loaded and as the add-on list for salons without an
// "Add-ons" category. The server now refuses ids outside the salon's catalog, so a demo add-on failed the booking.)

// the salon's currency; whole amounts without cents ("$45"), cents only when there are some (i18n/format)
const money = (c: number) => fmtMoney(c || 0, { whole: (c || 0) % 100 === 0 });

// Service Card Component
export function ServiceCard({
  item,
  selected,
  onToggle
}: {
  item: ServiceCatalogItem;
  selected: boolean;
  onToggle: (item: ServiceCatalogItem) => void;
}) {
  return (
    <div
      onClick={() => onToggle(item)}
      style={{
        border: selected ? '2px solid var(--aps-orange)' : '1px solid var(--line)',
        borderRadius: 12,
        padding: 12,
        cursor: 'pointer',
        background: selected ? '#FFF6ED' : '#FFF',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'relative',
        transition: 'all 0.15s ease'
      }}
    >
      <div style={{ flexShrink: 0, color: selected ? 'var(--aps-orange)' : '#7E57C2' }}>
        {item.icon || <div style={{ width: 24, height: 24, background: '#F1E3C8', borderRadius: '50%' }} />}
      </div>
      
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{item.category}</div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#4A4032', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            <FiClock size={12} /> {item.durationMinutes} {t('pos.min')}
          </span>
          <span style={{ fontWeight: 800, fontSize: 13, color: '#4A4032' }}>{money(item.priceCents)}</span>
        </div>
      </div>
      
      <div style={{ flexShrink: 0 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: selected ? 'var(--aps-orange)' : '#FFF',
          border: selected ? 'none' : '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: selected ? '#FFF' : 'var(--text)'
        }}>
          {selected ? <FiCheck size={14} /> : <FiPlus size={14} />}
        </div>
      </div>
    </div>
  );
}

// Addon Card Component
export function AddonCard({
  item,
  selected,
  onToggle
}: {
  item: AddonItem;
  selected: boolean;
  onToggle: (item: AddonItem) => void;
}) {
  return (
    <div
      onClick={() => onToggle(item)}
      style={{
        border: selected ? '2px solid var(--aps-orange)' : '1px solid var(--line)',
        borderRadius: 12,
        padding: '10px 14px',
        cursor: 'pointer',
        background: selected ? '#FFF6ED' : '#FFF',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        transition: 'all 0.15s ease'
      }}
    >
      <div style={{ flexShrink: 0, color: selected ? 'var(--aps-orange)' : '#A96F22' }}>
        <div style={{ width: 20, height: 20, background: '#F1E3C8', borderRadius: '50%' }} />
      </div>
      <div style={{ flexGrow: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#4A4032' }}>{item.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          +{money(item.priceCents)} &middot; +{item.durationMinutes} {t('pos.min')}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: selected ? 'var(--aps-orange)' : '#FFF',
          border: selected ? 'none' : '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: selected ? '#FFF' : 'var(--text)'
        }}>
          {selected ? <FiCheck size={12} /> : <FiPlus size={12} />}
        </div>
      </div>
    </div>
  );
}

export interface PriceOverride {
  priceCents: number;
  reason?: string;
}

// Walk-in/Booking Summary Panel
export function BookingSummary({
  services,
  addons,
  onRemoveService,
  onRemoveAddon,
  priceOverrides = {},
  onPriceOverride,
  onRestorePrice,
  canOverridePrice = true
}: {
  services: ServiceCatalogItem[];
  addons: { addon: AddonItem; parentServiceId: string }[];
  onRemoveService: (id: string) => void;
  onRemoveAddon: (id: string) => void;
  priceOverrides?: Record<string, PriceOverride>;
  onPriceOverride?: (serviceId: string, priceCents: number, reason: string) => void;
  onRestorePrice?: (serviceId: string) => void;
  canOverridePrice?: boolean;
}) {
  const totalServices = services.length;
  const totalAddons = addons.length;

  const [editingSvc, setEditingSvc] = React.useState<ServiceCatalogItem | null>(null);
  const [overrideInput, setOverrideInput] = React.useState('');
  const [overrideReason, setOverrideReason] = React.useState('');
  const [overrideError, setOverrideError] = React.useState<string | null>(null);   // a catalogue KEY, translated at render

  const startEditPrice = (svc: ServiceCatalogItem) => {
    const existing = priceOverrides[svc.serviceId];
    const initialPrice = existing ? (existing.priceCents / 100).toFixed(2) : (svc.priceCents / 100).toFixed(2);
    setEditingSvc(svc);
    setOverrideInput(initialPrice);
    setOverrideReason(existing?.reason || '');
  };

  const saveOverride = () => {
    if (!editingSvc) return;
    const cents = parseDollarsToCents(overrideInput);
    if (cents === null || cents < 0) { setOverrideError('pos.enter_a_valid_price_dollars_and_1qkm'); return; }
    // Decision 38: a manual price override needs a reason — the server refuses one without (no silent 'Custom price').
    if (!overrideReason.trim()) { setOverrideError('ops.booking.priceReasonRequired'); return; }
    setOverrideError(null);
    onPriceOverride?.(editingSvc.serviceId, cents, overrideReason.trim());
    setEditingSvc(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 18, color: '#1f1b16' }}>{t('pos.summary')}</h3>
        <span style={{ fontSize: 12, background: '#F2EFEA', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
          {totalServices} {t('pos.service')}{enPlural(totalServices !== 1 ? 's' : '')} {totalAddons > 0 ? t('pos.totaladdons_add_on_plural', { totalAddons: String(totalAddons), plural: String(totalAddons !== 1 ? 's' : '') }) : ''}
        </span>
      </div>

      {services.map((svc) => {
        const nestedAddons = addons.filter((a) => a.parentServiceId === svc.serviceId);
        const override = priceOverrides[svc.serviceId];
        const effectivePrice = override ? override.priceCents : svc.priceCents;
        const isOverridden = !!override && override.priceCents !== svc.priceCents;

        return (
          <div key={svc.serviceId} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#4A4032', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 24, height: 24, background: '#F1E3C8', borderRadius: '50%', flexShrink: 0 }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 32, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <FiClock size={11} /> {svc.durationMinutes} {t('pos.min')}
                  </span>
                  {isOverridden ? (
                    <span style={{ fontSize: 11, background: '#FFF0DE', color: 'var(--aps-orange)', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>
                      {t('pos.custom')}{' '}{money(effectivePrice)} {override.reason ? `· ${override.reason}` : ''}
                    </span>
                  ) : null}
                  {canOverridePrice && (
                    <button
                      type="button"
                      onClick={() => startEditPrice(svc)}
                      style={{ background: 'none', border: 'none', padding: '1px 4px', fontSize: 11, color: 'var(--aps-orange)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                    >
                      {isOverridden ? t('pos.change_price') : t('pos.edit_price')}
                    </button>
                  )}
                  {isOverridden && onRestorePrice && (
                    <button
                      type="button"
                      onClick={() => onRestorePrice(svc.serviceId)}
                      style={{ background: 'none', border: 'none', padding: '1px 4px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {t('pos.restore_catalog')}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: isOverridden ? 'var(--aps-orange)' : '#1f1b16' }}>
                    {money(effectivePrice)}
                  </span>
                  {isOverridden && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', textDecoration: 'line-through' }}>
                      {money(svc.priceCents)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveService(svc.serviceId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}
                  title={t('pos.remove_service')}
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Nested Add-ons */}
            {nestedAddons.length > 0 && (
              <div style={{ marginTop: 8, paddingLeft: 32, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {nestedAddons.map((item) => (
                  <div key={item.addon.serviceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontSize: 14, color: '#4A4032', fontWeight: 600 }}>{item.addon.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        +{item.addon.durationMinutes} {t('pos.min')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: '#1f1b16' }}>+{money(item.addon.priceCents)}</span>
                      <button 
                        type="button" 
                        onClick={() => onRemoveAddon(item.addon.serviceId)} 
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}
                        title={t('pos.remove_add_on')}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      
      {services.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: '#FFFCF6', borderRadius: 12, border: '1px dashed var(--line)' }}>
          {t('pos.select_a_service_to_start')}
        </div>
      )}

      {/* Edit Price Modal */}
      {editingSvc && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#FFF', borderRadius: 14, padding: '24px 28px',
            width: '90%', maxWidth: 420, boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column', gap: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 18, color: '#1f1b16' }}>{t('pos.edit_service_price')}</h4>
              <button onClick={() => setEditingSvc(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>&times;</button>
            </div>

            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('pos.service_2')}{' '}<strong style={{ color: '#1f1b16' }}>{editingSvc.name}</strong>
              <div style={{ marginTop: 2 }}>{t('pos.catalog_price')}{' '}<strong>{money(editingSvc.priceCents)}</strong></div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4A4032', marginBottom: 6 }}>
                {t('pos.new_price')}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--muted)' }}>$</span>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  autoFocus
                  value={overrideInput}
                  onChange={(e) => setOverrideInput(e.target.value)}
                  style={{ border: 'none', outline: 'none', padding: '8px 6px', fontSize: 16, fontWeight: 700, width: '100%', background: 'transparent' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4A4032', marginBottom: 6 }}>
                {t('pos.override_reason')}
              </label>
              <input
                type="text"
                placeholder={t('pos.e_g_long_nails_extra_art_1j87')}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                style={{ width: '100%', height: 38, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8', fontSize: 13, boxSizing: 'border-box' }}
              />
              {overrideError ? <div className="error" role="alert" style={{ fontSize: 12 }}>{t(overrideError)}</div> : null}
              {/* Quick tags */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {[t('pos.long_nails'), t('pos.complex_nail_art'), t('pos.vip_courtesy'), t('pos.manager_approved')].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setOverrideReason(tag)}
                    style={{
                      border: '1px solid var(--line)', borderRadius: 12, padding: '2px 8px',
                      fontSize: 11, background: overrideReason === tag ? 'var(--aps-orange)' : '#FFFDF8',
                      color: overrideReason === tag ? '#FFF' : '#6A5C45', cursor: 'pointer'
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setEditingSvc(null)}
                style={{ height: 36, padding: '0 14px', fontSize: 13 }}
              >
                {t('pos.cancel')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={saveOverride}
                style={{ height: 36, padding: '0 18px', fontSize: 13, fontWeight: 700 }}
              >
                {t('pos.apply_price_override')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
