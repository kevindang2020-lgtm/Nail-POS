// branch-switch-guard.ts — the port the platform's ONE branch switch (POST /auth/select-branch) asks before it moves a
// session from one branch to another (Owner & Manager Payment App mandate §120: "active payment must finish/cancel before
// switching"). Identity owns the switch but not payments, so it only defines the question; a module that can have work in
// flight in a branch provides BRANCH_SWITCH_GUARD (today: modules/checkout MobileCheckoutModule — a claimed mobile checkout
// or an unresolved Tap to Pay attempt). The AuthController resolves it at request time through ModuleRef (strict: false),
// so identity never imports checkout. Not provided → no guard (the switch behaves as before).

export const BRANCH_SWITCH_GUARD = 'BRANCH_SWITCH_GUARD';

export interface BranchSwitchQuestion {
  tenantId: string;
  /** The branch the session is in NOW — where the payment would be left behind. */
  branchId: string;
  userId: string;
  /** The Payment App's per-install device id (display/lookup data only — never an authorization). */
  deviceId: string | null;
  targetBranchId: string;
}

export interface BranchSwitchBlock { code: string; message: string }

export interface BranchSwitchGuardPort {
  /** null = nothing to finish; otherwise why the switch must wait. Throwing = cannot tell (the switch fails closed). */
  blockReason(q: BranchSwitchQuestion): Promise<BranchSwitchBlock | null>;
}
