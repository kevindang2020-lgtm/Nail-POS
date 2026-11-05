// staff-roles.controller.ts — Functional Decision 12, step 4: the salon manages staff roles itself.
//   GET  /pos/staff-roles                         roles (10 defaults + the salon's own) and staff with their role   [roles.view]
//   POST /pos/staff-roles                         create a custom role (name, base role, scope, permission subset) [roles.manage]
//   POST /pos/staff-roles/:id/archive             archive a custom role                                             [roles.manage]
//   PUT  /pos/staff-roles/assignments/:userId     give a staff member a role (templateKey, or null to clear)        [roles.manage, step-up]
// BUILD_PLAN Phase 9: keyed by the dedicated roles.view / roles.manage keys (was pos.technicians.edit); the service decides by
// PERMISSIONS (ceiling = what the actor holds; owner-level needs ownership.transfer; LAST_OWNER → 409). Every assignment
// writes authorization_audit_events + AUTHORIZATION_CHANGED in its transaction, and the person's NEXT request is
// re-authorized (authorization version, bumped by the database trigger) — no more "at the next sign-in".
// The same operations live under /pos/access (modules/workforce team-permissions) for the Roles & Permissions screen.
import { Body, Controller, HttpException, HttpStatus, Inject, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DATABASE } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { clientIp } from '@aipowersalon/security';
import { StaffRolesService, KyselyStaffRolesStore, StaffRoleError, type StaffActor } from './staff-roles';
import { recordAuthorizationChange } from '../auth/authorization-audit';
import { AUTHORIZATION_STATE, type AuthorizationStateCache } from '../auth/authorization-state';

import { CREATE_STAFF_ROLE_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
const actorOf = (req: any): StaffActor => { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : undefined, ip: clientIp(req) ?? null }; };
export function staffRoleHttpError(e: StaffRoleError): HttpException {
  if (e.code === 'CONFLICT') return new HttpException({ code: e.reason ?? 'CONFLICT', message: e.message }, HttpStatus.CONFLICT);
  return new HttpException(e.message, e.code === 'FORBIDDEN' ? HttpStatus.FORBIDDEN : e.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof StaffRoleError) throw staffRoleHttpError(e);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/staff-roles')
export class StaffRolesController {
  private readonly svc: StaffRolesService;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() @Inject(OutboxWriter) outbox?: OutboxWriter | null,
              @Optional() @Inject(AUTHORIZATION_STATE) private readonly authz?: AuthorizationStateCache | null) {
    this.svc = new StaffRolesService(new KyselyStaffRolesStore(db, (trx, change) => recordAuthorizationChange(trx, outbox ?? null, change)), {
      record: (e) => {
        if (!this.db) return;
        void sql`insert into audit_events (id, tenant_id, occurred_at, actor_user_id, module, action, resource_type, resource_id, summary, status, severity, metadata, created_at)
          values (gen_random_uuid(), ${e.tenantId}, now(), ${/^[0-9a-f-]{36}$/i.test(e.userId) ? e.userId : null}, 'staff_roles', ${e.action}, 'staff_role', ${e.entityId ?? null},
                  ${e.action.replace(/_/g, ' ')}, 'success', 'info', ${JSON.stringify(e.metadata ?? {})}::jsonb, now())`.execute(this.db).catch(() => undefined);
      },
    });
  }

  // BUILD_PLAN Phase 9: reading the roster and assigning a role moved to /pos/access (GET roles / members, PUT
  // members/:userId/role — with a reason, step-up, last-owner protection and the authorization audit). The old GET '' and
  // PUT assignments/:userId here were retired so there is ONE way to change someone's role.

  @Post('') @RequirePermission('roles.manage')
  createRole(@Req() r: any, @Body(ValidatedBody(CREATE_STAFF_ROLE_BODY)) b: any) {
    return run(async () => { const a = actorOf(r); const v = await this.svc.createCustomRole(a, { name: b?.name, baseRole: b?.baseRole, scope: b?.scope, permissions: Array.isArray(b?.permissions) ? b.permissions : [] }); this.authz?.invalidateTenant(a.tenantId); return v; });
  }

  @Post(':id/archive') @RequirePermission('roles.manage')
  archiveRole(@Req() r: any, @Param('id') id: string) {
    return run(async () => { const a = actorOf(r); await this.svc.archiveCustomRole(a, id); this.authz?.invalidateTenant(a.tenantId); return { ok: true }; });
  }

}
