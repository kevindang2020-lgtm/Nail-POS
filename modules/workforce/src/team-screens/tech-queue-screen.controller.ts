// tech-queue-screen.controller.ts — `/pos/tech-queue-screen/*`, the read model beside the canonical Tech Queue board (Oct 30
// 2026): Live Queue vs History tickets, a ticket's timeline, Technician Assignment Details and one scoped search. Read only —
// every action stays on TechQueueController / the queue routes, which re-validate.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TechQueueScreenRepository, TQ_TABS, TQ_DATE_FIELDS } from './tech-queue-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';

export const TECH_QUEUE_SCREEN = 'TechQueueScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const TICKETS = { filters: { preset: PRESET, tab: { type: 'enum', values: TQ_TABS }, technicianId: { type: 'uuid' }, dateField: { type: 'enum', values: TQ_DATE_FIELDS } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const RECENT = { maxLimit: 50, defaultLimit: 6, params: ['page'] } as const;
const SEARCH = { search: { maxLength: 100 }, maxLimit: 5, defaultLimit: 5 } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/tech-queue-screen')
export class TechQueueScreenController {
  constructor(@Inject(TECH_QUEUE_SCREEN) private readonly repo: TechQueueScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The tech queue screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('tickets') @RequirePermission('pos.tech_queue.view') @ListQuery(TICKETS)
  tickets(@Req() req: any, @Query() q: any) { return this.r().tickets(teamCtx(req), { tab: s(q?.tab), q: s(q?.q), technicianId: s(q?.technicianId), dateField: s(q?.dateField), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('tab-counts') @RequirePermission('pos.tech_queue.view')
  tabCounts(@Req() req: any) { return this.r().tabCounts(teamCtx(req)); }

  @Get('tickets/:id') @RequirePermission('pos.tech_queue.view')
  ticket(@Req() req: any, @Param('id') id: string) { return this.r().ticket(teamCtx(req), id); }

  @Get('technicians/:id') @RequirePermission('pos.tech_queue.view') @ListQuery(RECENT)
  technician(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().technician(teamCtx(req), id, { page: q?.page, pageSize: q?.pageSize }); }

  @Get('search') @RequirePermission('pos.tech_queue.view') @ListQuery(SEARCH)
  search(@Req() req: any, @Query() q: any) { return this.r().search(teamCtx(req), { q: s(q?.q) }); }
}
