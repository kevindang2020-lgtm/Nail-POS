// SuspendedBillingOnly — Constitution 7 §19, Owner App: the owner of a salon suspended for a cause that keeps billing
// access signs in to a BILLING-ONLY session. The server allows only billing routes; this shows exactly that — the
// hardware payment plan, its invoices and autopay setup — and why.
import { OwnerNavProvider } from '../shell/nav';
import { HardwarePaymentScreen } from './HardwarePaymentScreen';
import { useAuth } from '../auth/AuthContext';

export function SuspendedBillingOnly() {
  const { logout } = useAuth() as any;
  return (
    <div className="owner-app">
      <div role="status" data-testid="suspended-billing-banner"
        style={{ background: '#7A1F1F', color: '#fff', padding: '12px 16px', display: 'grid', gap: 6 }}>
        <b>Your salon is suspended.</b>
        <span>Billing is still available: review your payment plan and invoices, or set up a card below. Everything else returns once AI PowerSalon reactivates the account.</span>
        <button className="owner-btn ghost" style={{ justifySelf: 'start', color: '#fff', borderColor: '#fff' }} onClick={() => { void logout?.(); }}>Sign out</button>
      </div>
      <OwnerNavProvider><HardwarePaymentScreen /></OwnerNavProvider>
    </div>
  );
}
