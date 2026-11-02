// skill-review.pgtest.vitest.spec.ts — Functional Decision 7 through the REAL repository on Postgres (PGlite):
// submitted -> under review -> more information required (note shown to the technician) -> technician resubmits ->
// approved, and only approval makes the technician eligible (technician_services). Moves the decision does not allow
// are refused inside the transaction, and nothing changes.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTechRepository } from './tech.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const TECH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SVC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MGR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const techCtx = { tenantId: T, branchId: B, userId: 'u-tech', role: 'TECHNICIAN', permissions: [] } as any;
const mgrCtx = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['technicians.edit'] } as any;

let repo: KyselyTechRepository; let pg: PGlite;
const eligible = async () => Number((await pg.query<any>(`select count(*)::int n from technician_services where technician_id = $1 and service_id = $2`, [TECH, SVC])).rows[0].n);
const row = async (id: string) => (await pg.query<any>(`select status, review_notes, decided_by_user_id, decided_at, review_started_by_user_id, more_info_requested_at from technician_skill_change_requests where id = $1`, [id])).rows[0];

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`CREATE TABLE services (id uuid primary key, tenant_id uuid not null, branch_id uuid, name text not null, status text not null default 'active', category_id uuid)`);
  await pg.exec(`CREATE TABLE technicians (id uuid primary key, tenant_id uuid not null, branch_id uuid, full_name text, user_id uuid, service_eligibility_mode text not null default 'exact')   -- 631 (+ 380 user_id: the self-approval guard)`);
  // Re-pinned Oct 12 2026 (merge): the mini schema now carries migration 583's columns — the unique eligibility index the ONE
  // writer relies on (INSERT … ON CONFLICT), proficiency / evidence on technician_services, and the review bookkeeping.
  await pg.exec(`CREATE TABLE technician_services (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, technician_id uuid not null, service_id uuid not null, is_primary boolean not null default false,
    proficiency text, certificate_document_key text, granted_by_user_id uuid, granted_via text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
  await pg.exec(`CREATE UNIQUE INDEX uq_technician_services_tenant_tech_service ON technician_services (tenant_id, technician_id, service_id)`);
  await pg.exec(`CREATE TABLE user_branch_access (tenant_id uuid not null, branch_id uuid not null, user_id uuid not null, role text, access_level text)`);
  await pg.exec(`CREATE TABLE technician_skill_change_requests (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
    technician_id uuid not null, service_id uuid not null, request_type text not null, note text,
    status text not null CHECK (status IN ('draft','submitted','pending','under_review','more_information_required','approved','rejected')),
    decided_by_user_id uuid, decided_at timestamptz, created_at timestamptz not null default now(), proficiency_level text, experience_years int,
    supporting_photos jsonb default '[]'::jsonb, certificate_evidence text, review_notes text, submitted_at timestamptz,
    review_started_at timestamptz, review_started_by_user_id uuid, more_info_requested_at timestamptz, updated_at timestamptz not null default now())`);
  await pg.query(`INSERT INTO services (id, tenant_id, name) VALUES ($1, $2, 'Gel-X Extensions')`, [SVC, T]);
  await pg.query(`INSERT INTO technicians (id, tenant_id, branch_id, full_name) VALUES ($1, $2, $3, 'Mia Tran')`, [TECH, T, B]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyTechRepository(db as any);
});

describe('skill request review on real tables (Decision 7)', () => {
  it('walks submitted -> under review -> more info -> resubmitted -> approved; eligibility appears only at approval', async () => {
    const req = await repo.createSkillChangeRequest(techCtx, TECH, { serviceId: SVC, proficiencyLevel: 'intermediate', experienceYears: 2 });
    expect(req.status).toBe('submitted');

    await repo.decideSkillChangeRequest(mgrCtx, req.id, 'under_review', MGR, null);
    // review steps are bookkept on their own columns (583); decided_by/decided_at are stamped only by a terminal decision
    expect(await row(req.id)).toMatchObject({ status: 'under_review', review_started_by_user_id: MGR, decided_by_user_id: null, decided_at: null });
    expect(await eligible()).toBe(0);

    await repo.decideSkillChangeRequest(mgrCtx, req.id, 'more_information_required', MGR, 'Add a photo of a finished set.');
    const mine = (await repo.listSkillChangeRequests(techCtx, TECH)).find((r) => r.id === req.id)!;
    expect(mine).toMatchObject({ status: 'more_information_required', reviewNotes: 'Add a photo of a finished set.' });   // the technician sees what to add
    expect(await eligible()).toBe(0);

    const resubmitted = await repo.updateSkillChangeRequest(techCtx, req.id, TECH, { serviceId: SVC, supportingPhotos: ['https://img/set.jpg'] });
    expect(resubmitted.status).toBe('submitted');

    const approved = await repo.decideSkillChangeRequest(mgrCtx, req.id, 'approved', MGR, null);
    expect(approved.status).toBe('approved');
    expect((await row(req.id)).decided_at).not.toBeNull();
    expect(await eligible()).toBe(1);
  });

  it('refuses moves the workflow does not allow, and changes nothing', async () => {
    await pg.query(`DELETE FROM technician_services`);
    const draft = await repo.createSkillChangeRequest(techCtx, TECH, { serviceId: SVC, status: 'draft', requestType: 'remove' });
    await expect(repo.decideSkillChangeRequest(mgrCtx, draft.id, 'approved', MGR, null)).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await row(draft.id)).status).toBe('draft');

    await pg.query(`UPDATE technician_skill_change_requests SET status = 'under_review' WHERE id = $1`, [draft.id]);
    await expect(repo.decideSkillChangeRequest(mgrCtx, draft.id, 'under_review', MGR, null)).rejects.toMatchObject({ code: 'invalid_state' });

    await pg.query(`UPDATE technician_skill_change_requests SET status = 'more_information_required', review_notes = 'x' WHERE id = $1`, [draft.id]);
    await expect(repo.decideSkillChangeRequest(mgrCtx, draft.id, 'under_review', MGR, null)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await row(draft.id)).toMatchObject({ status: 'more_information_required', review_notes: 'x' });

    await repo.decideSkillChangeRequest(mgrCtx, draft.id, 'rejected', MGR, 'Not offered at this branch.');
    await expect(repo.decideSkillChangeRequest(mgrCtx, draft.id, 'approved', MGR, null)).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await row(draft.id)).status).toBe('rejected');
  });
});
