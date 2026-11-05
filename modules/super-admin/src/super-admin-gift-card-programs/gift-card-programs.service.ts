// gift-card-programs.service.ts — super-admin gift-card program + membership management (spec §15). Validates the scope
// and status enums, composes the program list with members inline, and delegates persistence to the repo. Behind
// SuperAdminGuard at the controller. No money moves here — this only defines which tenants participate in which program.
import type { GiftCardProgramsRepo, ProgramRow, MemberRow, ProgramScope, ProgramStatus, MemberStatus } from './gift-card-programs.repository';

export class GiftCardProgramsError extends Error { constructor(msg: string) { super(msg); this.name = 'GiftCardProgramsError'; } }

const SCOPES: ProgramScope[] = ['tenant_only', 'owner_portfolio', 'network'];
const STATUSES: ProgramStatus[] = ['active', 'paused', 'archived'];
const MEMBER_STATUSES: MemberStatus[] = ['active', 'suspended', 'left'];

export interface ProgramWithMembers extends ProgramRow { members: MemberRow[]; memberCount: number }

export class GiftCardProgramsService {
  constructor(private readonly repo: GiftCardProgramsRepo) {}

  async getState(): Promise<{ programs: ProgramWithMembers[] }> {
    const [programs, members] = await Promise.all([this.repo.listPrograms(), this.repo.allMembers()]);
    const byProgram = new Map<string, MemberRow[]>();
    for (const m of members) { const arr = byProgram.get(m.programId) || []; arr.push(m); byProgram.set(m.programId, arr); }
    return {
      programs: programs.map((p) => {
        const ms = byProgram.get(p.id) || [];
        return { ...p, members: ms, memberCount: ms.filter((m) => m.status === 'active').length };
      }),
    };
  }

  async createProgram(body: { name?: string; ownerTenantId?: string; scope?: string; sharedLiability?: boolean }): Promise<ProgramRow> {
    const name = (body.name || '').trim();
    if (!name) throw new GiftCardProgramsError('A program name is required.');
    const ownerTenantId = (body.ownerTenantId || '').trim();
    if (!ownerTenantId) throw new GiftCardProgramsError('An owner tenant is required.');
    const scope = (body.scope || 'tenant_only') as ProgramScope;
    if (!SCOPES.includes(scope)) throw new GiftCardProgramsError('Invalid scope.');
    return this.repo.createProgram({ name, ownerTenantId, scope, sharedLiability: !!body.sharedLiability });
  }

  async updateProgram(id: string, body: { name?: string; scope?: string; status?: string; sharedLiability?: boolean }): Promise<ProgramRow> {
    const patch: { name?: string; scope?: ProgramScope; status?: ProgramStatus; sharedLiability?: boolean } = {};
    if (body.name !== undefined) { const n = String(body.name).trim(); if (!n) throw new GiftCardProgramsError('A program name is required.'); patch.name = n; }
    if (body.scope !== undefined) { if (!SCOPES.includes(body.scope as ProgramScope)) throw new GiftCardProgramsError('Invalid scope.'); patch.scope = body.scope as ProgramScope; }
    if (body.status !== undefined) { if (!STATUSES.includes(body.status as ProgramStatus)) throw new GiftCardProgramsError('Invalid status.'); patch.status = body.status as ProgramStatus; }
    if (body.sharedLiability !== undefined) patch.sharedLiability = !!body.sharedLiability;
    const updated = await this.repo.updateProgram(id, patch);
    if (!updated) throw new GiftCardProgramsError('Program not found.');
    return updated;
  }

  async addMember(programId: string, body: { tenantId?: string }): Promise<{ ok: boolean; reason?: string }> {
    const tenantId = (body.tenantId || '').trim();
    if (!tenantId) throw new GiftCardProgramsError('A tenant is required.');
    const program = await this.repo.getProgram(programId);
    if (!program) throw new GiftCardProgramsError('Program not found.');
    return this.repo.addMember(programId, tenantId);
  }

  async setMemberStatus(programId: string, tenantId: string, body: { status?: string }): Promise<{ ok: boolean }> {
    const status = body.status as MemberStatus;
    if (!MEMBER_STATUSES.includes(status)) throw new GiftCardProgramsError('Invalid member status.');
    const ok = await this.repo.setMemberStatus(programId, tenantId, status);
    if (!ok) throw new GiftCardProgramsError('Membership not found.');
    return { ok: true };
  }
}
