import { Controller, Get, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { AiReportsService } from './ai-reports.service';

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) { throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR); }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-reports')
export class AiReportsController {
  constructor(private readonly svc: AiReportsService) {}
  @Get('overview') overview() { return run(() => this.svc.overview()); }
}
