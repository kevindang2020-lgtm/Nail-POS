// unassigned-terminals-check.pgtest — scripts/check-unassigned-terminals.mjs on the real migrated schema: it lists only
// PAIRED terminals with no location, names the salon and how many locations it has, and never prints an HSN.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';
// @ts-expect-error — plain .mjs ops script, no type declarations
import { unassignedTerminals, report } from '../../scripts/check-unassigned-terminals.mjs';

const T1 = 'e1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', T2 = 'e2aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B1 = 'e1111111-1111-4111-8111-111111111111', B2 = 'e2111111-1111-4111-8111-111111111111', B3 = 'e3111111-1111-4111-8111-111111111111';
let pg: any;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Two Shops','two-shops','TWOSHP','active'), ($2,'B','Assigned Only','assigned','ASSGND','active')`, [T1, T2]);
  await pg.query(`insert into branches (id, tenant_id, name, status) values ($1,$3,'Main','active'), ($2,$3,'Cherry Hill','active'), ($4,$5,'Only','active')`, [B1, B2, T1, B3, T2]);
  await pg.query(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values
    ('u1',$1,null,'Front Compact','paired','HSN-SECRET-1'),
    ('u2',$1,null,'Old Compact','unpaired','HSN-SECRET-2'),
    ('u3',$1,$2,'Back Compact','paired','HSN-SECRET-3'),
    ('u4',$3,$4,'Only Compact','paired','HSN-SECRET-4')`, [T1, B1, T2, B3]);
}, 180000);

describe('check-unassigned-terminals', () => {
  it('lists only paired terminals with no location, per salon, with its location count', async () => {
    const rows = await unassignedTerminals((sql: string) => pg.query(sql));
    expect(rows).toEqual([{ tenant_id: T1, salon: 'Two Shops', label: 'Front Compact', locations: 2 }]);
    const text = report(rows).join('\n');
    expect(text).toMatch(/1 paired terminal\(s\) have no location/);
    expect(text).toMatch(/Two Shops \(2 locations\): "Front Compact"/);
    expect(text).not.toMatch(/HSN/);
  });
  it('says so plainly when nothing is unassigned', () => {
    expect(report([])).toEqual(['unassigned-terminals: none — every paired terminal belongs to a location']);
  });
});
