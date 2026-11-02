// visit-ticket-category.pgtest — the visit ticket's lines carry their SERVICE CATEGORY (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: Kim, a "Pedi Club" member (20 % off the "Nails" category), paid full price for her
// pedicure. Every line ensureVisitTicket wrote (kiosk / queue / Tech App visits — the floor's tickets) had
// category_snapshot NULL, so (1) a category-scoped membership benefit never matched a line (membership-benefits
// eligibleTotal compares l.categoryName) and (2) a "Technician + Category" / category commission rule never resolved
// (the line was priced with serviceCategory: null). The serving path already snapshots the category; now this one does.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ensureVisitTicket } from './visit-ticket';

const T = 'a7001000-0000-4000-8000-000000000001', B = 'a7001000-0000-4000-8000-000000000002';
const CUST = 'a7001000-0000-4000-8000-0000000000f1', CAT = 'a7001000-0000-4000-8000-0000000000c1', SVC = 'a7001000-0000-4000-8000-0000000000d1', TECH = 'a7001000-0000-4000-8000-0000000000a1';
let pg: any; let db: any;
const one = async (q: string, p: any[] = []) => (await pg.query(q, p)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Cat LLC', 'Cat Salon', 'cat-salon', 'CATSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Spa Pedicure', 60, 6000, 'percent', 50);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Mary', 'N', 'Mary N', 'active');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CUST}', '${T}', '${B}', 'Kim', 'P', 'Kim P');
  `);
}, 180_000);

describe('ensureVisitTicket snapshots the service category', () => {
  it('the line carries "Nails", and a Technician + Category rule (58 %) prices it', async () => {
    const pol = await one(`INSERT INTO compensation_policies (tenant_id, technician_id, service_category, label) VALUES ($1, $2, 'Nails', 'Mary nails') RETURNING id`, [T, TECH]);
    await pg.query(`INSERT INTO compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, effective_start, status, approved) VALUES ($1, $2, 1, 'percent', 58, now() - interval '1 day', 'active', true)`, [pol.id, T]);
    const qi = await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, priority, requested_services, assigned_technician_id)
      VALUES ($1, $2, $5, 'Kim', 'assigned', 'walk_in', 'normal', $3, $4) RETURNING id`, [T, B, JSON.stringify([{ serviceId: SVC, serviceName: 'Spa Pedicure', estimatedDurationMinutes: 60, priceCents: 6000 }]), TECH, CUST]);
    const { ticketId } = await db.transaction().execute((trx: any) => ensureVisitTicket(trx, { tenantId: T, branchId: B }, qi.id));
    const line = await one(`SELECT category_snapshot, commission_value_snapshot::int AS v, rule_source FROM ticket_service_lines WHERE ticket_id = $1`, [ticketId]);
    expect(line.category_snapshot).toBe('Nails');
    expect(line.v).toBe(58);
    expect(line.rule_source).toBe('Technician + Category');
  });
});
