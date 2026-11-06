// tenant-consistency.pgtest — Constitution 12 §28–30, §32, §297–299: a crossed salon id can no longer be WRITTEN.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'node:fs';

import { INVARIANTS } from '../observability/integrity-checks';
import { migratedPglite } from '@aipowersalon/testing';

let pg: any;
const TA = 'e1e1e1e1-0000-4000-8000-00000000000a', TB = 'e1e1e1e1-0000-4000-8000-00000000000b';
const BA = 'e2e2e2e2-0000-4000-8000-00000000000a', BB = 'e2e2e2e2-0000-4000-8000-00000000000b';
const CA = 'e3e3e3e3-0000-4000-8000-00000000000a', CB = 'e3e3e3e3-0000-4000-8000-00000000000b';
beforeAll(async () => {
  pg = await migratedPglite();
  for (const [t, code] of [[TA, 'TCA1'], [TB, 'TCB1']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A'), ('${BB}', '${TB}', 'B') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'A', 'A', 'A A'), ('${CB}', '${TB}', '${BB}', 'B', 'B', 'B B') ON CONFLICT DO NOTHING`);
});
const insTicket = (tenant: string, branch: string, customer: string) => pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [tenant, branch, customer]);

describe('§32 a crossed reference is refused at the database', () => {
  it('INSERT: salon A\'s ticket charging salon B\'s customer is refused', async () => {
    await expect(insTicket(TA, BA, CB)).rejects.toThrow(/cross-tenant reference refused: tickets\.customer_id/);
  });
  it('INSERT: a crossed branch is refused by its own trigger', async () => {
    await expect(insTicket(TA, BB, CA)).rejects.toThrow(/tickets\.branch_id/);
  });
  it('UPDATE: re-pointing a clean ticket at another salon\'s customer is refused', async () => {
    const id = (await insTicket(TA, BA, CA)).rows[0].id;
    await expect(pg.query(`UPDATE tickets SET customer_id = $1 WHERE id = $2`, [CB, id])).rejects.toThrow(/cross-tenant/);
  });
  it('UPDATE: moving the ticket to salon B while it still names A\'s customer is refused too', async () => {
    const id = (await insTicket(TA, BA, CA)).rows[0].id;
    await expect(pg.query(`UPDATE tickets SET tenant_id = $1 WHERE id = $2`, [TB, id])).rejects.toThrow(/cross-tenant/);
  });
});

describe('a tenant_id change is covered on its own — not only when a sibling trigger happens to fire', () => {
  // The ticket test above passes even if the customer trigger ignored tenant_id changes, because the BRANCH trigger
  // also fires and refuses first (a mutation survived that way). gift_cards has ONE invariant, so nothing masks it.
  it('moving a gift card to salon B while it is still owned by salon A\'s customer is refused', async () => {
    const id = (await pg.query(`INSERT INTO gift_cards (tenant_id, code, customer_id) VALUES ($1, 'GC-TC-1', $2) RETURNING id`, [TA, CA])).rows[0].id;
    await expect(pg.query(`UPDATE gift_cards SET tenant_id = $1 WHERE id = $2`, [TB, id])).rejects.toThrow(/gift_cards\.customer_id/);
  });
});

describe('it changes nothing else — the reason it is a trigger, not a composite foreign key', () => {
  it('a clean write goes through', async () => expect((await insTicket(TA, BA, CA)).rows).toHaveLength(1));
  it('an update of an UNRELATED column is not even checked (OF tenant_id, <column>)', async () => {
    const id = (await insTicket(TA, BA, CA)).rows[0].id;
    await expect(pg.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [id])).resolves.toBeTruthy();
  });
  it('NULL is not a mismatch (an optional link)', async () => {
    await expect(pg.query(`INSERT INTO payment_intents (tenant_id, branch_id, customer_id) VALUES ($1, $2, NULL) RETURNING id`, [TA, BA]).catch((e: Error) => { if (/cross-tenant/.test(e.message)) throw e; return 'other-constraint'; })).resolves.toBeTruthy();
  });
  it('DELETING a parent that is still referenced behaves exactly as before (no FK was added)', async () => {
    const C2 = 'e3e3e3e3-0000-4000-8000-0000000000c2';
    await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C2}', '${TA}', '${BA}', 'X', 'X', 'X X')`);
    await insTicket(TA, BA, C2);
    const hadFk = (await pg.query(`SELECT count(*)::int c FROM pg_constraint WHERE contype = 'f' AND conrelid = 'tickets'::regclass AND confrelid = 'customers'::regclass`)).rows[0].c > 0;
    const del = pg.query(`DELETE FROM customers WHERE id = $1`, [C2]);
    if (hadFk) await expect(del).rejects.toThrow(); else await expect(del).resolves.toBeTruthy();
  });
  it('a reference to a row that does not exist is left to whatever handled it before (this is about salons, not orphans)', async () => {
    await expect(insTicket(TA, BA, 'e3e3e3e3-0000-4000-8000-00000000dead').catch((e: Error) => { if (/cross-tenant/.test(e.message)) throw e; return 'other'; })).resolves.toBeTruthy();
  });
});

describe('prevention and detection cover the SAME relationships', () => {
  it('every Constitution 11 integrity invariant has its trigger, installed on the real schema', async () => {
    const trg = (await pg.query(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_tc_%'`)).rows.map((r: any) => r.tgname).sort();
    expect(trg).toEqual(INVARIANTS.map((i) => `trg_tc_${i.id}`).sort());
  });
  it('each trigger names the right parent and column (the migration was generated from INVARIANTS, not typed)', () => {
    const sql = ['450_tenant_consistency_triggers.sql', '539_versions_consistency_ids_settlement.sql', '601_turn_unit_rules.sql', '602_technician_turn_state_and_events.sql', '638_payment_merchant_accounts_and_terminal_registry.sql', '646_technician_employment_history_and_profile_policy.sql', '660_mobile_pay_intent_surface_and_device_trust.sql', '674_platform_pos_announcements.sql'].map((f) => readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')).join('\n').replace(/\s+/g, ' ');   // whitespace-insensitive: 601/602 wrap the clause
    for (const i of INVARIANTS) expect(sql).toContain(`ON ${i.child} FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('${i.parent}', '${i.column}')`);
  });
});
