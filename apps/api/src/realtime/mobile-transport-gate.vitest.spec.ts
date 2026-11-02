// mobile-transport-gate.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §11–16): check:mobile-transport catches a
// hand-rolled fetch / EventSource in the four apps, a client not built on createTransport, and a stream without tickets.
import { describe, it, expect } from 'vitest';
const g: any = await import('../../scripts/check-mobile-transport.mjs');

describe('check:mobile-transport', () => {
  it('T1/T2: a raw fetch, XMLHttpRequest, sendBeacon or EventSource in an app file is a finding; refetch() and comments are not', () => {
    const f = g.scan([
      { file: 'a.ts', src: "const r = await fetch('/api/v1/x');" },
      { file: 'b.ts', src: 'const x = new XMLHttpRequest();\nnavigator.sendBeacon(u, b);' },
      { file: 'c.ts', src: "const es = new EventSource('/tech/stream');" },
      { file: 'd.ts', src: 'refetch(); query.prefetch(); // fetch( in a comment\n/* fetch(x) */' },
    ]);
    expect(f.map((x: any) => `${x.file}:${x.rule}`)).toEqual(['a.ts:T1', 'b.ts:T1', 'b.ts:T1', 'c.ts:T2']);
  });
  it('T3/T4: each app client is createTransport with its own id, and each stream hook passes the ticketed streamUrl', () => {
    const good = (rel: string) => rel.endsWith('client.ts')
      ? `export const transport = createTransport({\n  app: '${({ 'customer-web': 'customer', 'tech-web': 'tech', 'owner-web': 'owner', 'manager-pay-web': 'manager-pay' } as any)[rel.split('/')[1]]}',`
      : 'createRealtimeClient({ streamPath: x, streamUrl: realtimeStreamUrl(transport, \'/s\') })';
    expect(g.checkClients(good)).toEqual([]);
    const wrongId = (rel: string) => (rel === 'apps/tech-web/src/api/client.ts' ? "createTransport({ app: 'owner' })" : good(rel));
    expect(g.checkClients(wrongId).map((x: any) => x.rule)).toEqual(['T3']);
    const noTicket = (rel: string) => (rel === 'apps/owner-web/src/api/useOwnerStream.ts' ? 'createRealtimeClient({ streamPath: apiUrl(p) })' : good(rel));
    expect(g.checkClients(noTicket).map((x: any) => `${x.file}:${x.rule}`)).toEqual(['apps/owner-web/src/api/useOwnerStream.ts:T4']);
  });
});
