// Fixture for tooling/i18n/pos-strings.test.mjs — the translated forms of tier4-caught.tsx: tier 4 must find nothing.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../../../apps/pos-web/src/i18n/status-label';

const QA = (): [string, string][] => [['/checkout', t('ops.overview.qa.takePayment')], ['/booking', t('ops.overview.qa.newBooking')]];
const STATUS_KEY: Record<string, string> = { READY_FOR_CHECKOUT: 'payment.status.ready', PAID: 'payment.status.paid' };
const MODES = new Set(['Cash', 'Card']);
type Tone = 'Good' | 'Bad';

export function Totals({ tax, status, s, tone }: { tax: number; status: string; s: { status: string }; tone: Tone }) {
  const line = (label: string, v: number) => <div><span>{label}</span><b>{v}</b></div>;
  if (tone === 'Good' && MODES.has('Cash')) return null;
  return (
    <div style={{ fontFamily: 'Inter', textAlign: 'center' }}>
      {line(t('glossary.tax'), tax)}
      {QA().map(([to, l]) => <a key={to} href={to}>{l}</a>)}
      <span>{t(STATUS_KEY[status])}</span>
      <span>{statusLabel('checkoutTicket', status)}</span>
      <span>{statusLabel('checkoutTicket', s.status)}</span>
    </div>
  );
}
