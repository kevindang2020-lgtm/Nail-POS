// integration-lifecycle.controller.ts — SuperAdminGuard-only Add-Integration / Configure-Credentials / OAuth /
// Refresh / Test / Disable endpoints. Structured error codes; no secret or token is ever included in a response.

import { Body, Controller, Get, HttpException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { IntegrationLifecycleService } from './integration-lifecycle.service';
import { ListQueries } from '@aipowersalon/database';
import { IntegrationLifecycleControllerListQueries } from './integration-lifecycle.list-queries';
import { INT_API_KEY_BODY, INT_CREATE_CONNECTION_BODY, INT_OAUTH_BEGIN_BODY, INT_OAUTH_COMPLETE_BODY, INT_REASON_BODY, INT_ROTATE_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const ERR: Record<string, [number, string]> = {
  unavailable: [503, 'Integrations store is not available.'], unsupported_provider: [400, 'That provider is not approved.'],
  invalid_ownership: [400, 'Invalid ownership type.'], duplicate_connection: [409, 'A live connection already exists for this provider and scope.'],
  not_found: [404, 'Connection not found.'], oauth_not_supported: [400, 'This provider does not support OAuth.'],
  invalid_redirect_uri: [400, 'Redirect URI is not on the provider allowlist.'], invalid_scope: [400, 'Requested scopes are not permitted for this provider.'],
  missing_state_or_code: [400, 'State and code are required.'], invalid_state: [409, 'Authorization state is invalid, expired, or already used.'],
  authorization_failed: [400, 'Authorization failed.'], not_refreshable: [400, 'This credential cannot be refreshed.'],
  refresh_in_progress: [409, 'A refresh is already in progress for this connection.'], reauthorization_required: [409, 'Refresh token rejected — reauthorization required.'],
  api_key_not_supported: [400, 'This provider does not use an API key.'], reason_required: [400, 'A reason is required.'], secret_required: [400, 'A new secret is required.'],
};
const guard = <T extends { ok: boolean; error?: string; status?: number }>(res: T): T => { if (!res.ok) { const [s, m] = ERR[res.error ?? ''] ?? [res.status ?? 400, 'Request failed.']; throw new HttpException({ code: res.error, message: m, ...(('existingId' in (res as any)) ? { existingId: (res as any).existingId } : {}) }, s); } return res; };
const actorFrom = (r: any) => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });

@ListQueries(IntegrationLifecycleControllerListQueries)
@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class IntegrationLifecycleController {
  constructor(private readonly svc: IntegrationLifecycleService) {}

  @Get('providers') providers() { return { available: true, providers: IntegrationLifecycleService.approvedProviders() }; }

  @RequireIntegrationPermission(P.view)
  @Get('connections')
  async list(@Req() r: any, @Query() q: any) { return this.svc.listConnections(actorFrom(r), { providerKey: q?.providerKey, status: q?.status, tenantId: q?.tenantId }); }

  @RequireIntegrationPermission(P.create)
  @Post('connections')
  async create(@Req() r: any, @Body(ValidatedBody(INT_CREATE_CONNECTION_BODY, { strict: true })) b: any) { return guard(await this.svc.createConnection(actorFrom(r), { providerKey: b?.providerKey, ownershipType: b?.ownershipType, tenantId: b?.tenantId, branchId: b?.branchId, authMethod: b?.authMethod })); }

  @RequireIntegrationPermission(P.edit)
  @Post('connections/:id/oauth/begin')
  async oauthBegin(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_OAUTH_BEGIN_BODY, { strict: true })) b: any) { return guard(await this.svc.beginOAuth(actorFrom(r), id, { redirectUri: b?.redirectUri, scopes: b?.scopes })); }

  @RequireIntegrationPermission(P.edit)
  @Post('connections/:id/oauth/complete')
  async oauthComplete(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_OAUTH_COMPLETE_BODY, { strict: true })) b: any) { return guard(await this.svc.completeOAuth(actorFrom(r), id, { state: b?.state, code: b?.code })); }

  @RequireIntegrationPermission(P.authRefresh)
  @Post('connections/:id/auth/refresh')
  async refresh(@Req() r: any, @Param('id') id: string) { return guard(await this.svc.refreshAuthentication(actorFrom(r), id)); }

  @RequireIntegrationPermission(P.credentialsManage)
  @RequireStepUp()   // Security Deep Scan C7: setting / rotating an integration credential
  @Post('connections/:id/credentials')
  async credentials(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_API_KEY_BODY, { strict: true })) b: any) { return guard(await this.svc.configureApiKey(actorFrom(r), id, { apiKey: b?.apiKey })); }

  @RequireIntegrationPermission(P.credentialsRotate)
  @RequireStepUp()
  @Post('connections/:id/credentials/rotate')
  async rotate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_ROTATE_BODY, { strict: true })) b: any) { return guard(await this.svc.rotateCredential(actorFrom(r), id, { kind: b?.kind, newSecret: b?.newSecret, reason: b?.reason })); }

  @RequireIntegrationPermission(P.credentialsView)
  @Get('connections/:id/credentials')
  async credentialSummary(@Req() r: any, @Param('id') id: string) { return guard(await this.svc.credentialSummary(actorFrom(r), id)); }

  @RequireIntegrationPermission(P.connectionTest)
  @Post('connections/:id/test')
  async test(@Req() r: any, @Param('id') id: string) { return guard(await this.svc.testConnection(actorFrom(r), id)); }

  @RequireIntegrationPermission(P.disable)
  @Post('connections/:id/lifecycle-disable')
  async disable(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_REASON_BODY, { strict: true })) b: any) { return guard(await this.svc.disableConnection(actorFrom(r), id, b?.reason)); }
}
