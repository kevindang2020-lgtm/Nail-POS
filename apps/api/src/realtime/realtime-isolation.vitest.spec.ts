// realtime-isolation.vitest.spec — Constitution 12 §34, §287: realtime, cache and job isolation, pinned as CI tests.
//
// Phase 14 found these holding (Constitution 9 built most of them); this file keeps them holding. Each test names
// the property it protects, so a regression reads as the security failure it is.
import { codeRoots, codeKey, sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rooms } from '@aipowersalon/realtime-contracts';
import { InProcessEmitter } from './realtime.gateway';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
const SRC = codeRoots().flatMap((r) => walk(r));
const read = (rel: string) => readFileSync(sourcePath(rel), 'utf8');   // API or owning module (Constitution 13)

/** Every place a realtime stream is opened, with the body of its room resolver. */
function openers(): Array<{ file: string; body: string; opts: string }> {
  const out: Array<{ file: string; body: string; opts: string }> = [];
  for (const f of SRC) {
    const s = readFileSync(f, 'utf8');
    let i = s.indexOf('.streams.open(req,');
    while (i >= 0) {
      let depth = 0, j = s.indexOf('(', i);
      for (let k = j; k < s.length; k++) { if (s[k] === '(') depth++; else if (s[k] === ')') { depth--; if (depth === 0) { j = k; break; } } }
      const call = s.slice(i, j + 1);
      out.push({ file: codeKey(f), body: call, opts: (call.match(/\{\s*frame:\s*'([a-z-]+)'/) || [undefined, 'full'])[1] as string });
      i = s.indexOf('.streams.open(req,', j);
    }
  }
  return out;
}

describe('§34 a stream\'s rooms come from the SERVER, never the client', () => {
  const all = openers();
  it('finds every opener (so the checks below are not vacuous)', () => expect(all.length).toBeGreaterThanOrEqual(7));
  it('no room resolver reads req.query, req.body or req.params', () => {
    for (const o of all) expect(o.body, o.file).not.toMatch(/req\.(query|body|params)/);
  });
  it('the customer display — the one opener keyed by a URL id — validates its token BEFORE choosing the room', () => {
    const s = read('customer-display/customer-display.controller.ts');
    expect(s).toMatch(/if \(!\(await this\.svc\.canAccess\(sid, t\)\)\) throw new ForbiddenException/);
    expect(s).toMatch(/if \(!\(await this\.svc\.deviceValid\(t\)\)\) throw new ForbiddenException/);
  });
});

describe('§22 minimisation: customer and technician streams carry NO payload', () => {
  it('the customer and tech streams are event-only (event name + screens to refetch; data comes via the normal API)', () => {
    const byFile = Object.fromEntries(openers().map((o) => [o.file, o.opts]));
    // Constitution 13: the two SSE endpoints live in domain-streams/ (the API composition adapter)
    expect(byFile['domain-streams/customer-realtime.controller.ts']).toBe('event-only');
    expect(byFile['domain-streams/tech-realtime.controller.ts']).toBe('event-only');
  });
  it('an event-only frame is built without the payload', () => {
    const s = read('realtime/realtime-stream.ts');
    // The ternary's ELSE branch is the line that starts with ': {' after the condition. (My first version split the
    // slice on ':' and checked the last fragment — an object literal is full of colons, so it checked nothing, and a
    // mutation adding the payload to event-only frames survived.)
    const ternary = s.slice(s.indexOf("frameMode === 'full'"), s.indexOf('sub.next({ id: encodeSeqVector'));
    const lines = ternary.split('\n').map((l) => l.trim());
    const full = lines.find((l) => l.startsWith('? {'))!, eventOnly = lines.find((l) => l.startsWith(': {'))!;
    expect(full).toMatch(/payload: e\.payload/);            // the check can see a payload when there is one
    expect(eventOnly).toBeTruthy(); expect(eventOnly).not.toMatch(/payload/);
  });
});

describe('room names are tenant-qualified where a tenant is the scope', () => {
  it('two salons with the SAME branch id land in different rooms', () => {
    expect(rooms.tenantBranch('tenant-a', 'b1')).not.toBe(rooms.tenantBranch('tenant-b', 'b1'));
    expect(rooms.ownerTenant('tenant-a')).not.toBe(rooms.ownerTenant('tenant-b'));
  });
  it('the platform room is aggregates only — it takes no tenant argument', () => expect(rooms.platform.length).toBe(0));
  it('BEHAVIOUR: an event emitted to salon A reaches salon A\'s subscriber and never salon B\'s (same branch id)', () => {
    const em = new InProcessEmitter();
    const a: string[] = [], b: string[] = [];
    em.subscribe(rooms.tenantBranch('tenant-a', 'b1'), (e: any) => a.push(e.event));
    em.subscribe(rooms.tenantBranch('tenant-b', 'b1'), (e: any) => b.push(e.event));
    em.toTenant({ tenantId: 'tenant-a', branchId: 'b1' }, 'queue_updated' as any, { secret: 'A only' });
    expect(a).toEqual(['queue_updated']); expect(b).toEqual([]);
  });
});

describe('§287 caches are keyed by tenant', () => {
  it('TenantCache derives the key prefix from the request context — callers cannot bypass it', () => {
    const s = read('../../../packages/cache/src/tenant-cache.ts');   // the port moved to @aipowersalon/cache (Constitution 13 §94)
    expect(s).toMatch(/const tenant = ctx\.tenantId \|\| '_notenant_';/);
  });
  it('the other caches embed the tenant id in their keys', () => {
    expect(read('ai-checkout-upsell/ai-checkout-upsell.cache.ts')).toMatch(/private ns\(tenantId: string\): string \{ return `\$\{APP\}:tenant:\$\{tenantId\}`; \}/);
    expect(read('ai-booking/ai-booking-revocation.service.ts')).toMatch(/const k = `\$\{tenantId\}:\$\{jti\}`;/);
  });
});

describe('§287 jobs take their tenant from job metadata, never an ambient context', () => {
  it('runJob builds its context from the job record (Constitution 11 §376)', () => {
    expect(read('../../../packages/observability/src/job-telemetry.ts')).toMatch(/const ctx = contextForJob\(\{ jobType: meta\.jobType, jobId: meta\.jobId \?\? undefined, tenantId: meta\.tenantId/);
  });
});
