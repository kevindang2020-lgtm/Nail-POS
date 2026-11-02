import { describe, it, expect } from 'vitest';
import { safePayload } from './payment-webhook.service';

// PCI defense-in-depth: the stored webhook payload must never carry secret-looking fields — at ANY nesting depth.
describe('safePayload — recursive sensitive-field scrub', () => {
  it('strips top-level and nested secret-looking keys', () => {
    const out: any = safePayload({
      eventId: 'e1', amount: 500,
      transaction: { token: 'tok_x', cvv: '123', card: '4111111111111111', nested: { pan: '5555', account_number: '99' } },
      items: [{ ok: 1, cvv2: '000' }],
    });
    expect(out.eventId).toBe('e1');
    expect(out.amount).toBe(500);
    expect(out.transaction.token).toBe('tok_x');     // tokens are safe to keep
    expect('cvv' in out.transaction).toBe(false);     // nested secret removed
    expect('card' in out.transaction).toBe(false);
    expect('pan' in out.transaction.nested).toBe(false);
    expect('account_number' in out.transaction.nested).toBe(false);
    expect('cvv2' in out.items[0]).toBe(false);        // inside an array, too
    expect(out.items[0].ok).toBe(1);
  });
  it('passes through primitives and null safely', () => {
    expect(safePayload(null)).toBeNull();
    expect(safePayload('x')).toBe('x');
    expect(safePayload(42)).toBe(42);
  });
});
