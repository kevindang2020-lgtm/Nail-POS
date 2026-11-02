/**
 * appointment-support-core.spec.ts — controlled Appointment Oversight support actions (§25/§36).
 * Exercises recordSupportAction DB-free: audit() is a no-op without a db, so this verifies the guardrails —
 * an action is permitted only inside an active support session for the matching tenant, always needs a reason,
 * and the action must be one of the allowed oversight actions.
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
const repoWith = (sessions: any[]) => ({
  async supportSessions(activeOnly: boolean) {
    return activeOnly ? sessions.filter((s) => !s.ended_at && new Date(s.expires_at).getTime() > Date.now()) : sessions.slice();
  },
}) as any;
const activeSession = { id: 'sess-1', tenant_id: T, ended_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() };

async function main(): Promise<void> {
  console.log('\n== records a support action inside an active session ==');
  {
    const svc = new SuperAdminPlatformService(repoWith([activeSession]));
    const res: any = await svc.recordSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, branchId: 'br-2', appointmentId: 'appt-9', action: 'technician_reassigned', reason: 'Customer called to switch technicians', before: { tech: 'A' }, after: { tech: 'B' } });
    check('returns ok with the action + context', res.ok === true && res.action === 'technician_reassigned' && res.branchId === 'br-2' && res.appointmentId === 'appt-9');
  }

  console.log('\n== validation guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repoWith([activeSession]));
    await throwsAsync('rejects reason under 5 chars', () => svc.recordSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, appointmentId: 'a', action: 'note_added', reason: 'x' }), 'invalid');
    await throwsAsync('rejects an unsupported action', () => svc.recordSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, appointmentId: 'a', action: 'delete_everything', reason: 'a valid reason' }), 'invalid');
    await throwsAsync('rejects missing appointmentId', () => svc.recordSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, appointmentId: '', action: 'note_added', reason: 'a valid reason' }), 'invalid');
    await throwsAsync('rejects missing auth context', () => svc.recordSupportAction({}, { sessionId: 'sess-1', tenantId: T, appointmentId: 'a', action: 'note_added', reason: 'a valid reason' }), 'invalid');
    await throwsAsync('rejects unknown / inactive session', () => svc.recordSupportAction(CTX, { sessionId: 'nope', tenantId: T, appointmentId: 'a', action: 'note_added', reason: 'a valid reason' }), 'not_found');
    await throwsAsync('rejects tenant mismatch on the session', () => svc.recordSupportAction(CTX, { sessionId: 'sess-1', tenantId: 'other-tenant', appointmentId: 'a', action: 'note_added', reason: 'a valid reason' }), 'invalid');
  }

  console.log('\n== an expired session is not active ==');
  {
    const expired = { id: 'sess-x', tenant_id: T, ended_at: null, expires_at: new Date(Date.now() - 1000).toISOString() };
    const svc = new SuperAdminPlatformService(repoWith([expired]));
    await throwsAsync('rejects an expired support session', () => svc.recordSupportAction(CTX, { sessionId: 'sess-x', tenantId: T, appointmentId: 'a', action: 'note_added', reason: 'a valid reason' }), 'not_found');
  }

  console.log('\n== customer support action: gated PII-reveal + audit (§9/§37) ==');
  {
    const svc = new SuperAdminPlatformService(repoWith([activeSession]));
    const res: any = await svc.recordCustomerSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, branchId: 'br-2', customerId: 'cust-7', action: 'pii_revealed', reason: 'Verifying identity for a support call' });
    check('records a customer action (pii_revealed) in an active session', res.ok === true && res.action === 'pii_revealed' && res.customerId === 'cust-7');
    await throwsAsync('rejects an unsupported customer action', () => svc.recordCustomerSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, customerId: 'c', action: 'sell_data', reason: 'a valid reason' }), 'invalid');
    await throwsAsync('rejects missing customerId', () => svc.recordCustomerSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, customerId: '', action: 'note_added', reason: 'a valid reason' }), 'invalid');
    await throwsAsync('rejects reason under 5 chars', () => svc.recordCustomerSupportAction(CTX, { sessionId: 'sess-1', tenantId: T, customerId: 'c', action: 'note_added', reason: 'x' }), 'invalid');
    await throwsAsync('rejects unknown / inactive session', () => svc.recordCustomerSupportAction(CTX, { sessionId: 'nope', tenantId: T, customerId: 'c', action: 'note_added', reason: 'a valid reason' }), 'not_found');
    await throwsAsync('rejects tenant mismatch', () => svc.recordCustomerSupportAction(CTX, { sessionId: 'sess-1', tenantId: 'other', customerId: 'c', action: 'note_added', reason: 'a valid reason' }), 'invalid');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
