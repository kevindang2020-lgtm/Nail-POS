import { describe, it, expect } from 'vitest';
import { terminalProbe } from './terminal-probe.module';

const ctx = { tenantId: 't1', branchId: 'b1' };
describe('terminal readiness probe (§166) — a ping through the provider router, never a charge', () => {
  it('no HSN → not probed, honest detail', async () => {
    const p = terminalProbe({ resolveTerminalConfig: async () => { throw new Error('must not be called'); } } as any, () => ({ ping: async () => true }));
    expect(await p.probe(ctx, { id: 'term_1', hsn: null, merchantAccountId: null })).toMatchObject({ probed: false, reachable: false });
  });
  it('router refusal (paused merchant / no Bolt) → not probed with the taxonomy code in the detail', async () => {
    const p = terminalProbe({ resolveTerminalConfig: async () => ({ config: null, reason: 'MERCHANT_SUSPENDED' }) } as any, () => ({ ping: async () => true }));
    expect((await p.probe(ctx, { id: 'term_1', hsn: 'HSN1', merchantAccountId: null })).detail).toMatch(/MERCHANT_SUSPENDED/);
    const q = terminalProbe({ resolveTerminalConfig: async () => ({ config: null, reason: 'TERMINAL_NOT_CONFIGURED' }) } as any, () => ({ ping: async () => true }));
    expect((await q.probe(ctx, { id: 'term_1', hsn: 'HSN1', merchantAccountId: null })).detail).toMatch(/TERMINAL_NOT_CONFIGURED/);
  });
  it('pings the terminal\'s HSN with the ROUTED config (terminal merchant account id forwarded) and reports the answer', async () => {
    const seen: any[] = [];
    const p = terminalProbe({ resolveTerminalConfig: async (...a: unknown[]) => { seen.push(a); return { config: { baseUrl: 'https://bolt', apiKey: 'k', merchantId: 'M' } }; } } as any,
      (cfg) => ({ ping: async (hsn: string) => { seen.push({ cfg, hsn }); return true; } }));
    const r = await p.probe(ctx, { id: 'term_1', hsn: 'HSN-9', merchantAccountId: 'ma-1' });
    expect(r).toMatchObject({ probed: true, reachable: true });
    expect(seen[0]).toEqual(['t1', 'b1', 'ma-1']);
    expect(seen[1]).toEqual({ cfg: { baseUrl: 'https://bolt', apiKey: 'k', merchantId: 'M' }, hsn: 'HSN-9' });
  });
  it('a device that throws or answers false → probed, not reachable (no fake success)', async () => {
    const p = terminalProbe({ resolveTerminalConfig: async () => ({ config: { baseUrl: 'b', apiKey: 'k', merchantId: 'M' } }) } as any, () => ({ ping: async () => { throw new Error('ECONNRESET'); } }));
    expect(await p.probe(ctx, { id: 'term_1', hsn: 'H', merchantAccountId: null })).toMatchObject({ probed: true, reachable: false });
  });
});
