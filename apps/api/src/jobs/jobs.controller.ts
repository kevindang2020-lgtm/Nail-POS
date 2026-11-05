// jobs.controller.ts — Super Admin's view of the ONE job queue (BUILD_PLAN Phase 2; Constitution 4 §32, §180): per
// class queued / running / dead / done-last-hour and the age of the oldest due job; the dead jobs with their last error;
// retry a dead job, cancel a queued or dead one. Platform-only (SuperAdminGuard + the 'system' domain).
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { SELF_TEST_JOB } from './job-worker';
import { DATABASE, JOB_QUEUE_CLASSES, jobStats, listJobs, retryJob, cancelJob, registeredJobTypes, enqueueJob, type JobQueueClass, type JobStatus, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AuditService } from '@aipowersalon/audit';
import { JobsControllerListQueries } from './jobs.list-queries';
import { JOB_ACTION_BODY, JOB_SELF_TEST_BODY } from './request-schemas';

const STATUSES: JobStatus[] = ['queued', 'running', 'succeeded', 'dead', 'canceled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@UseGuards(SuperAdminGuard)
@ListQueries(JobsControllerListQueries)
@Controller('super-admin/jobs')
export class JobsController {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: Kysely<any> | null, @Optional() private readonly audit?: AuditService) {}
  private need(): Kysely<any> { if (!this.db) throw new BadRequestException('The job queue needs the database.'); return this.db; }

  @Get('stats') @RequirePermission('super_admin.system_operations.view')
  async stats() { return { classes: await jobStats(this.need()), handlers: registeredJobTypes() }; }

  @Get('') @RequirePermission('super_admin.system_operations.view')
  async list(@Query('status') status?: string, @Query('jobClass') jobClass?: string, @Query('jobType') jobType?: string, @Query('tenantId') tenantId?: string, @Query('limit') limit?: string) {
    if (status && !STATUSES.includes(status as JobStatus)) throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);
    if (jobClass && !(JOB_QUEUE_CLASSES as readonly string[]).includes(jobClass)) throw new BadRequestException(`jobClass must be one of ${JOB_QUEUE_CLASSES.join(', ')}`);
    if (tenantId && !UUID.test(tenantId)) throw new BadRequestException('tenantId must be a salon id');
    const rows = await listJobs(this.need(), { status: status as JobStatus | undefined, jobClass: jobClass as JobQueueClass | undefined, jobType: jobType || undefined, tenantId: tenantId || undefined, limit: Number(limit) || 50 });
    // The payload's KEYS, never its values: a job can carry a customer's details, and this list is cross-tenant.
    return { items: rows.map(({ payload, ...j }) => ({ ...j, payloadKeys: Object.keys(payload ?? {}).sort() })) };
  }

  /** Enqueue N self-test jobs (1–50): proves the workers are alive and shows which processes ran them. No salon data. */
  @Post('self-test') @RequirePermission('super_admin.system.manage')
  async selfTest(@Req() req: any, @Body(ValidatedBody(JOB_SELF_TEST_BODY)) b: any) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(b?.count) || 1)));
    const holdMs = Math.max(0, Math.min(2_000, Math.floor(Number(b?.holdMs) || 0)));
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await enqueueJob(this.need(), { jobClass: 'standard', jobType: SELF_TEST_JOB, priority: 3, maxAttempts: 1, payload: holdMs ? { holdMs } : {}, createdBy: req?.ctx?.userId ?? null })).id);
    await this.audit?.recordPlatform({ module: 'jobs', action: 'job_self_test', resourceType: 'job', resourceId: ids[0], userId: req?.ctx?.userId ?? null, role: req?.ctx?.role ?? null, summary: `Job queue self-test (${n})`, metadata: { count: n } });
    return { ok: true, ids };
  }

  @Post(':id/retry') @RequirePermission('super_admin.system.manage')
  async retry(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(JOB_ACTION_BODY)) b: any) { return this.act(req, id, 'retry', b?.reason); }

  @Post(':id/cancel') @RequirePermission('super_admin.system.manage')
  async cancel(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(JOB_ACTION_BODY)) b: any) { return this.act(req, id, 'cancel', b?.reason); }

  private async act(req: any, id: string, action: 'retry' | 'cancel', reason: unknown) {
    if (!UUID.test(id)) throw new BadRequestException('job id must be a UUID');
    const why = String(reason ?? '').trim();
    if (why.length < 5) throw new BadRequestException('A reason (at least 5 characters) is required — the next person needs to know why.');
    const ok = action === 'retry' ? await retryJob(this.need(), id) : await cancelJob(this.need(), id);
    if (!ok) throw new NotFoundException(action === 'retry' ? 'No dead or canceled job with that id.' : 'No queued or dead job with that id.');
    await this.audit?.recordPlatform({ module: 'jobs', action: `job_${action}`, resourceType: 'job', resourceId: id, userId: req?.ctx?.userId ?? null, role: req?.ctx?.role ?? null, summary: `Job ${action}`, metadata: { reason: why } });
    return { ok: true, id, action };
  }
}
