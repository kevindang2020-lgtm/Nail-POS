// pos-search.controller.ts — the ONE tenant POS global-search endpoint. Tenant + branch + role come from
// the authenticated session (req.ctx); the client NEVER supplies tenantId/branchId. `locationScope=all`
// is honored only for OWNER/MANAGER (enforced in the service). Separate from any Super Admin search.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PosSearchService } from './pos-search.service';
import { ListQueries } from '@aipowersalon/database';
import { PosSearchControllerListQueries } from './pos-search.list-queries';
import { SEARCH_OPEN_BODY } from './request-schemas';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

function tcFrom(req: any) {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PosSearchControllerListQueries)
@Controller('pos/search')
export class PosSearchController {
  constructor(private readonly svc: PosSearchService) {}

  @Get('') @RequirePermission('global_search.use')
  async search(@Req() req: any, @Query() q: any) {
    const tc = tcFrom(req);
    const allLocations = String(q?.locationScope || '').toLowerCase() === 'all' || String(q?.allLocations || '') === 'true';
    try {
      const out = await this.svc.search(tc, q?.q, q?.limit ? Number(q.limit) : undefined, { allLocations });
      const counts: Record<string, number> = {};
      for (const k of Object.keys(out.results)) counts[k] = (out.results as any)[k].length;
      return { ok: true, query: out.query, scope: out.scope, groups: out.results, counts, totalCount: out.totalCount, requestId: randomUUID() };
    } catch (e: any) {
      if (e?.message === 'forbidden_pos_search') throw withCode(new HttpException({ ok: false, message: 'You do not have permission to search.' }, 403), 'PERMISSION_DENIED');
      throw e;
    }
  }

  // Audit only when a sensitive result is OPENED (not per keystroke) — §15.
  @Post('open') @RequirePermission('global_search.use')
  async open(@Req() req: any, @Body(ValidatedBody(SEARCH_OPEN_BODY, { strict: true })) b: any) {
    await this.svc.recordOpen(tcFrom(req), String(b?.resultType || ''), String(b?.entityId || ''), String(b?.q || ''));
    return { ok: true };
  }
}
