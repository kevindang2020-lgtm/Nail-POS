// event-ops.controller.ts — Constitution 8 Phase 15: Super Admin event operations (§150–155).
import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Post, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { EventOpsService } from './event-ops.service';
import { EventReplayService, type ReplayRequest } from './event-replay.service';
import { EP, checkEventPermission } from './event-ops-permissions';
import { ListQueries } from '@aipowersalon/database';
import { EventOpsControllerListQueries } from './event-ops.list-queries';
import { DEAD_LETTER_DISCARD_BODY, REPLAY_PREVIEW_BODY, REPLAY_RUN_BODY } from './request-schemas';

const EVENT_PERM = 'event_perm';
const RequireEventPermission = (key: string) => SetMetadata(EVENT_PERM, key);

@Injectable()
export class EventPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const key = this.reflector.get<string>(EVENT_PERM, ctx.getHandler());
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!checkEventPermission(req?.ctx, key)) throw new ForbiddenException('Missing permission: ' + key);
    return true;
  }
}

@ListQueries(EventOpsControllerListQueries)
@Controller('super-admin/events')
@UseGuards(SuperAdminGuard, EventPermissionGuard)
export class EventOpsController {
  // Explicit token: a `T | null` union erases to Object in emitted metadata and Nest cannot resolve it (the
  // check:boot class of bug — a bare class ctor with a non-class param fails DI at instantiation, not compile).
  constructor(@Inject(EventOpsService) private readonly ops: EventOpsService | null,
              @Inject(EventReplayService) private readonly replay: EventReplayService | null) {}
  private need() { if (!this.ops) throw new ForbiddenException('Event operations unavailable (no database)'); return this.ops; }
  private needReplay() { if (!this.replay) throw new ForbiddenException('Event replay unavailable (no database)'); return this.replay; }

  /** §149 outbox health · §148 consumer health · §147 lag */
  @RequireEventPermission(EP.view) @Get('health')
  health() { return this.need().health(); }

  /** §151 search by correlation / id / type / tenant */
  @RequireEventPermission(EP.view) @Get('search')
  search(@Query() q: any) { return this.need().search({ correlationId: q.correlationId, eventId: q.eventId, eventType: q.eventType, tenantId: q.tenantId, limit: q.limit ? Number(q.limit) : undefined }); }

  @RequireEventPermission(EP.view) @Get('dead-letters')
  deadLetters(@Query() q: any) { return this.need().listDeadLetters({ status: q.status, consumerName: q.consumer, tenantId: q.tenantId, limit: q.limit ? Number(q.limit) : undefined }); }

  /** §153 retry one consumer's failure — never edits the payload (§225) */
  @RequireEventPermission(EP.retry) @Post('dead-letters/:id/retry')
  retry(@Param('id') id: string, @Req() req: any) { return this.need().retryDeadLetter(id, String(req?.ctx?.userId ?? 'super_admin')); }

  /** §44: what each consumer says would happen if its history were replayed — read this before replaying */
  @RequireEventPermission(EP.view) @Get('replay/consumers')
  replayClasses() { return this.need().replayClasses(); }

  /** §45 PREVIEW — changes nothing; returns the confirmation token run() requires */
  @RequireEventPermission(EP.replay) @Post('replay/preview')
  replayPreview(@Body(ValidatedBody(REPLAY_PREVIEW_BODY)) b: ReplayRequest) { return this.needReplay().preview(b); }

  /** §45 RUN — sensitive; refuses without the token from preview, and refuses NOT_REPLAYABLE consumers (§43) */
  @RequireEventPermission(EP.replay) @Post('replay')
  replayRun(@Body(ValidatedBody(REPLAY_RUN_BODY)) b: ReplayRequest & { token: string }, @Req() req: any) {
    return this.needReplay().run(b, String(b?.token ?? ''), String(req?.ctx?.userId ?? 'super_admin'));
  }

  /** §155 discard — sensitive; the row is kept for history, never deleted */
  @RequireEventPermission(EP.purge) @Post('dead-letters/:id/discard')
  discard(@Param('id') id: string, @Req() req: any, @Body(ValidatedBody(DEAD_LETTER_DISCARD_BODY)) _b: any) { return this.need().discardDeadLetter(id, String(req?.ctx?.userId ?? 'super_admin')); }
}
