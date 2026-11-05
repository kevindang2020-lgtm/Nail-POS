// PaymentGatewayStatusCard.tsx — read-only POS view of THIS tenant's payment gateway (owner/manager).
// Drives GET /pos/payment-gateway/status (tenant derived from session; masked; no secrets are ever returned).
// Configuration is the provider's (Super Admin) job — this card only reports connected processor / merchant (masked) /
// environment / gateway status. Defensive by design: it tolerates request errors and unexpected response shapes
// (rendering '—' / a muted note) so it can never break the Settings board, including under the test's blanket fetch mock.
import { useEffect, useState } from 'react';
import { posSettingsApi } from '../api/posSettingsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

const tone = (s?: string) => (s === 'active' ? 'var(--ok)' : s === 'error' ? 'var(--danger)' : 'var(--warn)');
const str = (v: unknown) => (typeof v === 'string' && v ? v : '—');

export function PaymentGatewayStatusCard() {
  const [gw, setGw] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (posSettingsApi.gatewayStatus() as Promise<unknown>)
      .then((r) => { if (live) setGw(r && typeof r === 'object' ? (r as Record<string, unknown>) : {}); })
      .catch((e: any) => { if (live) setErr(e?.message || 'unavailable'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const status = typeof gw?.status === 'string' ? (gw.status as string) : undefined;
  const setupRequired = gw?.setupRequired === true;
  const known = !!gw && (typeof gw.processorType === 'string' || typeof gw.status === 'string');

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <div className="s" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted">{t('pos.payment_gateway')}</span>
        {status ? <span className={'pill ' + (status === 'active' ? 'ok' : '')} style={{ color: tone(status) }}>{statusLabel('gateway', status)}</span> : null}
        {setupRequired ? <span className="pill" style={{ color: 'var(--warn)' }}>{t('pos.setup_required')}</span> : null}
      </div>
      {loading ? (
        <div className="muted" style={{ marginTop: 4 }}>{t('pos.checking_gateway')}</div>
      ) : err ? (
        <div className="muted" style={{ marginTop: 4 }}>{t('pos.gateway_status_unavailable')}</div>
      ) : !known ? (
        <div className="muted" style={{ marginTop: 4 }}>{t('pos.not_configured_your_provider_sets_this_18pe')}</div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <span className="muted">{t('pos.processor')}</span> {str(gw?.processorType)} · <span className="muted">{t('pos.env')}</span> {str(gw?.environment)} · <span className="muted">{t('pos.merchant')}</span> {str(gw?.merchantIdMasked)}
        </div>
      )}
    </div>
  );
}
