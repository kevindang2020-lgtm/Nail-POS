import { RequirePermission } from '@aipowersalon/permissions/guards';
/**
 * compensation-tech-agreements.controller.ts — §19 technician-facing endpoints: a technician views their own
 * compensation agreements and acknowledges (signs off) a sent one. Identity comes from the authenticated user's linked
 * technician profile — a technician can only see and acknowledge their own agreements.
 */
import { Controller, Get, Param, Post, Req, HttpException, HttpStatus } from '@nestjs/common';
import { AgreementsService } from './compensation-agreements.service';

async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof Error && typeof (e as any).status === 'number') throw new HttpException(e.message, (e as any).status || HttpStatus.BAD_REQUEST); throw e; }
}

@Controller('tech/compensation-agreements')
export class TechAgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @RequirePermission('tech.earnings.view') @Get() list(@Req() r: any) { const c = r?.ctx || {}; return run(() => this.agreements.listForUser({ tenantId: c.tenantId, userId: c.userId }, c.userId)); }

  @RequirePermission('tech.earnings.view') @Post(':id/acknowledge') acknowledge(@Req() r: any, @Param('id') id: string) { const c = r?.ctx || {}; return run(() => this.agreements.acknowledgeAsUser({ tenantId: c.tenantId, userId: c.userId }, id, c.userId)); }
}
