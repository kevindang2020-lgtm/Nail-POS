// critical-step-up-gate.vitest.spec.ts — Security Deep Scan C7 (Oct 23 2026): the check:critical-step-up gate
// (apps/api/scripts/check-critical-step-up.mjs) fails when a critical mutation lacks @RequireStepUp. Before the fix, the
// committed manifest had refunds, voids, funding updates, MID assignment, tenant suspension, credential rotation and
// security-policy routes without step-up — the first test below runs the gate on that shape and expects failures.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — a plain .mjs gate script (no type declarations)
import { parseManifest, evaluate, CRITICAL, EXEMPT, PENDING } from '../../scripts/check-critical-step-up.mjs';

const line = (m: string, p: string, stepUp: boolean) => `${m} ${p}  realm=staff  auth=session  domain=x${stepUp ? '  step-up' : ''}  guards=G`;

describe('check:critical-step-up', () => {
  it('fails a critical route without step-up (the pre-fix manifest shape)', () => {
    const routes = parseManifest([
      line('POST', '/pos/checkout/payments/{paymentId}/refund', false),
      line('POST', '/super-admin/merchant-accounts/{tenantId}/funding-update', false),
      line('POST', '/super-admin/tenants/{id}/suspend', false),
      line('GET', '/pos/checkout/payments/{paymentId}/refund', false),   // reads are never critical
    ].join('\n'));
    const { problems } = evaluate(routes, { critical: CRITICAL.slice(0, 1).concat(CRITICAL.filter((c: any) => /refund|tenant suspension/.test(c.why))), exempt: {}, pending: {} });
    expect(problems.filter((p: string) => /has no @RequireStepUp/.test(p))).toHaveLength(3);
  });
  it('passes the same routes once they carry step-up; a stale PENDING entry fails (the list only shrinks)', () => {
    const routes = parseManifest(line('POST', '/pos/checkout/payments/{paymentId}/refund', true));
    const critical = CRITICAL.filter((c: any) => c.why === 'refund / void');
    expect(evaluate(routes, { critical, exempt: {}, pending: {} }).problems).toEqual([]);
    expect(evaluate(routes, { critical, exempt: {}, pending: { 'POST /pos/checkout/payments/{paymentId}/refund': 'x' } }).problems.join()).toMatch(/now has step-up/);
  });
  it('a pattern that matches nothing fails (a rename cannot silently turn the gate off)', () => {
    expect(evaluate([], { critical: [{ re: /^\/nowhere$/, why: 'x' }], exempt: {}, pending: {} }).problems.join()).toMatch(/matches no route/);
  });
  it('the committed manifest passes', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'openapi', 'manifest.txt'), 'utf8');
    const { problems, rows } = evaluate(parseManifest(text), { critical: CRITICAL, exempt: EXEMPT, pending: PENDING });
    expect(problems).toEqual([]);
    expect(rows.length).toBeGreaterThan(60);
  });
});
