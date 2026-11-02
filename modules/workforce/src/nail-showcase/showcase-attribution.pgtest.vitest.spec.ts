// showcase-attribution.pgtest.vitest.spec.ts — manual NailShowcase posts (Technician Profile merge; mandate §45–§46).
// Adapted to our migratedPglite harness; the magic-byte upload checks are acceptUpload's here (packages/media) — not re-tested.
//
// A customer used to be able to file a manual post under ANY salon and credit ANY technician, auto-published. Now:
// salon/branch are server-derived; a technician is credited only when THIS customer had a PAID ticket at THIS salon
// served by that technician; otherwise the post is stored unattributed; manual posts default to pending review
// (a salon may relax that through nail_showcase_tenant_policy); photo URLs must be this customer's own platform media.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyNailShowcaseRepository } from './nail-showcase.kysely.repository';
import { NailShowcaseService, NailShowcaseError } from './nail-showcase.service';
import { nsIsOwnPlatformMediaUrl } from './nail-showcase.dto';

const uuid = (p: string, n: string | number) => `${p}${'0'.repeat(8 - p.length)}-0000-4000-8000-${String(n).replace(/[^0-9a-f]/g, '').padStart(12, '0')}`;

const P = 'ab';
const TA = uuid(P, 1), TB = uuid(P, 2);
const BA = uuid(P, 'b1'), BB = uuid(P, 'b2');
const USER = uuid(P, 'f1');
const CUST_A = uuid(P, 'c1');
const T_SERVED = uuid(P, 'd1'), T_NEVER = uuid(P, 'd2'), T_B = uuid(P, 'd3');
const SVC = uuid(P, 'e1'), SVC_OTHER = uuid(P, 'e2');
const CAT = uuid(P, 'ca');
const TICKET = uuid(P, 'a1'), TICKET_UNPAID = uuid(P, 'a2');
const ctx: any = { tenantId: TA, branchId: BA, userId: USER, role: 'CUSTOMER', permissions: [] };
const photo = (post: string) => ({ imageUrl: `/media/tenants/${TA}/nail-showcase/${BA}/${USER}/${post}/1.jpg` });   // OUR uploadObjectKey layout

let pg: any;
const h = { q: (sql: string, p: any[] = []) => pg.query(sql, p).then((r: any) => r.rows) };
let svc: NailShowcaseService;

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new NailShowcaseService(new KyselyNailShowcaseRepository(kyselyFor(pg) as any));
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','ab-a','ABA'),($2,'B','Salon B','ab-b','ABB')`, [TA, TB]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'A-Main','active'),($3,$4,'B-Main','active')`, [BA, TA, BB, TB]);
  await h.q(`insert into users (id, tenant_id, branch_id, full_name, first_name, last_name, email, status, role, mfa_enabled, must_change_password) values ($1,$2,$3,'Ann Adams','Ann','Adams','ann@ab.test','active','CUSTOMER',false,false)`, [USER, TA, BA]);
  await h.q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,$4,'Ann','Adams','Ann Adams','+18565550101')`, [CUST_A, TA, BA, USER]);
  await h.q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$4,$5,'Served','T','Served T',true),($2,$4,$5,'Never','T','Never T',true),($3,$6,$7,'Other','Salon','Other Salon',true)`, [T_SERVED, T_NEVER, T_B, TA, BA, TB, BB]);
  await h.q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, TA, BA]);
  await h.q(`insert into services (id, tenant_id, branch_id, category_id, name, status, price_cents, duration_minutes) values ($1,$3,$4,$5,'Gel','active',5000,45),($2,$3,$4,$5,'Pedi','active',6000,60)`, [SVC, SVC_OTHER, TA, BA, CAT]);
  // one PAID ticket served by T_SERVED for SVC; one UNPAID ticket "served" by T_NEVER (not evidence of anything)
  await h.q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, paid_at) values ($1,$2,$3,$4,'paid','A1',5000,5000,now())`, [TICKET, TA, BA, CUST_A]);
  await h.q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'Gel',5000,45,5000)`, [TA, BA, TICKET, SVC, T_SERVED]);
  await h.q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents) values ($1,$2,$3,$4,'open','A2',5000,5000)`, [TICKET_UNPAID, TA, BA, CUST_A]);
  await h.q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'Gel',5000,45,5000)`, [TA, BA, TICKET_UNPAID, SVC, T_NEVER]);
}, 240000);   // migratedPglite replays every migration — slow under a loaded machine

