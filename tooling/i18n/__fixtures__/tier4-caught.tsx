// Fixture for tooling/i18n/pos-strings.test.mjs — each block is a shape tier 4 must catch (never imported by the app).
import { t } from '@aipowersalon/mobile-sdk/i18n';

// the Overview Quick Actions tuple (POSOverviewScreen before WP-C1)
const QA: [string, string][] = [['/checkout', 'Take Payment'], ['/booking', 'New Booking']];

// the Checkout status map (POSCheckoutScreen before WP-D2)
const STATUS_LABEL: Record<string, string> = { READY_FOR_CHECKOUT: 'Ready for checkout', PAID: 'Paid', VOIDED: 'Voided' };

// an import-time t(): frozen in the first language
const TITLE = t('pos.overview');

export function Totals({ tax, status, s }: { tax: number; status: string; s: { status: string } }) {
  const line = (label: string, v: number) => <div><span>{label}</span><b>{v}</b></div>;
  return (
    <div>
      {line('Tax', tax)}
      {QA.map(([to, l]) => <a key={to} href={to}>{l}</a>)}
      <span>{STATUS_LABEL[status]}</span>
      <span>{status.replace(/_/g, ' ')}</span>
      <span>{s.status}</span>
      <h1>{TITLE}</h1>
      <b>{tax > 0 ? 'Enabled' : t('pos.disabled')}</b>
      <i>{tax + ' days ago'}</i>
    </div>
  );
}
