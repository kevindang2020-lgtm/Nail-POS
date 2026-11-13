// ActionActorLine — extras PAYMENTS 14 (Risk-Aware Quick Action Preview): before a protected money action (refund, void,
// payout) the review names WHO is acting and AT WHICH SALON, read from the signed-in session and the salon's own
// navigation record. Display only: the server decides who may act (permission + step-up), this line never gates anything.
// When the salon name is not set it says so instead of inventing one.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { useAuth } from '../auth/AuthContext';
import { useTenantNavAccess } from '../shell/tenant-access';

export function ActionActorLine({ testId = 'action-actor' }: { testId?: string }) {
  const { principal } = useAuth();
  const nav = useTenantNavAccess(principal?.role, principal?.permissions);
  const actor = principal?.fullName?.trim() || principal?.email?.trim() || tx('aal.unknownActor');
  const salon = nav.salonName?.trim() || tx('aal.unknownSalon');
  return (
    <div className="fk-li-s" data-testid={testId}>
      {tx('aal.line', { u: actor, s: salon })} <span data-testid={testId + '-stepup'}>{tx('aal.stepUp')}</span>
    </div>
  );
}
