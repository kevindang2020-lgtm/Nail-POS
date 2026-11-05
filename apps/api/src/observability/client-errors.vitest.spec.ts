// client-errors.vitest.spec — Constitution 11 §125–130: the public crash-report intake.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClientErrorsController, parseReport, scrubClientText, normaliseClientRoute, WindowLimiter, clientErrors, clientErrorsDropped, LIMITS } from './client-errors.controller';
import { setLogSink, type LogRecord } from '@aipowersalon/observability';

const sinkInto = (arr: LogRecord[]) => setLogSink({ write: (r) => arr.push(r) });
afterEach(() => setLogSink(null));
const valid = (over: Record<string, unknown> = {}) => ({ app: 'pos', kind: 'render', message: 'x is undefined', stack: 'at A (a.js:1)', route: '/checkout', version: '1.2.3', ...over });

describe('§130 browser privacy — nothing a browser sends is logged raw', () => {
  it('a card number in the message is masked', () => expect(scrubClientText('failed for 4111 1111 1111 1111', 500)).not.toMatch(/4111 1111 1111 1111/));
  it('a bearer token in the stack is masked', () => expect(scrubClientText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc', 500)).not.toMatch(/eyJhbGci/));
  it('an email is masked', () => expect(scrubClientText('no account for ada.rowe@example.com', 500)).not.toMatch(/ada\.rowe@/));
  it('a phone number is masked', () => expect(scrubClientText('sms to (856) 555-0142 failed', 500)).not.toMatch(/555-0142/));
  it('text is capped BEFORE the scrubbing work — a huge message cannot become a huge log line', () => {
    // 5,000 characters, not 1 MB: the scrub is synchronous, so an UNCAPPED 1 MB input blocks the event loop and the
    // test runner cannot time it out — a mutation removing the cap HUNG the suite instead of failing it.
    expect(scrubClientText('a'.repeat(5_000), LIMITS.message).length).toBeLessThanOrEqual(LIMITS.message);
  });
  it('the client route loses ids and query strings (which can carry a token or a customer id)', () => {
    expect(normaliseClientRoute('/customers/9f1c2e3a-1b2c-4d5e-8f9a-0b1c2d3e4f5a/visits/42?token=abc#x')).toBe('/customers/:id/visits/:n');
  });
});

describe('parseReport — allow-listed, capped, never throws', () => {
  it('accepts a well-formed report', () => expect(parseReport(valid())).toMatchObject({ app: 'pos', kind: 'render', route: '/checkout' }));
  it('an unknown app is refused — it is a METRIC LABEL (§38), so free text there is a cardinality attack', () => expect(parseReport(valid({ app: 'evil-' + Math.random() }))).toBeNull());
  it('an unknown kind is refused', () => expect(parseReport(valid({ kind: 'anything' }))).toBeNull());
  it('a malformed requestId is dropped, not trusted', () => {
    expect(parseReport(valid({ requestId: 'req_01JABCDEFGHJKMNPQRST' }))!.requestId).toBe('req_01JABCDEFGHJKMNPQRST');
    expect(parseReport(valid({ requestId: "'; drop table" }))!.requestId).toBeNull();
  });
  it('garbage never throws', () => { for (const b of [null, 1, 'x', [], { app: {} }]) expect(parseReport(b)).toBeNull(); });
});

describe('the rate limit', () => {
  it('a single IP is capped per minute; a new minute resets it', () => {
    let t = 0; const l = new WindowLimiter(3, 100, () => t);
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('a')]).toEqual([true, true, true, false]);
    expect(l.allow('b')).toBe(true);                       // another IP is unaffected
    t += 60_000; expect(l.allow('a')).toBe(true);
  });
  it('the instance-wide cap holds against a DISTRIBUTED flood (many IPs)', () => {
    const l = new WindowLimiter(100, 5, () => 0);
    const results = Array.from({ length: 10 }, (_, i) => l.allow(`ip${i}`));
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});

describe('the endpoint', () => {
  it('logs a valid report at ERROR with the failed request id, and counts it by app and kind', () => {
    const lines: LogRecord[] = []; sinkInto(lines);
    const c = new ClientErrorsController();
    const before = clientErrors.snapshot().find((s) => s.labels.app === 'owner' && s.labels.kind === 'render')?.value as number ?? 0;
    c.report({ ip: '1.1.1.1' }, valid({ app: 'owner', requestId: 'req_01JABCDEFGHJKMNPQRST', message: 'boom for ada@x.io' }));
    const line = lines.find((l) => l.msg === 'client.error')!;
    expect(line.level).toBe('error');
    expect(line.fields?.failedRequestId ?? (line as any).failedRequestId).toBe('req_01JABCDEFGHJKMNPQRST');
    expect(JSON.stringify(line)).not.toMatch(/ada@x\.io/);
    expect(clientErrors.snapshot().find((s) => s.labels.app === 'owner' && s.labels.kind === 'render')?.value).toBe(before + 1);
  });
  it('an API-error report is WARN, not ERROR — a failed fetch is usually the server\'s error already logged', () => {
    const lines: LogRecord[] = []; sinkInto(lines);
    new ClientErrorsController().report({ ip: '2.2.2.2' }, valid({ kind: 'api' }));
    expect(lines.find((l) => l.msg === 'client.error')!.level).toBe('warn');
  });
  it('an invalid report is dropped silently and counted', () => {
    const lines: LogRecord[] = []; sinkInto(lines);
    const before = clientErrorsDropped.snapshot().find((s) => s.labels.reason === 'invalid')?.value as number ?? 0;
    new ClientErrorsController().report({ ip: '3.3.3.3' }, { app: 'nope' });
    expect(lines.filter((l) => l.msg === 'client.error')).toHaveLength(0);
    expect(clientErrorsDropped.snapshot().find((s) => s.labels.reason === 'invalid')?.value).toBe(before + 1);
  });
  it('a flood from one IP is dropped after the cap', () => {
    const lines: LogRecord[] = []; sinkInto(lines);
    const c = new ClientErrorsController();
    for (let i = 0; i < LIMITS.perIpPerMinute + 10; i++) c.report({ ip: '9.9.9.9' }, valid());
    expect(lines.filter((l) => l.msg === 'client.error').length).toBe(LIMITS.perIpPerMinute);
  });
  it('never throws — an error reporter must not error', () => {
    expect(() => new ClientErrorsController().report(undefined, undefined)).not.toThrow();
  });
});

describe('the browser can actually read the request id (§7, §198)', () => {
  it('CORS exposes x-request-id — without it every client-side "Reference" is empty', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).toMatch(/exposedHeaders:\s*\[[^\]]*'x-request-id'/);
  });
});
