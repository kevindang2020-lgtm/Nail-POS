/* verify-owner-multisalon.ts — Owner Multi-Salon over real Postgres (PGlite). Proves: an OWNER assigned (via
 * user_branch_access) to a SUBSET of a tenant's branches sees ONLY those branches in branch list / context /
 * combined dashboard / finance; is FORBIDDEN from an unassigned branch; an OWNER with NO rows still sees the whole
 * tenant (legacy). Plus the Super Admin assignment service: assign / primary exclusivity / cross-tenant rejection /
 * remove. Tenant isolation holds throughout. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyOwnerRepository } from '../../../modules/analytics/src/owner/owner.kysely.repository';
import { OwnerService } from '../../../modules/analytics/src/owner/owner.service';
import type { OwnerContext } from '../../../modules/analytics/src/owner/owner.repository';
import { SuperAdminOwnersService } from '../../../modules/super-admin/src/super-admin-owners/super-admin-owners.service';
import { permissionsFor } from '../../../packages/permissions/src/rbac';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5489;
  const T = '00000000-0000-0000-0000-00000000a001';        // Luxe Nails Group
  const B1 = '00000000-0000-0000-0000-00000000ab01', B2 = '00000000-0000-0000-0000-00000000ab02', B3 = '00000000-0000-0000-0000-00000000ab03';
  const UO = '00000000-0000-0000-0000-00000000a0c1';        // owner assigned to B1+B2
  const UO2 = '00000000-0000-0000-0000-00000000a0c2';       // owner with NO access rows (legacy whole-tenant)
  const UO3 = '00000000-0000-0000-0000-00000000a0c3';       // owner for the "unlimited salons" proof
  const T9 = '00000000-0000-0000-0000-00000000a999', B9 = '00000000-0000-0000-0000-00000000ab99'; // other tenant
  const SA = '00000000-0000-0000-0000-00000000acaa';

  const { migratedPglite } = await import('@aipowersalon/testing');   // Oct 20 2026: ONE schema builder (pgcrypto + pg_trgm + btree_gist, cached) — the hand-rolled replay lacked pg_trgm (migration 107)
  const db = await migratedPglite();
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Luxe','Luxe Nails Group','luxe','LUXE','active'),('${T9}','Other','Other Group','other','OTHR','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status, address, city, state) VALUES
    ('${B1}','${T}','Cherry Hill','active','100 Haddonfield Rd','Cherry Hill','NJ'),
    ('${B2}','${T}','Pennsauken','active',NULL,'Pennsauken','NJ'),
    ('${B3}','${T}','Marlton','active',NULL,'Marlton','NJ'),('${B9}','${T9}','Far Away','active',NULL,'Nowhere','PA')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES
    ('${UO}','${T}',NULL,'Kevin','Dang','Kevin Dang','kevin@luxe.com','active','OWNER'),
    ('${UO2}','${T}',NULL,'Olivia','Solo','Olivia Solo','olivia@luxe.com','active','OWNER'),
    ('${UO3}','${T}',NULL,'Nina','Chain','Nina Chain','nina@luxe.com','active','OWNER'),
    ('${SA}',NULL,NULL,'Sam','Admin','Sam Admin','sam@platform.com','active','SUPER_ADMIN')`);
  await db.exec(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name, created_at) SELECT t.id, (SELECT b.id FROM branches b WHERE b.tenant_id = t.id ORDER BY b.created_at, b.id LIMIT 1), 'Walk', 'FixtureGuest', 'Walk FixtureGuest', now() - interval '400 days' FROM tenants t WHERE EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id) AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = t.id AND c.last_name = 'FixtureGuest')`);   // Oct 20 2026: tickets.customer_id is NOT NULL + FK (Oct 8) — every fixture ticket belongs to a real customer row (back-dated: never a "new client")
  const ticket = (b: string, total: number, tenant = T) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${tenant}','${b}',(SELECT id FROM customers WHERE tenant_id = '${tenant}' AND last_name = 'FixtureGuest' LIMIT 1),'paid',${total},0,0,${total},0,now())`);
  await ticket(B1, 10000); await ticket(B2, 5000); await ticket(B3, 3000); // B1 $100, B2 $50, B3 $30
  // Live snapshot at B1: 1 tech currently on (one off), 2 guests waiting in the lobby.
  const TECH1 = '00000000-0000-0000-0000-0000000abc01', TECH2 = '00000000-0000-0000-0000-0000000abc02';
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES
    ('${TECH1}','${T}','${B1}','Ava','Tran','Ava Tran'),('${TECH2}','${T}','${B1}','Bea','Lee','Bea Lee')`);
  await db.exec(`INSERT INTO technician_statuses (tenant_id, branch_id, technician_id, status) VALUES
    ('${T}','${B1}','${TECH1}','available'),('${T}','${B1}','${TECH2}','off_shift')`);
  await db.exec(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status) VALUES
    ('${T}','${B1}','Walk-in One','waiting'),('${T}','${B1}','Walk-in Two','waiting')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const sa = new SuperAdminOwnersService(k);
  const owner = (uid: string, selectedBranchId?: string): OwnerContext => ({ tenantId: T, userId: uid, role: 'OWNER', permissions: permissionsFor('OWNER') as string[], selectedBranchId });

  try {
    // ── Before assignment: Kevin (no rows yet) sees the whole tenant (legacy default) ──
    ok('owner with no access rows sees ALL 3 tenant branches (legacy fallback)', (await svc.getBranchList(owner(UO))).length === 3);

    // ── Super Admin assigns Kevin to B1 + B2 (NOT B3), primary = B1 ──
    await sa.assignBranch(SA, UO, { branchId: B1, accessLevel: 'owner', isPrimaryOwner: true });
    const afterAssign = await sa.assignBranch(SA, UO, { branchId: B2, accessLevel: 'owner' });
    ok('super-admin assigned 2 branches; detail lists exactly B1+B2', afterAssign.assignedBranches.length === 2 && afterAssign.assignedBranches.map((b) => b.branchId).sort().join() === [B1, B2].sort().join());
    ok('primary salon recorded on B1 only', afterAssign.assignedBranches.filter((b) => b.isPrimaryOwner).map((b) => b.branchId).join() === B1);

    // ── Owner context reflects only the assigned subset ──
    const ctxResp = await svc.getContext(owner(UO));
    ok('GET /owner/context returns exactly the 2 assigned salons', ctxResp.allowedBranches.length === 2 && ctxResp.canViewAllAssignedBranches === true, JSON.stringify(ctxResp.allowedBranches.map((b) => b.branchName)));
    ok('context default branch = primary (B1)', ctxResp.defaultBranchId === B1, String(ctxResp.defaultBranchId));
    const b1ctx = ctxResp.allowedBranches.find((b) => b.branchId === B1);
    ok('context salon carries address + city + state (not just city)', b1ctx?.address === '100 Haddonfield Rd' && b1ctx?.city === 'Cherry Hill' && b1ctx?.state === 'NJ', JSON.stringify({ a: b1ctx?.address, c: b1ctx?.city, s: b1ctx?.state }));

    // ── Selection events: single salon + "All My Salons" are recorded; an unassigned pick is rejected ──
    await svc.recordSelection(owner(UO), 'single', B2);
    await svc.recordSelection(owner(UO), 'all');
    await throws('selecting an unassigned salon is rejected (no spoofed event)', () => svc.recordSelection(owner(UO), 'single', B3), 'forbidden');
    // View activity (fired by the app on navigation, not on data refresh) — dashboard + reports; unassigned salon rejected.
    await svc.recordActivity(owner(UO), 'dashboard', B1);
    await svc.recordActivity(owner(UO), 'reports');
    await throws('viewing an unassigned salon dashboard is rejected', () => svc.recordActivity(owner(UO), 'dashboard', B3), 'forbidden');

    // ── Branch list + combined dashboard restricted to subset ──
    const list = await svc.getBranchList(owner(UO));
    ok('owner branch list now = 2 (assigned subset, Marlton hidden)', list.length === 2 && !list.some((b) => b.branchId === B3), list.map((b) => b.branchName).join());
    const dashAll = await svc.getDashboard(owner(UO));
    ok('combined "All My Salons" dashboard = B1+B2 only ($150, NOT $180)', dashAll.weeklyRevenueCents === 15000, String(dashAll.weeklyRevenueCents));
    const finAll = await svc.getFinanceSummary(owner(UO));
    ok('combined finance revenue = $150 (excludes unassigned Marlton $30)', finAll.totalRevenueCents === 15000, String(finAll.totalRevenueCents));
    const overview = await svc.getSalonsOverview(owner(UO));
    ok('salons overview lists only the 2 assigned salons with per-salon today revenue', overview.length === 2 && (overview.find((o) => o.branchId === B1)?.todayRevenueCents === 10000) && (overview.find((o) => o.branchId === B2)?.todayRevenueCents === 5000) && !overview.some((o) => o.branchId === B3), JSON.stringify(overview.map((o) => ({ n: o.salonName, r: o.todayRevenueCents }))));
    const ov1 = overview.find((o) => o.branchId === B1);
    ok('overview card carries live active-techs + waiting-guests (B1: 1 tech on, 2 waiting)', ov1?.activeTechs === 1 && ov1?.waitingGuests === 2, JSON.stringify({ techs: ov1?.activeTechs, waiting: ov1?.waitingGuests }));

    // ── Single-branch selection inside the subset works; outside is forbidden ──
    ok('owner can select assigned B2 → dashboard $50', (await svc.getDashboard(owner(UO, B2))).weeklyRevenueCents === 5000);
    await throws('owner selecting UNASSIGNED B3 on dashboard → forbidden', () => svc.getDashboard(owner(UO, B3)), 'forbidden');
    await throws('owner finance ?branchId=B3 (unassigned) → forbidden', () => svc.getFinanceSummary(owner(UO), 'month', B3), 'forbidden');
    await throws('owner branch detail B3 (unassigned) → forbidden', () => svc.getBranchDetail(owner(UO), B3), 'forbidden');
    const perf = await svc.getBranchPerformance(owner(UO));
    ok('branch performance aggregates the subset only ($150 across 2 branches)', perf.totalRevenueCents === 15000 && perf.branches.length === 2, JSON.stringify({ r: perf.totalRevenueCents, n: perf.branches.length }));

    // ── Primary exclusivity on re-assign ──
    await sa.updateBranch(SA, UO, B2, { isPrimaryOwner: true });
    const afterPrimary = await sa.getOwner(UO);
    ok('moving primary to B2 clears it from B1 (exactly one primary)', afterPrimary.assignedBranches.filter((b) => b.isPrimaryOwner).map((b) => b.branchId).join() === B2);

    // ── Cross-tenant assignment rejected ──
    await throws('super-admin assigning a branch from ANOTHER tenant → invalid', () => sa.assignBranch(SA, UO, { branchId: B9 }), undefined);

    // ── Remove access to B2 → only B1 remains, combined falls to $100 ──
    await sa.removeBranch(SA, UO, B2);
    ok('after removal owner sees only B1', (await svc.getBranchList(owner(UO))).map((b) => b.branchId).join() === B1);
    ok('combined dashboard now = B1 only ($100)', (await svc.getDashboard(owner(UO))).weeklyRevenueCents === 10000, String((await svc.getDashboard(owner(UO))).weeklyRevenueCents));
    await throws('owner now FORBIDDEN from B2 (access revoked)', () => svc.getDashboard(owner(UO, B2)), 'forbidden');

    // ── The other owner (no rows) is unaffected — still whole tenant ──
    ok('un-assigned owner still sees all 3 branches (no cross-contamination)', (await svc.getBranchList(owner(UO2))).length === 3);

    // ── Super Admin list shows assignment counts ──
    const owners = await sa.listOwners();
    const kev = owners.owners.find((o) => o.ownerId === UO);
    ok('super-admin owner list shows Kevin with 1 assigned branch', !!kev && kev.assignedBranchCount === 1, JSON.stringify(kev));

    // ── Create a brand-new salon and assign it in one step (the path that lets an owner grow) ──
    const afterCreate = await sa.createSalon(SA, UO, { name: 'Voorhees', city: 'Voorhees', accessLevel: 'owner' });
    ok('super-admin can CREATE a new salon under the owner and assign it', afterCreate.assignedBranches.some((b) => b.branchName === 'Voorhees'), afterCreate.assignedBranches.map((b) => b.branchName).join());
    ok('owner immediately sees the newly created salon', (await svc.getBranchList(owner(UO))).some((b) => b.branchName === 'Voorhees'));

    // ── "Unlimited salons": one owner can hold an arbitrarily large number of salons (no cap) ──
    const N = 12;
    for (let i = 1; i <= N; i++) await sa.createSalon(SA, UO3, { name: `Chain Salon ${i}`, city: 'Town', accessLevel: 'owner', isPrimaryOwner: i === 1 });
    const big = await sa.getOwner(UO3);
    ok(`owner can hold ${N} salons with no cap`, big.assignedBranches.length === N, String(big.assignedBranches.length));
    ok('owner branch list returns all created salons', (await svc.getBranchList(owner(UO3))).length === N, String((await svc.getBranchList(owner(UO3))).length));
    ok('combined "All My Salons" aggregates across all of them without error', typeof (await svc.getDashboard(owner(UO3))).weeklyRevenueCents === 'number');
    ok('exactly one primary salon remains among many', big.assignedBranches.filter((b) => b.isPrimaryOwner).length === 1, String(big.assignedBranches.filter((b) => b.isPrimaryOwner).length));

    // ── Audit trail written ──
    const audits = await k.selectFrom('owner_audit_log').select(['action']).where('tenant_id', '=', T).execute();
    const actions = audits.map((a) => a.action);
    ok('assignment + removal + context audited', actions.includes('super_admin_owner_branch_assigned') && actions.includes('super_admin_owner_branch_removed') && actions.includes('owner_context_loaded'), actions.join(','));
    ok('blocked branch access is audited (owner_unauthorized_branch_access_blocked)', actions.includes('owner_unauthorized_branch_access_blocked'), actions.join(','));
    ok('new-salon creation is audited (super_admin_owner_salon_created)', actions.includes('super_admin_owner_salon_created'), actions.join(','));
    ok('salon selection events are audited (owner_branch_selected + owner_all_salons_selected)', actions.includes('owner_branch_selected') && actions.includes('owner_all_salons_selected'), actions.filter((a) => a.includes('selected')).join(','));
    ok('per-view activity is audited (owner_dashboard_viewed + owner_reports_viewed)', actions.includes('owner_dashboard_viewed') && actions.includes('owner_reports_viewed'), actions.filter((a) => a.includes('viewed')).join(','));
    // Super-admin per-owner activity timeline: surfaces BOTH the super-admin actions on the owner and the owner's own actions.
    const timeline = await sa.getOwnerActivity(UO);
    const tActions = timeline.map((t) => t.action);
    ok('owner activity timeline includes super-admin actions taken on the owner', tActions.includes('super_admin_owner_branch_assigned') && timeline.some((t) => t.action === 'super_admin_owner_branch_assigned' && t.role === 'SUPER_ADMIN'), tActions.slice(0, 6).join(','));
    ok('owner activity timeline includes the owner\'s own actions (views/selections)', tActions.includes('owner_dashboard_viewed') || tActions.includes('owner_branch_selected'), tActions.slice(0, 6).join(','));
    ok('owner activity timeline is newest-first', timeline.length >= 2 && timeline.every((t, i) => i === 0 || timeline[i - 1].createdAt >= t.createdAt), String(timeline.length));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-multisalon: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
