/**
 * profile-service.spec.ts — Nest-free assertions for ProfileService avatar validation and the
 * db-unavailable fail-soft paths (no Postgres required).
 */
import { ProfileService } from './profile.service';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
async function throws(fn: () => Promise<unknown>, match: RegExp, msg: string) {
  try { await fn(); fail++; console.error('  ✗', msg, '(did not throw)'); }
  catch (e: any) { if (match.test(e?.message || '')) pass++; else { fail++; console.error('  ✗', msg, '→ got:', e?.message); } }
}

(async () => {
  const ctx = { tenantId: 'tn_1', userId: 'u_1', role: 'RECEPTION' };
  // A REAL PNG header: Constitution 12 §159 checks the bytes match the declared type, so the old 'A'.repeat(64)
  // (all zeros once decoded) is rightly rejected as not-a-PNG — this case had been failing since that check landed.
  const goodPng = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  // db=null: get is fail-soft and echoes session identity, avatar null
  const svcNull = new ProfileService(null as any);
  const me = await svcNull.get(ctx);
  ok(me.avatarUrl === null, 'get() returns null avatar when store unavailable');
  ok(me.role === 'RECEPTION' && me.userId === 'u_1', 'get() echoes session userId/role');

  // remove is a no-op success when store unavailable
  const rm = await svcNull.removeAvatar(ctx);
  ok(rm.ok === true, 'removeAvatar() is a soft no-op when store unavailable');

  // validation runs BEFORE touching the store
  await throws(() => svcNull.setAvatar(ctx, ''), /image is required/i, 'empty rejected');
  await throws(() => svcNull.setAvatar(ctx, 'not-a-data-url'), /Unsupported image/i, 'non-data-url rejected');
  await throws(() => svcNull.setAvatar(ctx, 'data:text/plain;base64,AAAA'), /Unsupported image/i, 'non-image mime rejected');
  await throws(() => svcNull.setAvatar(ctx, 'data:image/png;base64,' + 'A'.repeat(700000)), /too large/i, 'oversized rejected');
  await throws(() => svcNull.setAvatar({}, goodPng), /No active session/i, 'missing session rejected');
  // valid image, but store unavailable → clear error (not a silent pass)
  await throws(() => svcNull.setAvatar(ctx, goodPng), /store unavailable/i, 'valid image but no store → store-unavailable error');

  console.log(`profile-service: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
