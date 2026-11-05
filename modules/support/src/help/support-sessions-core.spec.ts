/**
 * support-sessions-core.spec.ts — pure session-request rules + the consent gate. Remote support requires recorded
 * consent (enforced before any DB work); chat/callback do not. Invalid kinds are rejected. The consent gate is
 * verified through createSessionRequest with a null DB: consent missing → 'consent_required', consent present →
 * past the gate (reports 'unavailable', i.e. the gate let it through to the DB step).
 */
import { isValidSessionKind, requiresConsent, sanitizeSessionInput, SupportSessionsService } from './support-sessions.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'technician', permissions: [] };

async function main(): Promise<void> {
  console.log('\n== kind + consent rules ==');
  check('valid kinds', isValidSessionKind('live_chat') && isValidSessionKind('remote_support') && isValidSessionKind('callback'));
  check('invalid kind rejected', !isValidSessionKind('screen_share'));
  check('remote support requires consent', requiresConsent('remote_support') === true);
  check('live chat does not', requiresConsent('live_chat') === false);

  console.log('\n== sanitize ==');
  check('invalid kind → error', sanitizeSessionInput({ kind: 'nope' }).ok === false);
  const ok = sanitizeSessionInput({ kind: 'live_chat', topic: '  printer  ' });
  check('valid → trims topic', ok.ok === true && ok.value?.topic === 'printer');
  check('consent flag normalized', sanitizeSessionInput({ kind: 'remote_support', consentGranted: true }).value?.consentGranted === true);

  console.log('\n== consent gate (null DB) ==');
  const svc = new SupportSessionsService(null);
  const r1 = await svc.createSessionRequest(ctx, { kind: 'remote_support', consentGranted: false });
  check('remote without consent → consent_required', r1.ok === false && r1.error === 'consent_required');
  const r2 = await svc.createSessionRequest(ctx, { kind: 'remote_support', consentGranted: true });
  check('remote with consent passes gate (then unavailable)', r2.ok === false && r2.error === 'unavailable');
  const r3 = await svc.createSessionRequest(ctx, { kind: 'live_chat' });
  check('live chat needs no consent (then unavailable)', r3.ok === false && r3.error === 'unavailable');
  const r4 = await svc.createSessionRequest({ ...ctx, userId: undefined } as any, { kind: 'live_chat' });
  check('unauthenticated rejected', r4.ok === false && r4.error === 'unauthenticated');

  console.log('\nsupport-sessions-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
