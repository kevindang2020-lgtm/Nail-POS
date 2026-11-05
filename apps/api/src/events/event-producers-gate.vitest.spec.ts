// event-producers-gate.vitest.spec — BUILD_PLAN Phase 15 (Constitution 8 §7/§18): the domain-event producer gate.
//
// 1. On the real tree: every registry event is recorded through the outbox, and no retired name is referenced anywhere in
//    code (the zero-importer rule for the three retired visit / checkout / payment names — see RETIRED in the script).
// 2. On fixtures: the gate cannot be satisfied by a comment, a consumer's own subscription, a comparison, or a mention in a
//    root that never writes the outbox; and it does fail on an off-registry subscription, a retired reference and a stale
//    catalog — each proven by a tree that differs from a passing one in exactly that one way.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/audit-event-producers.mjs');
// The retired names are assembled from parts: this file would otherwise be the one importer the zero-importer rule finds.
const R = { visit: ['visit', 'started'], checkout: ['checkout', 'started'], payment: ['payment', 'authorized'] };
const RETIRED_NAMES = Object.values(R).map((p) => p.join('.'));
const RETIRED_KEYS = Object.values(R).map((p) => p.join('_').toUpperCase());
const run = (root?: string, ...args: string[]) => {
  const r = spawnSync('node', [SCRIPT, '--json', ...args], { encoding: 'utf8', env: { ...process.env, ...(root ? { EVENT_AUDIT_ROOT: root } : {}) } });
  return { code: r.status, out: JSON.parse(r.stdout || '{}') as { noProducer: string[]; problems: string[]; events: number } };
};

describe('the real tree', () => {
  it('every registry event has an outbox producer; nothing else is wrong', () => {
    const { code, out } = run();
    expect(out.problems).toEqual([]);
    expect(out.noProducer).toEqual([]);
    expect(code).toBe(0);
  });
  it('the three retired events are gone from the registry and referenced by no code (zero importers)', async () => {
    const { DOMAIN_EVENTS } = await import('@aipowersalon/events');
    const values = Object.values(DOMAIN_EVENTS) as string[];
    for (const n of RETIRED_NAMES) expect(values).not.toContain(n);
    for (const k of RETIRED_KEYS) expect(Object.keys(DOMAIN_EVENTS)).not.toContain(k);
    expect(RETIRED_NAMES).toHaveLength(3);
    expect(run().out.problems.filter((p) => p.startsWith('RETIRED NAME'))).toEqual([]);
  });
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
const CONTRACT = `export const DOMAIN_EVENTS = {
  THING_DONE: 'thing.done',
  OTHER_HAPPENED: 'other.happened',
} as const;
`;
const PRODUCER = `import { createDomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
export async function a(trx: any, outbox: any) { await outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.THING_DONE } as any)); }
export async function b(trx: any, outbox: any) { await outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.OTHER_HAPPENED } as any)); }
`;
const CONSUMER = `import { DOMAIN_EVENTS } from '@aipowersalon/events';
export class C { readonly eventTypes = [DOMAIN_EVENTS.THING_DONE] as const; }
`;
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'evgate-'));
  const all: Record<string, string> = {
    'packages/events/src/event-contract.ts': CONTRACT,
    'modules/m/src/producer.ts': PRODUCER,
    'apps/api/src/consumer.ts': CONSUMER,
    ...files,
  };
  for (const [p, body] of Object.entries(all)) { if (body == null) continue; mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); }
  mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}
/** write the catalog for the tree, then check it (a fresh tree has no catalog yet) */
const check = (root: string) => { run(root, '--write-catalog'); return run(root); };

