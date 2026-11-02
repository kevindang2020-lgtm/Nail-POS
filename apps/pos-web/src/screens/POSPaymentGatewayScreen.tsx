// POSPaymentGatewayScreen.tsx — Integrations → Payment Gateway. Reads the tenant's real payment-processor
// connection status (GET /pos/payment-gateway/status, masked). Shows the true processor, environment, masked
// merchant ID, and connection/onboarding status. When nothing is configured it says so plainly and points to
// onboarding — no fake "connected" state and no dead credential forms (provisioning is handled server-side /
// via onboarding, not a client form). Processors are Fiserv / CardPointe only, never Stripe/Square.
import { useCallback, useEffect, useState } from 'react';
import { posPaymentGatewayApi, type MaskedPaymentGateway } from '../api/posPaymentGatewayApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// processor brand names stay as written; 'none' and the onboarding stage are labelled at render (admin.gateway.*)
const PROCESSOR_NAME: Record<string, string> = { fiserv: 'Fiserv', cardpointe: 'CardPointe', clover: 'Clover', bolt: 'Bolt' };
const prettyProcessor = (t: string) => (t === 'none' ? tx('pos.not_connected_2') : PROCESSOR_NAME[t] ?? t);
const onboardingLabel = (s: string) => codeLabel('admin.gateway.onboarding', s, 'gateway');

export function POSPaymentGatewayScreen() {
  const [g, setG] = useState<MaskedPaymentGateway | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setG(await posPaymentGatewayApi.status()); }
    catch (e: any) { setError(reportError(e, tx('admin.gateway.noun'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_payment_gateway')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!g) return <div className="work"><div className="state">{tx('pos.no_data')}</div></div>;

  const connected = !g.setupRequired && g.processorType !== 'none';

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.payment_gateway_2')}</h1><div className="sub">{tx('pos.how_this_salon_takes_card_payments')}</div></div>

      <section className="panel" style={{ marginTop: 6, maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: connected ? '#2E9E54' : '#B5651D', display: 'inline-block' }} />
          <span style={{ fontWeight: 800, fontSize: 15 }}>{connected ? tx('pos.connected_processortype', { processorType: String(prettyProcessor(g.processorType)) }) : tx('pos.not_connected_yet_2')}</span>
        </div>

        {connected ? (
          <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[160px_1fr] gap-x-2 gap-y-2 sm:gap-x-4 mt-3.5 text-[13.5px]">
            <div className="sub">{tx('pos.processor_2')}</div><div style={{ fontWeight: 600 }}>{prettyProcessor(g.processorType)}</div>
            <div className="sub">{tx('pos.environment')}</div><div className="break-all">{g.environment || '—'}</div>
            <div className="sub">{tx('pos.merchant_id')}</div><div className="break-all" style={{ fontFamily: 'monospace' }}>{g.merchantIdMasked || '—'}</div>
            <div className="sub">{tx('pos.status')}</div><div className="break-all">{g.status || '—'}</div>
            <div className="sub">{tx('pos.onboarding')}</div><div className="break-all">{onboardingLabel(g.onboardingStatus)}</div>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px' }}>{tx('pos.card_processing_isn_t_set_up_1pig')}{' '}<b>{onboardingLabel(g.onboardingStatus)}</b>.</p>
            <p className="sub" style={{ margin: 0 }}>
              {tx('pos.aipowersalon_processes_cards_through_fiserv_cardpointe_1oqe')}
            </p>
          </div>
        )}
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 620 }}>
        {tx('pos.full_processor_credentials_never_leave_the_1n19')}
      </div>
    </div>
  );
}
