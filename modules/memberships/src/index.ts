// modules/memberships — the memberships domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { MembershipBillingModule } from './membership-billing.module';
export { MembershipCommsModule } from './membership-comms.module';
export { MembershipCompModule } from './membership-compensation.module';
export { MembershipEnrollModule } from './membership-enroll.module';
export { MembershipsModule } from './memberships.module';
export * from './memberships.dto';
export { KyselyMembershipCompRepository } from './membership-compensation.kysely.repository';   // used by the API today
export { InMemoryMembershipCompRepository } from './membership-compensation.repository';   // used by the API today
export { MembershipCompService } from './membership-compensation.service';   // used by the API today
export { MembershipEnrollService } from './membership-enroll.service';   // used by the API today
export { MembershipsService } from './memberships.service';   // used by the API today
export { KyselyMembershipsRepository } from './memberships.kysely.repository';   // the platform's §299 cross-tenant suite constructs the real repository
export { KyselyMembershipEnrollRepository } from './membership-enroll.kysely.repository';   // used by the API's membership producer pgtest
export { CardPointeMembershipChargeAdapter, type MembershipChargePort, type MembershipChargeRequest } from './membership-billing.service';   // the API's composition root wires the live renewal charge
export { renewalChargeFn, membershipAutobillEnabled, type MembershipGatewayLike } from './membership-renewal-charge';
export { CUSTOMER_MEMBERSHIP, MEMBERSHIP_PLAN } from './membership-machine';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
export { KyselyMembershipBillingRepository } from './membership-billing.kysely.repository';   // BUILD_PLAN Phase 12 (#27): used by the API's state-machines pgtest
