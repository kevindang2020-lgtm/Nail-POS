// staff-branch-access.wiring.ts — the API's composition root gives the queue module's manager-PIN check the IDENTITY module's
// location rule (Constitution 13: cross-module composition lives here, not inside a module — the queue module must not
// import identity). Kevin's instruction (Oct 28 2026): a manager's PIN works only at a location that manager may enter, and
// only in her own salon. The rule is enterableBranchesForUser — the same one sign-in and branch selection use (role-template
// scope → user_branch_access grants → home branch; null = every location of the salon).
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { enterableBranchesForUser } from '@aipowersalon/identity';
import { STAFF_BRANCH_ACCESS, type StaffBranchAccessPort } from '@aipowersalon/queue';

@Global()
@Module({
  providers: [
    { provide: STAFF_BRANCH_ACCESS, useFactory: (db: AppDatabase): StaffBranchAccessPort | null =>
        (db ? { enterableBranches: (tenantId, userId, role) => enterableBranchesForUser(db, tenantId, userId, role) } : null),
      inject: [DATABASE] },
  ],
  exports: [STAFF_BRANCH_ACCESS],
})
export class StaffBranchAccessWiringModule {}
