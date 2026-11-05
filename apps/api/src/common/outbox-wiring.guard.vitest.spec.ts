// outbox-wiring.guard.vitest.spec — the outbox rule (an event is written in the SAME transaction as its row) holds only
// if the writer is really injected. BUILD_PLAN Phase 6: the AI queue-assignment core module injected OutboxWriter
// `{ optional: true }` without importing EventsCoreModule (which is not global), so in the running API the decision,
// auto-assign and settings events were silently never written — every unit test passed (they hand the writer in).
// The live proof caught it. This makes the wiring executable:
//   • no provider injects OutboxWriter as optional (an absent writer must fail the boot, never drop events);
//   • every Nest module file that injects OutboxWriter imports the module that provides it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeRoots, codeKey } from '../../test-support/code-roots';

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist') continue;
    if (statSync(p).isDirectory()) files(p, out); else if (n.endsWith('.ts') && !n.includes('.spec.')) out.push(p);
  }
  return out;
}
const all = codeRoots().flatMap((r) => files(r));

describe('OutboxWriter is wired, never optional', () => {
  it('no provider injects OutboxWriter as optional', () => {
    const bad = all.filter((f) => /token:\s*OutboxWriter\s*,\s*optional:\s*true/.test(readFileSync(f, 'utf8'))).map(codeKey);
    expect(bad).toEqual([]);
  });
  it('every module that injects OutboxWriter imports the module that provides it', () => {
    const bad = all.filter((f) => f.endsWith('.module.ts')).filter((f) => {
      const s = readFileSync(f, 'utf8');
      if (!/inject:\s*\[[^\]]*\bOutboxWriter\b/.test(s)) return false;
      return !/imports:\s*\[[^\]]*\b(EventsCoreModule|EventsModule)\b/.test(s) && !/providers:\s*\[[^\]]*provide:\s*OutboxWriter/.test(s);
    }).map(codeKey);
    expect(bad).toEqual([]);
  });
});