describe('manual post attribution', () => {
  it('credits a technician ONLY when the customer had a paid ticket served by them at this salon', async () => {
    const ok = await svc.createManualPost(ctx, { caption: 'love it', technicianId: T_SERVED, serviceId: SVC });
    expect(ok.technicianId).toBe(T_SERVED);
    expect(ok.serviceId).toBe(SVC);
    expect(ok.technicianName).toBe('Served T');
  });
  it('a technician who never served this customer (or only on an unpaid ticket) is NOT credited — the post is stored unattributed, not refused', async () => {
    const r = await svc.createManualPost(ctx, { caption: 'fake credit', technicianId: T_NEVER, serviceId: SVC });
    expect(r.technicianId).toBeNull();
    expect(r.serviceId).toBeNull();
    expect(r.technicianName).toBeNull();
    expect(r.isVerifiedService).toBe(false);
  });
  it('a served technician with a service they did NOT perform for this customer is also unattributed', async () => {
    const r = await svc.createManualPost(ctx, { caption: 'wrong service', technicianId: T_SERVED, serviceId: SVC_OTHER });
    expect(r.technicianId).toBeNull();
    expect(r.serviceId).toBeNull();
  });
  it('the client cannot file the post under another salon: salonTenantId / branchId are ignored, the session decides', async () => {
    const r = await svc.createManualPost(ctx, { caption: 'elsewhere', salonTenantId: TB, branchId: BB, technicianId: T_B });
    expect(r.salonTenantId).toBe(TA);
    expect(r.branchId).toBe(BA);
    expect(r.technicianId).toBeNull();
    expect(r.salonName).toBe('Salon A');
  });
});

describe('manual post approval default', () => {
  it('a manual post is PENDING REVIEW by default — never live on arrival', async () => {
    const r = await svc.createManualPost(ctx, { caption: 'pending' });
    expect(r.status).toBe('pending_review');
    expect(r.postType).toBe('manual_upload');
  });
  it('a salon may relax that for ITS feed (nail_showcase_tenant_policy.auto_publish_manual)', async () => {
    await h.q(`insert into nail_showcase_tenant_policy (tenant_id, auto_publish_manual) values ($1, true)`, [TA]);
    const r = await svc.createManualPost(ctx, { caption: 'relaxed' });
    expect(r.status).toBe('published');
    await h.q(`delete from nail_showcase_tenant_policy where tenant_id = $1`, [TA]);
    const again = await svc.createManualPost(ctx, { caption: 'strict again' });
    expect(again.status).toBe('pending_review');
  });
});

describe('photo sources', () => {
  it('only the customer\'s OWN platform media is accepted as a photo; external URLs and other users\' keys are refused', async () => {
    await expect(svc.createManualPost(ctx, { caption: 'x', photos: [{ imageUrl: 'https://evil.example/track.gif' }] })).rejects.toBeInstanceOf(NailShowcaseError);
    await expect(svc.createManualPost(ctx, { caption: 'x', photos: [{ imageUrl: `/media/tenants/${TA}/branches/${BA}/customers/${uuid(P, 'f9')}/nail-showcase/p/1.jpg` }] })).rejects.toBeInstanceOf(NailShowcaseError);
    await expect(svc.createManualPost(ctx, { caption: 'x', photos: [{ imageUrl: `/media/tech-profiles/${uuid(P, 'a9')}/portfolio/private.jpg` }] })).rejects.toBeInstanceOf(NailShowcaseError);
    const ok = await svc.createManualPost(ctx, { caption: 'mine', photos: [photo('p1')] });
    expect(ok.photos).toHaveLength(1);
  });
  it('nsIsOwnPlatformMediaUrl (pure): CDN / bucket URLs under the configured base pass only inside the customer\'s namespace', () => {
    const env: any = { MEDIA_CDN_BASE_URL: 'https://cdn.example.com' };
    expect(nsIsOwnPlatformMediaUrl(`https://cdn.example.com/tenants/t/customers/${USER}/nail-showcase/p/1.jpg`, USER, env)).toBe(true);
    expect(nsIsOwnPlatformMediaUrl(`https://cdn.example.com/tenants/t/customers/someone-else/nail-showcase/p/1.jpg`, USER, env)).toBe(false);
    expect(nsIsOwnPlatformMediaUrl(`https://cdn.example.com.evil.net/tenants/t/customers/${USER}/x.jpg`, USER, env)).toBe(false);
    expect(nsIsOwnPlatformMediaUrl(`/media/../customers/${USER}/x.jpg`, USER, env)).toBe(false);
    expect(nsIsOwnPlatformMediaUrl('javascript:alert(1)', USER, env)).toBe(false);
    expect(nsIsOwnPlatformMediaUrl(`/media/tenants/t/nail-showcase/b/${USER}/p/1.jpg`, USER, env)).toBe(true);   // our layout
    expect(nsIsOwnPlatformMediaUrl(`/media/tenants/t/nail-showcase/b/${uuid(P, 'f9')}/p/1.jpg`, USER, env)).toBe(false);
  });
});
