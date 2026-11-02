// voice-fleet.vitest.spec.ts — the cross-tenant Super Admin rollup. Returns an honest disconnected summary with no
// DB, and correct aggregates (no per-tenant row data) when a DB is present.
import { describe, it, expect } from 'vitest';
import { VoiceFleetService } from './voice-fleet.service';

describe('VoiceFleetService', () => {
  it('returns an honest disconnected summary when no database is configured', async () => {
    const s = await new VoiceFleetService(null as any).summary();
    expect(s.connected).toBe(false);
    expect(s.tenantsWithAgents).toBe(0);
    expect(s.agentsByStatus).toEqual({});
  });

  it('is resilient — a failing database yields the empty summary, never an error', async () => {
    const badDb: any = {}; // no executeQuery → sql``.execute throws → caught → EMPTY
    const s = await new VoiceFleetService(badDb).summary();
    expect(s.connected).toBe(false);
    expect(s.provisioningFailures).toBe(0);
  });
});
