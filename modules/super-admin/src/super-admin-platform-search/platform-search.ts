// platform-search.ts — Constitution 7 §140, §141, §192, §271, §272: one Super Admin search box, and results that obey the
// caller's platform permissions. There is no "search everything" (§141): each result group runs only when the signed
// session holds that group's permission — a group the caller cannot see is not queried at all, not filtered afterwards.
// Customer search is deliberately ABSENT (§192/§272): identity lookup across salons needs Support Mode and a reason.
import { Controller, Get, Inject, Injectable, Optional, Query, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';

import type { PlatformSearchHit, PlatformSearchKind, PlatformSearchResult } from '@aipowersalon/api-contracts/platform';
import { PlatformSearchControllerListQueries } from './platform-search.list-queries';
export type { PlatformSearchHit, PlatformSearchKind, PlatformSearchResult } from '@aipowersalon/api-contracts/platform';

/** Which permission each group needs (§141: results obey platform permissions). */
export const SEARCH_GROUP_PERMISSION: Readonly<Record<PlatformSearchKind, string>> = {
  tenant: 'super_admin.tenants.view', branch: 'super_admin.tenants.view', platform_user: 'super_admin.users.view', support_ticket: 'super_admin.support.view',
};
const PER_GROUP = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** LIKE pattern with the user's % and _ escaped — a search for "50%" must not match everything. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

@Injectable()
export class PlatformSearchService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async search(qRaw: string, permissions: readonly string[]): Promise<PlatformSearchResult> {
    const q = String(qRaw ?? '').trim().slice(0, 100);
    const kinds = Object.keys(SEARCH_GROUP_PERMISSION) as PlatformSearchKind[];
    const allowed = kinds.filter((k) => permissions.includes(SEARCH_GROUP_PERMISSION[k]));
    const hidden = kinds.filter((k) => !allowed.includes(k));
    if (q.length < 2 || !this.db) return { q, groups: [], hidden };
    const like = likePattern(q); const isId = UUID.test(q);
    const groups: PlatformSearchResult['groups'] = [];
    for (const kind of allowed) {
      let rows: any[] = [];
      if (kind === 'tenant') rows = (await sql<any>`select id, display_name as title, tenant_code as subtitle, id as tenant_id from tenants
          where ${isId ? sql`id = ${q}::uuid` : sql`display_name ilike ${like} escape '\\' or tenant_slug ilike ${like} escape '\\' or tenant_code ilike ${like} escape '\\'`}
          order by display_name limit ${PER_GROUP}`.execute(this.db)).rows;
      if (kind === 'branch') rows = (await sql<any>`select b.id, b.name as title, t.display_name as subtitle, b.tenant_id from branches b join tenants t on t.id = b.tenant_id
          where ${isId ? sql`b.id = ${q}::uuid` : sql`b.name ilike ${like} escape '\\'`} order by b.name limit ${PER_GROUP}`.execute(this.db)).rows;
      if (kind === 'platform_user') rows = (await sql<any>`select id, coalesce(full_name, email) as title, email as subtitle, null as tenant_id from users
          where role = 'SUPER_ADMIN' and ${isId ? sql`id = ${q}::uuid` : sql`(email ilike ${like} escape '\\' or full_name ilike ${like} escape '\\')`} order by email limit ${PER_GROUP}`.execute(this.db)).rows;
      if (kind === 'support_ticket') rows = (await sql<any>`select s.id, coalesce(s.ticket_number, '') || ' ' || s.subject as title, t.display_name as subtitle, s.tenant_id
          from support_tickets s left join tenants t on t.id = s.tenant_id
          where ${isId ? sql`s.id = ${q}::uuid` : sql`(s.ticket_number ilike ${like} escape '\\' or s.subject ilike ${like} escape '\\')`} order by s.created_at desc limit ${PER_GROUP}`.execute(this.db)).rows;
      if (rows.length) groups.push({ kind, hits: rows.map((r) => ({ kind, id: String(r.id), title: String(r.title ?? '').trim(), subtitle: r.subtitle ?? null, tenantId: r.tenant_id ? String(r.tenant_id) : null })) });
    }
    return { q, groups, hidden };
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(PlatformSearchControllerListQueries)
@Controller('super-admin/platform-search')
export class PlatformSearchController {
  constructor(private readonly svc: PlatformSearchService) {}
  // No explicit key: the derived domain key (tenants.view) lets every platform role reach it; each GROUP then checks
  // its own permission from the signed session (§141).
  @Get() search(@Query('q') q: string, @Req() req: any) {
    return this.svc.search(q, Array.isArray(req?.ctx?.permissions) ? req.ctx.permissions : []);
  }
}

import { Module } from '@nestjs/common';
@Module({ controllers: [PlatformSearchController], providers: [PlatformSearchService] })
export class SuperAdminPlatformSearchModule {}
