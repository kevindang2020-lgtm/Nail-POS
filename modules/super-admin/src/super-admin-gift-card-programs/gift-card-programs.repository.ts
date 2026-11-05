// gift-card-programs.repository.ts — data access for super-admin gift-card program + membership management (spec §15).
// Programs live in gift_card_programs; membership (which tenants opted in) in gift_card_program_members. Reused canonical
// tables — no duplicates. All writes go through the write DB handle.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { GIFT_CARD_PROGRAM, GIFT_CARD_PROGRAM_MEMBER } from '../lifecycles';

export type ProgramScope = 'tenant_only' | 'owner_portfolio' | 'network';
export type ProgramStatus = 'active' | 'paused' | 'archived';
export type MemberStatus = 'active' | 'suspended' | 'left';

export interface ProgramRow {
  id: string; name: string; ownerTenantId: string; scope: string; status: string; sharedLiability: boolean; createdAt: string;
}
export interface MemberRow { programId: string; tenantId: string; status: string; joinedAt: string }
export interface NewProgram { name: string; ownerTenantId: string; scope: ProgramScope; sharedLiability: boolean }

export interface GiftCardProgramsRepo {
  listPrograms(): Promise<ProgramRow[]>;
  allMembers(): Promise<MemberRow[]>;
  getProgram(id: string): Promise<ProgramRow | null>;
  createProgram(p: NewProgram): Promise<ProgramRow>;
  updateProgram(id: string, patch: { name?: string; scope?: ProgramScope; status?: ProgramStatus; sharedLiability?: boolean }): Promise<ProgramRow | null>;
  addMember(programId: string, tenantId: string): Promise<{ ok: boolean; reason?: string }>;
  setMemberStatus(programId: string, tenantId: string, status: MemberStatus): Promise<boolean>;
}

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const mapProgram = (r: any): ProgramRow => ({ id: r.id, name: r.name, ownerTenantId: r.owner_tenant_id, scope: r.scope, status: r.status, sharedLiability: !!r.shared_liability, createdAt: iso(r.created_at) });

export class KyselyGiftCardProgramsRepo implements GiftCardProgramsRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async listPrograms(): Promise<ProgramRow[]> {
    const rows = await this.db.selectFrom('gift_card_programs')
      .select(['id', 'name', 'owner_tenant_id', 'scope', 'status', 'shared_liability', 'created_at'])
      .orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    return (rows as any[]).map(mapProgram);
  }

  async allMembers(): Promise<MemberRow[]> {
    const rows = await this.db.selectFrom('gift_card_program_members')
      .select(['program_id', 'tenant_id', 'status', 'joined_at']).execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => ({ programId: r.program_id, tenantId: r.tenant_id, status: r.status, joinedAt: iso(r.joined_at) }));
  }

  async getProgram(id: string): Promise<ProgramRow | null> {
    const r = await this.db.selectFrom('gift_card_programs')
      .select(['id', 'name', 'owner_tenant_id', 'scope', 'status', 'shared_liability', 'created_at'])
      .where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return r ? mapProgram(r) : null;
  }

  async createProgram(p: NewProgram): Promise<ProgramRow> {
    const r: any = await this.db.insertInto('gift_card_programs')
      .values({ owner_tenant_id: p.ownerTenantId, name: p.name, scope: p.scope, shared_liability: p.sharedLiability, status: 'active' } as any)
      .returning(['id', 'name', 'owner_tenant_id', 'scope', 'status', 'shared_liability', 'created_at']).executeTakeFirstOrThrow();
    return mapProgram(r);
  }

  async updateProgram(id: string, patch: { name?: string; scope?: ProgramScope; status?: ProgramStatus; sharedLiability?: boolean }): Promise<ProgramRow | null> {
    const set: any = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.scope !== undefined) set.scope = patch.scope;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.sharedLiability !== undefined) set.shared_liability = patch.sharedLiability;
    let q: any = this.db.updateTable('gift_card_programs').set(set).where('id', '=', id);
    if (patch.status !== undefined) q = q.where(canMoveToSql(GIFT_CARD_PROGRAM, patch.status) as any);   // Phase 12 (#27)
    const r: any = await q
      .returning(['id', 'name', 'owner_tenant_id', 'scope', 'status', 'shared_liability', 'created_at']).executeTakeFirst().catch(() => undefined);
    return r ? mapProgram(r) : null;
  }

  async addMember(programId: string, tenantId: string): Promise<{ ok: boolean; reason?: string }> {
    // Idempotent: if the tenant is already a member, reactivate rather than error on the PK.
    const existing = await this.db.selectFrom('gift_card_program_members').select(['tenant_id'])
      .where('program_id', '=', programId).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (existing) { await this.db.updateTable('gift_card_program_members').set({ status: 'active' } as any).where('program_id', '=', programId).where('tenant_id', '=', tenantId).where(canMoveToSql(GIFT_CARD_PROGRAM_MEMBER, 'active') as any).execute(); return { ok: true, reason: 'already_member' }; }
    try { await this.db.insertInto('gift_card_program_members').values({ program_id: programId, tenant_id: tenantId, status: 'active' } as any).execute(); return { ok: true }; }
    catch { return { ok: false, reason: 'error' }; }
  }

  async setMemberStatus(programId: string, tenantId: string, status: MemberStatus): Promise<boolean> {
    const r: any = await this.db.updateTable('gift_card_program_members').set({ status } as any)
      .where('program_id', '=', programId).where('tenant_id', '=', tenantId).where(canMoveToSql(GIFT_CARD_PROGRAM_MEMBER, status) as any).executeTakeFirst().catch(() => undefined);
    return Number((r as any)?.numUpdatedRows ?? 0) > 0;
  }
}

export class InMemoryGiftCardProgramsRepo implements GiftCardProgramsRepo {
  private programs: ProgramRow[] = [];
  private members: MemberRow[] = [];
  private seq = 0;

  async listPrograms() { return this.programs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async allMembers() { return this.members.slice(); }
  async getProgram(id: string) { return this.programs.find((p) => p.id === id) || null; }
  async createProgram(p: NewProgram) {
    const row: ProgramRow = { id: 'gcp_' + (++this.seq), name: p.name, ownerTenantId: p.ownerTenantId, scope: p.scope, status: 'active', sharedLiability: p.sharedLiability, createdAt: new Date().toISOString() };
    this.programs.push(row); return row;
  }
  async updateProgram(id: string, patch: { name?: string; scope?: ProgramScope; status?: ProgramStatus; sharedLiability?: boolean }) {
    const p = this.programs.find((x) => x.id === id); if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.scope !== undefined) p.scope = patch.scope;
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.sharedLiability !== undefined) p.sharedLiability = patch.sharedLiability;
    return p;
  }
  async addMember(programId: string, tenantId: string) {
    const ex = this.members.find((m) => m.programId === programId && m.tenantId === tenantId);
    if (ex) { ex.status = 'active'; return { ok: true, reason: 'already_member' }; }
    this.members.push({ programId, tenantId, status: 'active', joinedAt: new Date().toISOString() }); return { ok: true };
  }
  async setMemberStatus(programId: string, tenantId: string, status: MemberStatus) {
    const m = this.members.find((x) => x.programId === programId && x.tenantId === tenantId); if (!m) return false; m.status = status; return true;
  }
}
