// membership-charge.wiring.ts — the API's composition root wires the LIVE membership renewal charge (Constitution 13:
// cross-module composition lives here, not inside a module — memberships must not depend on payments, which closed a
// module cycle).
//
// MEMBERSHIP_AUTOBILL_ENABLED=1 provides 'MembershipChargePort' = the member's saved default card charged through the
// tenant's own gateway as a merchant-initiated, scheduled stored credential (cof 'M', cofscheduled 'Y'). Unset, the
// provider resolves to undefined and MembershipBillingService keeps its unconfigured adapter: nothing is charged.
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { CardPointeMembershipChargeAdapter, membershipAutobillEnabled, renewalChargeFn, type MembershipChargePort } from '@aipowersalon/memberships';

@Global()
@Module({
  providers: [
    { provide: 'MembershipChargePort', useFactory: (db: AppDatabase, secrets: PaymentSecrets): MembershipChargePort | undefined =>
        (db && membershipAutobillEnabled() ? new CardPointeMembershipChargeAdapter(renewalChargeFn(db as any, new PaymentGatewayResolver(db, secrets))) : undefined),
      inject: [DATABASE, PAYMENT_SECRETS] },
  ],
  exports: ['MembershipChargePort'],
})
export class MembershipChargeWiringModule {}
