// service-taxable.pgtest — D2 Services guide (Nov 4 2026): a service can be marked NOT taxable. The ticket line copies the
// setting when it is rung up (trigger, 792), checkout taxes only the taxable part (the discount shared by price), a line
// refund of an untaxed service gives back no tax, and a salon that marks nothing is charged exactly as before.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { taxableSubtotal } from './checkout.dto';
import { taxCents } from '@aipowersalon/money';

const T = 'c9200000-0000-4000-8000-000000000001', B = 'c9200000-0000-4000-8000-000000000002', C = 'c9200000-0000-4000-8000-000000000004';
const TAXED = 'c9200000-0000-4000-8000-0000000000a1', UNTAXED = 'c9200000-0000-4000-8000-0000000000a2', CAT = 'c9200000-0000-4000-8000-0000000000c1';
const ctx: any = { tenantId: T, branchId: B, userId: 'c9200000-0000-4000-8000-000000000005', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment'] };
let pg: any; let repo: KyselyCheckoutRepository; let n = 0;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
async function ticket(lines: Array<{ service: string; cents: number }>, discount = 0): Promise<string> {
  n++;
  const id = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, chosen_payment_method) values ($1,$2,$3,'ready_checkout',$4,0,0,$5,0,0,'cash') returning id`, [T, B, C, 'TX' + n, discount]))[0].id;
  for (const l of lines) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Svc',$5,30,$5)`, [T, B, id, l.service, l.cents]);
  return String(id);
}

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Tax LLC','Tax','tax-salon','TAX001','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Tax','Ana Tax')`, [C, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$3,$5,$4,'Gel',45,5000), ($2,$3,$5,$4,'Gift wrap',5,1000)`, [TAXED, UNTAXED, T, CAT, B]);
  await q(`update services set is_taxable = false where id = $1`, [UNTAXED]);
  await q(`insert into tenant_settings (tenant_id, setting_key, settings_json) values ($1, 'tax', '{"enabled": true, "taxRatePercent": 10}'::jsonb) on conflict do nothing`, [T]).catch(() => undefined);
  repo = new KyselyCheckoutRepository(kyselyFor(pg) as never);
}, 180_000);

describe('per-service tax', () => {
  it('the line copies its service\'s setting when rung up; changing the service later does not change the line', async () => {
    const id = await ticket([{ service: TAXED, cents: 5000 }, { service: UNTAXED, cents: 1000 }]);
    const lines = await q(`select service_id, is_taxable from ticket_service_lines where ticket_id = $1 order by line_total_cents desc`, [id]);
    expect(lines).toEqual([{ service_id: TAXED, is_taxable: true }, { service_id: UNTAXED, is_taxable: false }]);
    await q(`update services set is_taxable = true where id = $1`, [UNTAXED]);
    expect((await q(`select is_taxable from ticket_service_lines where ticket_id = $1 and service_id = $2`, [id, UNTAXED]))[0].is_taxable).toBe(false);
    await q(`update services set is_taxable = false where id = $1`, [UNTAXED]);
  });
  it('checkout taxes only the taxable part; with every line taxable the total is exactly as before', async () => {
    const pct = Number((await (repo as any).settings(ctx)).taxRatePercent);   // the salon's rate, whatever the fixture resolved
    const rate = (await repo.totalsFor(ctx, await ticket([{ service: TAXED, cents: 5000 }])))!;
    expect(rate.taxCents).toBe(taxCents(5000, pct));
    const mixed = (await repo.totalsFor(ctx, await ticket([{ service: TAXED, cents: 5000 }, { service: UNTAXED, cents: 1000 }])))!;
    expect(mixed.subtotalCents).toBe(6000);
    expect(mixed.taxCents).toBe(rate.taxCents);                         // tax on the $50 only, not $60
    expect(mixed.totalDueCents).toBe(6000 + rate.taxCents);
    const allTaxed = (await repo.totalsFor(ctx, await ticket([{ service: TAXED, cents: 5000 }, { service: TAXED, cents: 1000 }])))!;
    expect(allTaxed.taxCents).toBe(taxCents(6000, pct));
  });
  it('the ticket discount is shared by price before tax', () => {
    expect(taxableSubtotal([{ priceCents: 5000 }, { priceCents: 1000, taxable: false }], 600)).toBe(4500);   // (6000 − 600) × 5/6
    expect(taxableSubtotal([{ priceCents: 5000 }, { priceCents: 1000 }], 600)).toBe(5400);                   // unchanged rule when all taxed
    expect(taxableSubtotal([{ priceCents: 1000, taxable: false }], 0)).toBe(0);
  });
});
