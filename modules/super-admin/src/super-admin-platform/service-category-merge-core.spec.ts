/**
 * service-category-merge-core.spec.ts — gated, audited service-category merge (§25). DB-free: audit() is a no-op and
 * the repo is faked, so this verifies the guardrails — a merge is permitted only inside an active support session for
 * the tenant, needs a reason, can't merge a category into itself, and surfaces not_found when the repo reports the
 * source/target missing (or the source already merged). The actual reattribution + lineage log is a transactional repo
 * concern exercised against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const T = 'tenant-1';
const activeSession = { id: 'sess-1', tenant_id: T, ended_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() };
const repo = (sessions: any[], mergeResult: any) => ({
  async supportSessions(active: boolean) { return active ? sessions.filter((s) => !s.ended_at && new Date(s.expires_at).getTime() > Date.now()) : sessions.slice(); },
  async mergeServiceCategories() { return mergeResult; },
}) as any;
const GOOD = { sessionId: 'sess-1', tenantId: T, sourceCategoryId: 'src', targetCategoryId: 'tgt', reason: 'consolidating duplicate Manicures category' };

async function main(): Promise<void> {
  console.log('\n== merge inside an active session returns log id + reattributed count ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession], { mergeLogId: 'log-1', reattributedServiceCount: 7, snapshot: {} }));
    const res: any = await svc.mergeServiceCategories(CTX, GOOD);
    check('returns ok with merge log id, source/target, count', res.ok === true && res.mergeLogId === 'log-1' && res.sourceCategoryId === 'src' && res.targetCategoryId === 'tgt' && res.reattributedServiceCount === 7);
  }

  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession], { mergeLogId: 'x', reattributedServiceCount: 0, snapshot: {} }));
    await throwsAsync('rejects merging a category into itself', () => svc.mergeServiceCategories(CTX, { ...GOOD, targetCategoryId: 'src' }), 'invalid');
    await throwsAsync('rejects missing target', () => svc.mergeServiceCategories(CTX, { ...GOOD, targetCategoryId: '' }), 'invalid');
    await throwsAsync('rejects missing source', () => svc.mergeServiceCategories(CTX, { ...GOOD, sourceCategoryId: '' }), 'invalid');
    await throwsAsync('rejects reason under 5 chars', () => svc.mergeServiceCategories(CTX, { ...GOOD, reason: 'x' }), 'invalid');
    await throwsAsync('rejects missing auth context', () => svc.mergeServiceCategories({}, GOOD), 'invalid');
    await throwsAsync('rejects missing sessionId', () => svc.mergeServiceCategories(CTX, { ...GOOD, sessionId: '' }), 'invalid');
    await throwsAsync('rejects tenant mismatch with the session', () => svc.mergeServiceCategories(CTX, { ...GOOD, tenantId: 'other' }), 'invalid');
  }

  console.log('\n== unknown / inactive session and missing category ==');
  {
    const noSess = new SuperAdminPlatformService(repo([], { mergeLogId: 'x', reattributedServiceCount: 0, snapshot: {} }));
    await throwsAsync('rejects when no active session', () => noSess.mergeServiceCategories(CTX, GOOD), 'not_found');
    const missing = new SuperAdminPlatformService(repo([activeSession], null));
    await throwsAsync('surfaces not_found when a category is missing or already merged', () => missing.mergeServiceCategories(CTX, GOOD), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
