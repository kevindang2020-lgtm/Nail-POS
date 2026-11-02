import { describe, it, expect } from 'vitest';
import { SystemHealthService } from './system-health.service';

describe('SystemHealthService', () => {
  it('merges the DB probe and reports real process metrics', async () => {
    const port = { probe: async () => ({ driver: 'postgres' as const, ok: true, latencyMs: 3, serverVersion: 'PostgreSQL 16', tableCount: 82, counts: { tenants: 1, users: 3, activeSubscriptions: 1 } }) };
    const h = await new SystemHealthService(port).getHealth();
    expect(h.ok).toBe(true);
    expect(h.database.tableCount).toBe(82);
    expect(h.database.counts?.users).toBe(3);
    expect(h.process.node).toBe(process.version);
    expect(h.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof h.generatedAt).toBe('string');
    expect(h.gateway).toBeNull(); // probe returned no gateway block → surfaced as null, not fabricated
  });
  it('surfaces the gateway health block from the DB probe when present', async () => {
    const port = { probe: async () => ({ driver: 'postgres' as const, ok: true, latencyMs: 2, gateway: { errors24h: 1, configured: 2, ok: false } }) };
    const h = await new SystemHealthService(port).getHealth();
    expect(h.gateway).toEqual({ errors24h: 1, configured: 2, ok: false });
  });
  it('reports ok=false when the DB probe fails', async () => {
    const port = { probe: async () => ({ driver: 'postgres' as const, ok: false, error: 'down' }) };
    const h = await new SystemHealthService(port).getHealth();
    expect(h.ok).toBe(false);
    expect(h.database.error).toBe('down');
  });
});
