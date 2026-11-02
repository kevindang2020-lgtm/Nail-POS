// grandfather.controller.ts — Super Admin grandfathering surface (under SuperAdminGuard). Create is permission-gated
// in the service and audited.
import { Controller, Get, Post, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { GrandfatherService, GrandfatherForbiddenError, GrandfatherNotFoundError, type GrandfatherActor } from './grandfather.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { GRANDFATHER_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/grandfathered')
export class GrandfatherController {
  constructor(private readonly svc: GrandfatherService) {}

  @Get()
  async list() {
    try { return await this.svc.list(); }
    catch (e: any) { throw new HttpException(e?.message || 'Failed', HttpStatus.BAD_REQUEST); }
  }

  @Post()
  async create(@Body(ValidatedBody(GRANDFATHER_BODY, { strict: true })) body: any, @Req() req: any) {
    const actor: GrandfatherActor = { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
    try { return await this.svc.create(actor, body ?? {}); }
    catch (e: any) {
      if (e instanceof GrandfatherForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof GrandfatherNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
      throw new HttpException(e?.message || 'Create failed', HttpStatus.BAD_REQUEST);
    }
  }
}
