// overview-board-queries.pgtest — executes the seven panel queries behind the POS Overview board.
//
// Ranked #2 by swallowing catches (6). Every panel fails soft to [] / null, so a broken query renders an EMPTY
// PANEL on the salon's main screen — which reads as "quiet morning", not "the query is broken". The Arrivals
// and Ready-for-Assignment panels are the sharp ones: an empty arrivals list means a waiting guest is invisible
// to the front desk.
//
// Each test seeds a row and asserts it COMES BACK. Empty is the failure being guarded, so no test may pass on [].
import { describe, it, expect, beforeAll } from 'vitest';
import { OverviewBoardService } from './overview-board.service';
// Shared, cached migrated schema — built once, reused by every pgtest (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ctx: any = { tenantId: T, branchId: B };
let svc: OverviewBoardService;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
      VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown');
    -- a guest waiting with no technician assigned → must appear in Ready for Assignment AND Arrivals
    INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, requested_services, created_at)
      VALUES (gen_random_uuid(), '${T}', '${B}', 'Olivia Brown', 'waiting',
              '[{"serviceName":"Gel Manicure"}]'::jsonb, now());
  `);
  const db = kyselyFor(pg);
  svc = new OverviewBoardService(db as any);
}, 60_000);

describe('POS Overview board panels execute against the real migrated schema', () => {
  it('getBoard() returns every panel key — a missing key means a panel vanished', async () => {
    const board: any = await svc.getBoard(ctx);
    for (const k of ['communications', 'customerRetention', 'inventoryAlerts', 'arrivals', 'liveTechQueue', 'readyForAssignment', 'readyForCheckout', 'lastUpdatedAt'])
      expect(board[k]).toBeDefined();
  });

  it('readyForAssignment: the waiting guest IS listed (empty here hides a guest from the front desk)', async () => {
    const board: any = await svc.getBoard(ctx);
    expect(board.readyForAssignment.length).toBe(1);
    expect(board.readyForAssignment[0].customerName).toBe('Olivia Brown');
    expect(board.readyForAssignment[0].serviceName).toBe('Gel Manicure');   // jsonb path resolves
    expect(board.readyForAssignment[0].requestedTech).toBe('Any Available'); // COALESCE fallback
  });

  it('arrivals: the same guest appears in the arrivals queue', async () => {
    const board: any = await svc.getBoard(ctx);
    expect(board.arrivals.some((a: any) => a.customerName === 'Olivia Brown' || a.guest === 'Olivia Brown')).toBe(true);
  });

  it('tenant isolation: another tenant sees none of it', async () => {
    const board: any = await svc.getBoard({ tenantId: '22222222-2222-2222-2222-222222222222', branchId: null });
    expect(board.readyForAssignment.length).toBe(0);
    expect(board.arrivals.length).toBe(0);
  });
});
