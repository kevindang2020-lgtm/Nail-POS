// account-core.spec.ts — Nest-free harness for AccountService (deletion/deactivation requests + privacy export). A fake
// repo exercises the auth guard, the delete-vs-deactivate branching by role, pending-request idempotency, the
// customer-vs-staff "what we remove / retain" disclosure, and the privacy-export assembly (with the customer-only
// profile + loyalty section). esbuild + node, ok() style.
import { AccountService } from './account.service';
import { AccountError } from './account.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof AccountError && e.code === code); }
}

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Opts = { existing?: any; user?: any; cust?: any; loyalty?: any };
function makeRepo(o: Opts = {}) {
  const created: any[] = []; const audits: any[] = [];
  return {
    created, audits,
    async findPending() { return o.existing; },
    async createRequest(_ctx: any, requestType: string, reason: string | null, contactEmail: string | null) {
      created.push({ requestType, reason, contactEmail });
      return { id: 'req1', status: 'pending', requested_at: '2026-06-18T10:00:00.000Z' };
    },
    async audit(_ctx: any, action: string, entityId: string | null, metadata: any) { audits.push({ action, entityId, metadata }); },
    async userProfile() { return o.user; },
    async customerRecord() { return o.cust; },
    async loyaltyForCustomer() { return o.loyalty; },
  };
}
const ctx = (over: Record<string, any> = {}) => ({ userId: UID, role: 'CUSTOMER', tenantId: TID, ...over });

(async () => {
  // ---- requestDeletion: auth + role branching + idempotency + disclosure ----
  await throwsCode('requestDeletion requires sign-in', () => new AccountService(makeRepo() as any).requestDeletion({ userId: 'not-a-uuid' } as any, 'customer', {}), 'unauthenticated');

  {
    const repo = makeRepo(); const r = await new AccountService(repo as any).requestDeletion(ctx(), 'customer', {});
    ok('a customer request is a delete + audited', r.requestType === 'delete' && repo.created.length === 1 && repo.audits.some((a) => a.action === 'account_deletion_requested'));
    ok('a customer sees the customer remove/retain lists', r.willRemove.includes('Loyalty profile and points') && r.willRetain.some((x: string) => x.includes('financial/tax law')));
  }
  {
    const repo = makeRepo(); const r = await new AccountService(repo as any).requestDeletion(ctx({ role: 'OWNER' }), 'owner', {});
    ok('an owner/tech request is a deactivate', r.requestType === 'deactivate' && repo.audits.some((a) => a.action === 'account_deactivation_requested'));
    ok('staff see the staff remove/retain lists', r.willRemove.includes('Your login access (account deactivated)') && r.willRetain.some((x: string) => x.includes('cash-handoff')));
  }
  {
    const repo = makeRepo({ existing: { id: 'old1', status: 'pending', requested_at: '2026-06-01T00:00:00.000Z' } });
    const r = await new AccountService(repo as any).requestDeletion(ctx(), 'customer', {});
    ok('a pending request is reused, not duplicated or re-audited', r.requestId === 'old1' && repo.created.length === 0 && repo.audits.length === 0 && /already have a pending request/.test(r.message));
  }
  {
    const repo = makeRepo();
    const r = await new AccountService(repo as any).requestDeletion(ctx(), 'customer', { reason: 'x'.repeat(2000), contactEmail: 'y'.repeat(500) });
    ok('reason + contactEmail are truncated', repo.created[0].reason.length === 1000 && repo.created[0].contactEmail.length === 200 && r.contactEmail!.length === 200);
  }

  // ---- privacyExport: auth + not_found + assembly ----
  await throwsCode('privacyExport requires sign-in', () => new AccountService(makeRepo() as any).privacyExport({ userId: 'nope' } as any), 'unauthenticated');
  await throwsCode('privacyExport 404s an unknown user', () => new AccountService(makeRepo({ user: undefined }) as any).privacyExport(ctx()), 'not_found');

  {
    const user = { id: UID, role: 'OWNER', status: 'active', first_name: 'Sam', last_name: 'Lee', full_name: 'Sam Lee', email: 's@x.com', normalized_phone: '+1', last_login_at: null, tenant_id: TID };
    const out = await new AccountService(makeRepo({ user }) as any).privacyExport(ctx({ role: 'OWNER' }));
    ok('a non-customer export has the account block but no customer profile', out.account.userId === UID && out.customerProfile === undefined && out.loyalty === undefined);
  }
  {
    const user = { id: UID, role: 'CUSTOMER', status: 'active', first_name: 'Dana', last_name: 'Kim', full_name: 'Dana Kim', email: 'd@x.com', normalized_phone: '+1', last_login_at: null, tenant_id: TID };
    const cust = { id: 'cust1', full_name: 'Dana Kim', email: 'd@x.com', phone_display: '(555) 1', birthday: null };
    const loyalty = { points_balance: 120, total_earned_points: 200, total_redeemed_points: 80, loyalty_tier: 'Gold' };
    const out = await new AccountService(makeRepo({ user, cust, loyalty }) as any).privacyExport(ctx());
    ok('a customer export includes the customer profile + loyalty', out.customerProfile.customerId === 'cust1' && out.loyalty.pointsBalance === 120 && out.loyalty.tier === 'Gold');
  }
  {
    const user = { id: UID, role: 'CUSTOMER', status: 'active', first_name: 'Dana', last_name: 'Kim', full_name: 'Dana Kim', email: 'd@x.com', normalized_phone: '+1', last_login_at: null, tenant_id: TID };
    const cust = { id: 'cust1', full_name: 'Dana Kim', email: 'd@x.com', phone_display: '(555) 1', birthday: null };
    const out = await new AccountService(makeRepo({ user, cust, loyalty: undefined }) as any).privacyExport(ctx());
    ok('a customer with no loyalty record omits the loyalty section', out.customerProfile.customerId === 'cust1' && out.loyalty === undefined);
  }

  console.log(`\naccount-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
