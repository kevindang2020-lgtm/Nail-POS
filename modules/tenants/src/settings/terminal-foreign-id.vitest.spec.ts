// terminal-foreign-id — BUILD_PLAN Phase 14 live IDOR run (scripts/live-phase14-idor.mjs): salon B testing salon A's
// payment terminal through GET /pos/settings/payments-checkout/terminals/:id/test got a 500. The repository's query is
// tenant-filtered (it found nothing — correct), but it threw a bare Error, which the platform filter answers as 500.
// "Not found" is a client error: 404 with a code, through the exposed-client-error convention.
import { describe, it, expect } from 'vitest';
import { KyselyTerminalPairingRepository } from './settings.terminals.kysely.repository';

// a Kysely-shaped fake whose every query finds nothing (the other salon's id under this salon's tenant filter)
const chain: any = new Proxy({}, { get: (_t, k) => (k === 'executeTakeFirst' ? async () => undefined : k === 'execute' ? async () => ({ numUpdatedRows: 0n }) : k === 'then' ? undefined : () => chain) });
const db: any = { selectFrom: () => chain, updateTable: () => chain, deleteFrom: () => chain };
// the platform filter's convention (packages/observability request-telemetry.ts isExposedClientError)
const isExposedClientError = (e: any) => e instanceof Error && e.expose === true && Number.isInteger(e.status) && e.status >= 400 && e.status < 500 && typeof e.code === 'string';
const ctx: any = { tenantId: 'tenant-b', branchId: 'branch-b', userId: 'u', role: 'OWNER', permissions: [] };

describe('a terminal id from another salon', () => {
  it('test → a 404 client error (TERMINAL_NOT_FOUND), not a bare Error (500)', async () => {
    const err: any = await new KyselyTerminalPairingRepository(db).test(ctx, 'salon-a-terminal').catch((e) => e);
    expect(isExposedClientError(err)).toBe(true);
    expect(err.status).toBe(404);
    expect(err.code).toBe('TERMINAL_NOT_FOUND');
  });
  it('unpair → the same 404 client error', async () => {
    const err: any = await new KyselyTerminalPairingRepository(db).unpair(ctx, 'salon-a-terminal').catch((e) => e);
    expect(isExposedClientError(err)).toBe(true);
    expect(err.status).toBe(404);
  });
});
