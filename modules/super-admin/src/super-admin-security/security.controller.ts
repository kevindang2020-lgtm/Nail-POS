import { Controller, Get, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SecurityService } from './security.service';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security')
export class SecurityController {
  constructor(private readonly svc: SecurityService) {}
  @Get('overview') async overview() {
    try { return await this.svc.overview(); } catch (e: any) { throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR); }
  }
}
