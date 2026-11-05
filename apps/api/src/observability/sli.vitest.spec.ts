// sli.vitest.spec — Constitution 11 §70–79, §83, §201.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException, BadRequestException } from '@nestjs/common';
import { WORKFLOW_ROUTES, workflowOf, classifyOutcome, errorCodeOf, recordSli, sliEvents, sliSummaries } from './sli';
import { HttpMetricsInterceptor } from './http-metrics';
import { of, throwError, lastValueFrom } from 'rxjs';

const count = (workflow: string, outcome: string, category?: string) =>
  sliEvents.snapshot().filter((s) => s.labels.workflow === workflow && s.labels.outcome === outcome && (!category || s.labels.category === category))
    .reduce((a, s) => a + (s.value as number), 0);

describe('§201 classification — the system saying no is not the system failing', () => {
  it('2xx is success', () => expect(classifyOutcome(201, null).outcome).toBe('success'));
  it('a slot conflict (409) is a BUSINESS failure, not a reliability failure', () => {
    expect(classifyOutcome(409, 'slot_unavailable')).toEqual({ outcome: 'business_failure', category: 'slot_unavailable' });
  });
  it('a card decline (402) is a business failure — §58: declines never read as an outage', () => {
    expect(classifyOutcome(402, 'payment_declined').outcome).toBe('business_failure');
  });
  it('429 is its own outcome, kept visible (§73, §77)', () => expect(classifyOutcome(429, null).outcome).toBe('rate_limited'));
  it('5xx is a SYSTEM failure', () => expect(classifyOutcome(500, null)).toEqual({ outcome: 'system_failure', category: 'internal' }));
  it('§204: a provider outage is named as a dependency failure, not "internal"', () => {
    expect(classifyOutcome(502, 'twilio_unavailable').category).toBe('twilio_unavailable');
    expect(classifyOutcome(503, null).category).toBe('dependency_unavailable');
    expect(classifyOutcome(504, null).category).toBe('timeout');
  });
});

