/**
 * privacy-requests-core.spec.ts — customer privacy-request workflow (§27). DB-free: audit() is a no-op and the repo is
 * faked. Verifies create validation (type allow-list, requester/customer required, 30-day due date) and advance gating
 * (active session for the tenant, valid status, note required, terminal states flow through).
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

function repo(sessions: any[]) {
  const created: any[] = [];
  const r: any = {
    created,
    async supportSessions(active: boolean) { return active ? sessions.filter((s) => !s.ended_at && new Date(s.expires_at).getTime() > Date.now()) : sessions.slice(); },
    async createPrivacyRequest(i: any) { const row = { id: 'pr-' + (created.length + 1), status: 'new', ...i }; created.push(row); return row; },
    async setPrivacyRequestStatus(i: any) { return i.id === 'missing' ? null : { id: i.id, status: i.status, note: i.note }; },
  };
  return r;
}

async function main(): Promise<void> {
  console.log('\n== create: validation + 30-day due date ==');
  {
    const rp = repo([activeSession]);
    const svc = new SuperAdminPlatformService(rp);
    const res: any = await svc.createPrivacyRequest(CTX, { tenantId: T, requestType: 'delete', requesterName: 'Grace Kim' });
    check('creates request with status new', res.status === 'new');
    const days = Math.round((new Date(res.dueAt).getTime() - Date.now()) / 86_400_000);
    check('due date is ~30 days out', days === 30);
    await throwsAsync('rejects unsupported request type', () => svc.createPrivacyRequest(CTX, { tenantId: T, requestType: 'sell_data', requesterName: 'X' }), 'invalid');
    await throwsAsync('rejects missing tenant', () => svc.createPrivacyRequest(CTX, { requestType: 'access', requesterName: 'X' }), 'invalid');
    await throwsAsync('rejects when neither requester nor customer given', () => svc.createPrivacyRequest(CTX, { tenantId: T, requestType: 'access' }), 'invalid');
    check('accepts customerId in place of requester name', !!(await svc.createPrivacyRequest(CTX, { tenantId: T, requestType: 'export', customerId: 'c-9' })));
  }

  console.log('\n== advance: gating + status/note validation ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession]));
    const GOOD = { sessionId: 'sess-1', tenantId: T, id: 'pr-1', status: 'in_review', note: 'verified identity, beginning review' };
    check('advances inside an active session', (await svc.advancePrivacyRequest(CTX, GOOD)).status === 'in_review');
    check('completes (terminal) inside session', (await svc.advancePrivacyRequest(CTX, { ...GOOD, status: 'completed', note: 'export delivered to requester' })).status === 'completed');
    await throwsAsync('rejects unsupported status', () => svc.advancePrivacyRequest(CTX, { ...GOOD, status: 'banished' }), 'invalid');
    await throwsAsync('rejects note under 5 chars', () => svc.advancePrivacyRequest(CTX, { ...GOOD, note: 'ok' }), 'invalid');
    await throwsAsync('rejects missing id', () => svc.advancePrivacyRequest(CTX, { ...GOOD, id: '' }), 'invalid');
    await throwsAsync('surfaces not_found for unknown request', () => svc.advancePrivacyRequest(CTX, { ...GOOD, id: 'missing' }), 'not_found');
  }

  console.log('\n== advance: session boundaries ==');
  {
    const noSess = new SuperAdminPlatformService(repo([]));
    await throwsAsync('rejects when no active session', () => noSess.advancePrivacyRequest(CTX, { sessionId: 'sess-1', tenantId: T, id: 'pr-1', status: 'verified', note: 'identity confirmed' }), 'not_found');
    const svc = new SuperAdminPlatformService(repo([activeSession]));
    await throwsAsync('rejects tenant mismatch', () => svc.advancePrivacyRequest(CTX, { sessionId: 'sess-1', tenantId: 'other', id: 'pr-1', status: 'verified', note: 'identity confirmed' }), 'invalid');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
