// realtime-isolation.vitest.spec.ts — static guard over the real-time (SSE) tenant-isolation invariants.
//
// Architecture (audited): the push bus (realtime/realtime.gateway.ts) delivers events to named rooms. Room keys are built
// ONLY by the centralized helpers in realtime/realtime-core.ts, and every tenant-scoped key embeds the tenant id
// (`tenant:${t}:branch:${b}`, `tenant:${t}:owner`). Every @Sse stream derives its room from req.ctx (the server-side
// session) — never from client input — so a connection only ever receives its own tenant's events. As defense-in-depth,
// the sensitive per-actor streams (tech / customer / owner / customer-display) forward ONLY the event NAME, never the
// payload, so even a mis-scoped room could not leak data; the client refetches its own server-scoped data on the signal.
// The single exception is the general POS floor stream (realtime/realtime.controller.ts), which subscribes ONLY to the
// caller's own `tenant:${t}:branch:${b}` room (pos.login-gated) and may forward payloads of shared floor state.
//
// This test pins those two invariants so CI catches a regression that (a) drops the tenant id from a room key, or
// (b) adds a NEW stream that forwards event payloads. It is a static guard, not a substitute for validating the live
// socket against a running server (which can't stream in CI) or for penetration testing.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const CORE = readFileSync(join(SRC, '..', '..', '..', 'packages', 'realtime-contracts', 'src', 'realtime-core.ts'), 'utf8');   // Constitution 13 §77: the registry lives in the package

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (e.endsWith('.ts') && !e.includes('.spec.') && !e.includes('.vitest.')) acc.push(p);
  }
  return acc;
}
const sseFiles = codeRoots().flatMap((r) => walk(r)).filter((f) => readFileSync(f, 'utf8').includes('@Sse('));

// The ONLY stream permitted to forward event payloads: the general POS floor stream, which subscribes solely to the
// caller's own tenant+branch room and is pos.login-gated. Justified above. Keep this list to exactly one entry.
const PAYLOAD_ALLOWED = ['realtime/realtime.controller.ts'];

describe('Real-time (SSE) tenant isolation (static)', () => {
  it('finds the real-time SSE streams', () => {
    expect(sseFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps every tenant-scoped room key embedding the tenant id', () => {
    expect(CORE).toContain('tenant:${t}:branch:${b}'); // tenantBranch stays tenant+branch scoped
    expect(CORE).toContain('tenant:${t}:owner');       // owner room stays tenant scoped
  });

  it('forwards event payloads only on the documented tenant+branch POS stream', () => {
    const offenders: string[] = [];
    for (const f of sseFiles) {
      const rel = f.slice(f.indexOf('/src/') + 5);
      if (PAYLOAD_ALLOWED.some((p) => rel.endsWith(p))) continue;
      const src = readFileSync(f, 'utf8');
      // Inspect only the SSE emission envelopes (`data: { ... }`) + any bare `data: <ident>` forward. Comments that
      // merely mention "payload" are not data envelopes, so they don't trip this.
      const inners = [...src.matchAll(/data:\s*\{([^}]*)\}/g)].map((m) => m[1]);
      const leaksPayload = inners.some((inner) => /\bpayload\b/.test(inner) || /\.\.\.e\b/.test(inner));
      const forwardsRawEvent = /data:\s*e\b/.test(src); // e.g. `data: e` (the raw bus event)
      if (leaksPayload || forwardsRawEvent) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