describe('the domain code — normalised, bounded, never a message', () => {
  it('reads the code from an HttpException body', () => {
    expect(errorCodeOf(new HttpException({ message: 'slot taken by Ada', code: 'SLOT_UNAVAILABLE' }, 409))).toBe('slot_unavailable');
  });
  it('falls back to the exception class, normalised to snake_case', () => {
    expect(errorCodeOf(new BadRequestException('bad'))).toBe('bad_request_exception');
  });
  it('never returns the MESSAGE, which can carry a customer name', () => {
    expect(errorCodeOf(new HttpException({ message: 'slot taken by Ada Rowe' }, 409))).not.toMatch(/ada/i);
  });
  it('is bounded to 48 characters of [a-z0-9_]', () => {
    const c = errorCodeOf({ code: 'X'.repeat(200) + ' <script>' })!;
    expect(c.length).toBeLessThanOrEqual(48);
    expect(c).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('recording at the HTTP boundary', () => {
  it('a mapped route records under its workflow', () => {
    recordSli('POST', '/pos/checkout/tickets/:ticketId/pay/card', 200);
    expect(count('checkout_payment', 'success')).toBeGreaterThanOrEqual(1);
  });
  it('a failure records its outcome AND category from the exception', () => {
    recordSli('POST', '/customer/booking/verification/check', 400, new HttpException({ code: 'CODE_EXPIRED' }, 400));
    expect(count('phone_verification', 'business_failure', 'code_expired')).toBe(1);
  });
  it('an unmapped route records nothing — SLIs are the workflows, not every endpoint', () => {
    const before = sliEvents.snapshot().length;
    recordSli('GET', '/pos/whatever', 200);
    expect(sliEvents.snapshot().length).toBe(before);
  });
  it('the method matters — GET on a POST workflow route is not that workflow', () => {
    expect(workflowOf('GET', '/pos/booking/appointments')).toBeNull();
    expect(workflowOf('post', '/pos/booking/appointments')).toBe('booking_completion');
  });
  it('never throws, even on garbage', () => {
    expect(() => recordSli(undefined as never, undefined as never, NaN, {})).not.toThrow();
  });
});

describe('§72 / §83 the reliability ratio', () => {
  it('business failures do not reduce reliability; system failures do', () => {
    for (let i = 0; i < 6; i++) recordSli('POST', '/pos/queue/items/:queueItemId/assign-technician', 200);
    for (let i = 0; i < 3; i++) recordSli('POST', '/pos/queue/items/:queueItemId/assign-technician', 409, { code: 'already_assigned' });
    recordSli('POST', '/pos/queue/items/:queueItemId/assign-technician', 500);
    const q = sliSummaries().find((s) => s.workflow === 'queue_assignment')!;
    expect(q.total).toBe(10);
    expect(q.reliability).toBeCloseTo(0.9);   // 1 system failure in 10 — the 3 conflicts are the system working
  });
  it('§83: a PROVIDER outage counts against reliability — it is not excluded to keep the number green', () => {
    recordSli('POST', '/customer/booking/verification/send', 200);
    recordSli('POST', '/customer/booking/verification/send', 502, { code: 'twilio_unavailable' });
    const v = sliSummaries().find((s) => s.workflow === 'phone_verification_send')!;
    expect(v.reliability).toBeCloseTo(0.5);
  });
  it('§332: a workflow with no traffic is null (unknown), never 100%', () => {
    expect(sliSummaries().find((s) => s.workflow === 'refund')!.reliability).toBeNull();
  });
  it('every §71 workflow appears in the summary even before any traffic', () => {
    const ws = sliSummaries().map((s) => s.workflow);
    for (const w of ['login', 'customer_search', 'booking_availability', 'booking_completion', 'phone_verification', 'check_in', 'queue_assignment', 'service_completion', 'checkout_payment', 'refund']) {
      expect(ws, w).toContain(w);
    }
  });
});

describe('guard: every route in the table exists in a controller', () => {
  // A route renamed in its controller silently drops out of its SLI — the workflow reads "no traffic" (null)
  // forever and nothing looks broken. This rebuilds every METHOD + full template from the controllers and checks.
  const SRC = join(process.cwd(), 'src');
  const walk = (d: string, o: string[] = []): string[] => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, o); else if (p.endsWith('.controller.ts')) o.push(p); } return o; };
  const routes = new Set<string>();
  for (const f of codeRoots().flatMap((r) => walk(r))) {
    const s = readFileSync(f, 'utf8');
    const prefix = /@Controller\('([^']*)'\)/.exec(s)?.[1] ?? '';
    for (const m of s.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
      const path = ['', prefix, m[2] ?? ''].join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      routes.add(`${m[1].toUpperCase()} ${path}`);
    }
  }
  for (const key of Object.keys(WORKFLOW_ROUTES)) {
    it(`${key} exists`, () => expect(routes.has(key), `${key} is in WORKFLOW_ROUTES but no controller serves it`).toBe(true));
  }
});

describe('the interceptor actually feeds the SLIs — success AND failure', () => {
  // Without this, deleting recordSli() from the interceptor (or forgetting to pass the exception on the error path)
  // leaves every test above green while no SLI is ever recorded in production.
  const execCtx = (route: string, status: number) => ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', route: { path: route }, baseUrl: '' }), getResponse: () => ({ statusCode: status }) }),
  });

  it('a successful workflow request is recorded as success — measured as a DELTA', async () => {
    // The registry is process-wide and an earlier test already recorded a checkout_payment success, so ">= 1" held
    // with the interceptor doing nothing at all: deleting recordSli() failed only the OTHER test. Count the change.
    const before = count('checkout_payment', 'success', 'ok');
    const i = new HttpMetricsInterceptor(null as never);
    await lastValueFrom(i.intercept(execCtx('/pos/checkout/tickets/:ticketId/pay/split', 200), { handle: () => of({}) }));
    expect(count('checkout_payment', 'success', 'ok')).toBe(before + 1);
  });

  it('a FAILED request is recorded with the domain code taken from the exception', async () => {
    const i = new HttpMetricsInterceptor(null as never);
    const err = new HttpException({ code: 'SLOT_UNAVAILABLE' }, 409);
    await lastValueFrom(i.intercept(execCtx('/pos/booking/appointments', 0), { handle: () => throwError(() => err) })).catch(() => undefined);
    expect(count('booking_completion', 'business_failure', 'slot_unavailable')).toBe(1);
  });
});
