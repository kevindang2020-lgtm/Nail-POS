// membership-demo-redemption.pgtest — Nov 4 2026: migration 193 put a fake $49 "redeemed" entry into a real past-due member's
// ledger; 791 removes exactly that row and nothing else.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migratedPglite } from '@aipowersalon/testing';

const T = '7d000000-0000-4000-8000-000000000001', B = '7d000000-0000-4000-8000-0000000000b1', C = '7d000000-0000-4000-8000-0000000000c1', P = '7d000000-0000-4000-8000-0000000000e1', M = '7d000000-0000-4000-8000-0000000000a1';
const SQL791 = readFileSync(fileURLToPath(new URL('../../../apps/api/db/migrations/791_remove_membership_demo_redemption.sql', import.meta.url)), 'utf8');
let pg: any;
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','memdemo','MEMDEMO','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','One');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B}','A','B','A B');
    INSERT INTO membership_plans (id, tenant_id, name, status) VALUES ('${P}','${T}','Gold','active');
    INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number) VALUES ('7d000000-0000-4000-8000-0000000000f1','${P}','${T}',1);
    INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${M}','${T}','${B}','${C}','${P}','7d000000-0000-4000-8000-0000000000f1','past_due','M-DEMO1');
    INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, entry_type, quantity, amount_cents, reason) VALUES
      ('${T}','${M}','redeemed',1,4900,'demo_redeemed_while_past_due'),
      ('${T}','${M}','redeemed',1,4900,'visit');`);
}, 120_000);

describe('791 removes the demo redemption only', () => {
  it('the marker row goes; a real redemption of the same size stays', async () => {
    await pg.exec(SQL791);
    const rows = (await pg.query(`SELECT reason FROM membership_credit_ledger WHERE customer_membership_id = '${M}' ORDER BY reason`)).rows;
    expect(rows).toEqual([{ reason: 'visit' }]);
  });
});