describe('the gate on fixtures', () => {
  it('a tree where both events are produced passes', () => {
    const root = tree({});
    try { expect(check(root)).toMatchObject({ code: 0, out: { noProducer: [], problems: [] } }); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a comment naming the event is not a producer', () => {
    const root = tree({ 'modules/m/src/producer.ts': PRODUCER.replace('DOMAIN_EVENTS.OTHER_HAPPENED }', 'DOMAIN_EVENTS.THING_DONE }') + `// DOMAIN_EVENTS.OTHER_HAPPENED / 'other.happened' is recorded elsewhere\n/* DOMAIN_EVENTS.OTHER_HAPPENED */\n` });
    try { const r = check(root); expect(r.code).toBe(1); expect(r.out.noProducer).toEqual(['other.happened']); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("a consumer's subscription, a projection-map key and a comparison are not producers", () => {
    const root = tree({
      'modules/m/src/producer.ts': PRODUCER.replace('DOMAIN_EVENTS.OTHER_HAPPENED }', 'DOMAIN_EVENTS.THING_DONE }'),
      'apps/api/src/consumer.ts': CONSUMER + `const MAP = { [DOMAIN_EVENTS.OTHER_HAPPENED]: 1 };\nexport const is = (e: any) => e.eventType === DOMAIN_EVENTS.OTHER_HAPPENED;\nexport class D { readonly eventTypes = [DOMAIN_EVENTS.OTHER_HAPPENED] as const; }\nimport { createDomainEvent } from 'x'; export const w = (o: any) => o.write(1, createDomainEvent({} as any));\n`,
    });
    try { const r = check(root); expect(r.code).toBe(1); expect(r.out.noProducer).toEqual(['other.happened']); expect(r.out.problems.join('\n')).toMatch(/waits for it forever/); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a mention in a root that never writes the outbox is not a producer', () => {
    const root = tree({
      'modules/m/src/producer.ts': PRODUCER.replace('DOMAIN_EVENTS.OTHER_HAPPENED }', 'DOMAIN_EVENTS.THING_DONE }'),
      'modules/labels/src/labels.ts': `import { DOMAIN_EVENTS } from '@aipowersalon/events';\nexport const LABEL = { x: DOMAIN_EVENTS.OTHER_HAPPENED };\n`,
    });
    try { expect(check(root).out.noProducer).toEqual(['other.happened']); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a helper that passes the type through (this.emit(ctx, DOMAIN_EVENTS.X)) in an outbox-writing root IS a producer', () => {
    const root = tree({
      'modules/m/src/producer.ts': PRODUCER.replace('DOMAIN_EVENTS.OTHER_HAPPENED }', 'DOMAIN_EVENTS.THING_DONE }'),
      'modules/m/src/service.ts': `import { DOMAIN_EVENTS } from '@aipowersalon/events';\nexport class S { emit(..._a: any[]) {} go() { this.emit({}, DOMAIN_EVENTS.OTHER_HAPPENED, {}); } }\n`,
    });
    try { expect(check(root)).toMatchObject({ code: 0, out: { noProducer: [] } }); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('an off-registry subscription fails', () => {
    const root = tree({ 'apps/api/src/consumer.ts': CONSUMER.replace('DOMAIN_EVENTS.THING_DONE]', "DOMAIN_EVENTS.THING_DONE, DOMAIN_EVENTS.NOT_A_THING, 'not.registered']") });
    try { const p = check(root).out.problems.join('\n'); expect(p).toMatch(/OFF-REGISTRY SUBSCRIPTION: .*NOT_A_THING/); expect(p).toMatch(/OFF-REGISTRY SUBSCRIPTION: .*"not\.registered"/); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a retired name referenced anywhere in code fails — a test file included', () => {
    const root = tree({ 'apps/admin-web/src/x.test.tsx': `const fixture = '${RETIRED_NAMES[2]}';\n` });
    try { const r = check(root); expect(r.code).toBe(1); expect(r.out.problems).toEqual([expect.stringMatching(/RETIRED NAME: apps\/admin-web\/src\/x\.test\.tsx .*payment\.author/)]); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a retired name still in the registry fails', () => {
    const root = tree({ 'packages/events/src/event-contract.ts': CONTRACT.replace('} as const;', `  ${RETIRED_KEYS[0]}: '${RETIRED_NAMES[0]}',\n} as const;`) });
    try { expect(check(root).out.problems.join('\n')).toMatch(/RETIRED NAME: VISIT_START.* is still in the registry/); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a reservation with a reason excuses an unproduced event; one that is produced, or subscribed to, is stale', () => {
    const reason = 'reserved for the producer landing with the processor integration';
    const unproduced = { 'modules/m/src/producer.ts': PRODUCER.replace('DOMAIN_EVENTS.OTHER_HAPPENED }', 'DOMAIN_EVENTS.THING_DONE }') };
    const r1 = tree({ ...unproduced, 'apps/api/scripts/event-producers.reserved.json': JSON.stringify({ reserved: [{ event: 'other.happened', reason }] }) });
    const r2 = tree({ 'apps/api/scripts/event-producers.reserved.json': JSON.stringify({ reserved: [{ event: 'other.happened', reason }] }) });
    const r3 = tree({ ...unproduced, 'apps/api/src/consumer.ts': CONSUMER.replace('THING_DONE]', 'THING_DONE, DOMAIN_EVENTS.OTHER_HAPPENED]'), 'apps/api/scripts/event-producers.reserved.json': JSON.stringify({ reserved: [{ event: 'other.happened', reason }] }) });
    try {
      expect(check(r1)).toMatchObject({ code: 0, out: { problems: [] } });
      expect(check(r2).out.problems.join('\n')).toMatch(/STALE RESERVATION: "other\.happened" is produced/);
      expect(check(r3).out.problems.join('\n')).toMatch(/STALE RESERVATION: "other\.happened" is reserved but .* subscribes/);
    } finally { for (const r of [r1, r2, r3]) rmSync(r, { recursive: true, force: true }); }
  });
  it('a stale catalog fails', () => {
    const root = tree({});
    try {
      run(root, '--write-catalog');
      writeFileSync(join(root, 'modules/m/src/producer.ts'), PRODUCER + `export const extra = (o: any) => o.write(1, createDomainEvent({ eventType: 'thing.done' } as any));\n`);
      // a second producer file changes nothing in the catalog (same file) — move the producer to another file instead
      writeFileSync(join(root, 'modules/m/src/producer2.ts'), PRODUCER);
      expect(run(root).out.problems).toEqual([expect.stringMatching(/^CATALOG STALE/)]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
