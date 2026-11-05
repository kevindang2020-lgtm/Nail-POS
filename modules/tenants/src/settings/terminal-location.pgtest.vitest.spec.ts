// terminal-location.pgtest.vitest.spec.ts — Fiserv master build §5.2 (Nov 4 2026), on the real schema:
// a terminal always belongs to one location. Pairing needs one; unassigned terminals are listed (flagged) and can be
// assigned; migration 702 assigns them automatically ONLY for a single-location salon.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTerminalPairingRepository } from './settings.terminals.kysely.repository';

const ONE = 'e1111111-1111-4111-8111-111111111111', MULTI = 'e2222222-2222-4222-8222-222222222222';
const ONE_BR = 'e1a11111-1111-4111-8111-111111111111', M_BR1 = 'e2b11111-1111-4111-8111-111111111111', M_BR2 = 'e2b22222-1111-4111-8111-111111111111';
let pg: any; let repo: KyselyTerminalPairingRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const MIGRATION = readFileSync(join(MIGRATIONS_DIR, '702_assign_unassigned_terminals_single_location.sql'), 'utf8');

beforeAll(async () => {
  pg = await migratedPglite(); repo = new KyselyTerminalPairingRepository(kyselyFor(pg) as any);
  for (const [id, slug] of [[ONE, 'one-loc'], [MULTI, 'multi-loc']]) await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','S',$2,upper($2),'active')`, [id, slug]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Only','active'), ($3,$4,'North','active'), ($5,$4,'South','active')`, [ONE_BR, ONE, M_BR1, MULTI, M_BR2]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values ('term_one',$1,null,'Old Compact','paired','H1'), ('term_multi',$2,null,'Mystery Compact','paired','H2')`, [ONE, MULTI]);
}, 180000);

describe('terminal locations', () => {
  it('migration 702 assigns the single-location salon\'s terminal and leaves the multi-location one for the owner', async () => {
    await pg.exec(MIGRATION);
    expect((await q(`select branch_id from pos_payment_terminals where id = 'term_one'`))[0].branch_id).toBe(ONE_BR);
    expect((await q(`select branch_id from pos_payment_terminals where id = 'term_multi'`))[0].branch_id).toBeNull();
    await pg.exec(MIGRATION);   // idempotent
    expect((await q(`select count(*)::int as n from pos_payment_terminals where branch_id is null`))[0].n).toBe(1);
  });

  it('a location lists the salon\'s unassigned terminal, flagged', async () => {
    const list = await repo.list({ tenantId: MULTI, branchId: M_BR1 } as any);
    expect(list.find((t) => t.id === 'term_multi')).toMatchObject({ unassigned: true });
  });

  it('"Assign to this location" gives it to the signed-in location once; another tenant cannot take it', async () => {
    await expect(repo.assignToLocation({ tenantId: ONE, branchId: ONE_BR } as any, 'term_multi')).rejects.toMatchObject({ status: 404 });
    const t = await repo.assignToLocation({ tenantId: MULTI, branchId: M_BR2 } as any, 'term_multi');
    expect(t.unassigned).toBeUndefined();
    expect((await q(`select branch_id from pos_payment_terminals where id = 'term_multi'`))[0].branch_id).toBe(M_BR2);
    await expect(repo.assignToLocation({ tenantId: MULTI, branchId: M_BR1 } as any, 'term_multi')).rejects.toMatchObject({ status: 404 });   // never moves an assigned one
  });

  it('pairing without a location is refused', async () => {
    await expect(repo.pair({ tenantId: MULTI, branchId: null } as any, '123456', 'New')).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
    const t = await repo.pair({ tenantId: MULTI, branchId: M_BR1 } as any, '654321', 'Front');
    expect((await q(`select branch_id from pos_payment_terminals where id = $1`, [t.id]))[0].branch_id).toBe(M_BR1);
  });
});
