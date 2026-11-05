// SuspendedBillingOnly — Constitution 7 §19: what the owner of a suspended salon sees after signing in to a BILLING-ONLY
// session. Only their AI PowerSalon invoices (the server refuses everything else — this screen just does not offer
// what would be refused). Clear about why, and a way out.
import { POSAccountInvoicesScreen } from './POSAccountInvoicesScreen';
import { useAuth } from '../auth/AuthContext';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function SuspendedBillingOnly() {
  const { logout } = useAuth();
  return (
    <div style={{ minHeight: '100vh' }}>
      <div role="status" data-testid="suspended-billing-banner"
        style={{ background: '#7A1F1F', color: '#fff', padding: '12px 18px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{t('pos.your_salon_is_suspended')}</b>
        <span>{t('pos.you_can_review_your_ai_powersalon_ieve')}</span>
        <button className="btn ghost" style={{ marginLeft: 'auto', color: '#fff', borderColor: '#fff' }} onClick={() => { void logout(); }}>{t('pos.sign_out')}</button>
      </div>
      <div style={{ padding: 16 }}><POSAccountInvoicesScreen /></div>
    </div>
  );
}
