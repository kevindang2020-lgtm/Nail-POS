// plan-links.pgtest — batch 8 decision 3 (Nov 9 2026) on the REAL schema: list salons whose plan text maps to no
// catalogue plan, link one (plan_code only — text and price untouched, audited), and entitlements then read the link.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PlanLinks, PlanLinkError } from './plan-links';
import { KyselyEntitlementsRepo } from './entitlements.kysely.repository';
import { RecordingAuditSink } from '@aipowersalon/audit';

const P = 'c8460000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T1 = id(1), T2 = id(2), U = id(9);
const manage = { userId: U, permissions: ['super_admin.subscriptions.manage'] };
let db: any; let links: PlanLinks; const sink = new RecordingAuditSink();
const q = async (s: any) => (await s.execute(db)).rows as any[];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  links = new PlanLinks(db, sink);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T1}, 'A', 'Pilot', 'pl-846a', 'PL846A', 'active'), (${T2}, 'B', 'Linked', 'pl-846b', 'PL846B', 'active')`);
  await q(sql`insert into subscription_plans (code, name, status) values ('pl846_pro', 'PL846 Pro', 'active') on conflict do nothing`);
  await q(sql`insert into tenant_subscriptions (tenant_id, plan, status, monthly_price_cents) values (${T1}, 'Standard', 'active', 4900), (${T2}, 'PL846 Pro', 'active', 9900)`);
});

describe('plan links (Super Admin)', () => {
  it('lists only salons whose plan maps to no catalogue plan', async () => {
    const r = await links.unlinked();
    const mine = r.tenants.filter((t) => t.tenantId === T1 || t.tenantId === T2);
    expect(mine.map((t) => [t.tenantCode, t.planText])).toEqual([['PL846A', 'Standard']]);
    expect(r.plans.some((p) => p.code === 'pl846_pro')).toBe(true);
  });
  it('refuses without the manage permission and for an unknown plan', async () => {
    await expect(links.link({ userId: U, permissions: [] }, T1, 'pl846_pro', 'pilot salon link')).rejects.toBeInstanceOf(PlanLinkError);
    await expect(links.link(manage, T1, 'nope', 'pilot salon link')).rejects.toThrow(/No catalogue plan/);
  });
  it('links: plan_code set, plan text and price untouched, audited, and entitlements now map it', async () => {
    const before = await new KyselyEntitlementsRepo(db).getActivePlanText(T1);
    expect(before).toBe('Standard');
    const r = await links.link(manage, T1, 'PL846_PRO', 'pilot salon link');
    expect(r).toEqual({ tenantId: T1, planCode: 'pl846_pro', planText: 'Standard' });
    const [s] = await q(sql`select plan, plan_code, monthly_price_cents from tenant_subscriptions where tenant_id = ${T1}`);
    expect([s.plan, s.plan_code, Number(s.monthly_price_cents)]).toEqual(['Standard', 'pl846_pro', 4900]);
    expect(sink.entries.at(-1)).toMatchObject({ tenantId: T1, action: 'super_admin_subscription_plan_linked', metadata: { planText: 'Standard', toPlanCode: 'pl846_pro', reason: 'pilot salon link' } });
    const repo = new KyselyEntitlementsRepo(db);
    const text = await repo.getActivePlanText(T1);
    expect(text).toBe('pl846_pro');
    expect((await repo.mapCatalogPlan(text!))?.code).toBe('pl846_pro');
    expect((await links.unlinked()).tenants.some((t) => t.tenantId === T1)).toBe(false);
  });
});
