// membership-enroll.controller.vitest.spec — Constitution 5 §57: a stale membership edit answers VERSION_CONFLICT.
import { describe, it, expect } from 'vitest';
import { runMembershipRoute } from './membership-enroll.controller';
import { ConcurrencyError, ValidationError } from './membership-enroll.service';
describe('membership routes → HTTP', () => {
  it('a stale edit is 409 VERSION_CONFLICT (was a bare 409 with no code)', async () => {
    const e: any = await runMembershipRoute(() => { throw new ConcurrencyError(); }).catch((x) => x);
    expect(e.getStatus()).toBe(409); expect(e.getResponse()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it('validation stays 400; success passes through', async () => {
    const e: any = await runMembershipRoute(() => { throw new ValidationError('bad'); }).catch((x) => x);
    expect(e.getStatus()).toBe(400);
    expect(await runMembershipRoute(() => 42)).toBe(42);
  });
});
