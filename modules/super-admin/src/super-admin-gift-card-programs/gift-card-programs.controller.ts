// gift-card-programs.controller.ts — Super-Admin gift-card program + membership management HTTP surface (spec §15).
// Behind SuperAdminGuard (platform operators only). Defines which tenants participate in which cross-tenant program;
// no money moves here. Clearing/settlement writes and reporting are separate surfaces.
import { Body, Controller, Get, Param, Patch, Post, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { GiftCardProgramsService, GiftCardProgramsError } from './gift-card-programs.service';
import { GC_MEMBER_STATUS_BODY, GC_PROGRAM_CREATE_BODY, GC_PROGRAM_MEMBER_BODY, GC_PROGRAM_UPDATE_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof GiftCardProgramsError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    const msg = e?.message || '';
    if (msg.includes('invalid input syntax for type uuid') || e?.code === '22P02') {
      throw new HttpException('Invalid tenant UUID syntax. Please select or enter a valid salon UUID.', HttpStatus.BAD_REQUEST);
    }
    if (e?.code === '23503') {
      throw new HttpException('The specified tenant does not exist in the database.', HttpStatus.BAD_REQUEST);
    }
    throw new HttpException(msg || 'An error occurred while processing the gift card program.', HttpStatus.BAD_REQUEST);
  }
}

@Controller('super-admin/gift-cards/programs')
@UseGuards(SuperAdminGuard)
export class GiftCardProgramsController {
  constructor(private readonly svc: GiftCardProgramsService) {}

  @Get() state() { return run(() => this.svc.getState()); }
  @Post() create(@Body(ValidatedBody(GC_PROGRAM_CREATE_BODY)) b: any) { return run(() => this.svc.createProgram(b ?? {})); }
  @Patch(':id') update(@Param('id') id: string, @Body(ValidatedBody(GC_PROGRAM_UPDATE_BODY)) b: any) { return run(() => this.svc.updateProgram(id, b ?? {})); }
  @Post(':id/members') addMember(@Param('id') id: string, @Body(ValidatedBody(GC_PROGRAM_MEMBER_BODY)) b: any) { return run(() => this.svc.addMember(id, b ?? {})); }
  @Patch(':id/members/:tenantId') setMemberStatus(@Param('id') id: string, @Param('tenantId') tenantId: string, @Body(ValidatedBody(GC_MEMBER_STATUS_BODY)) b: any) { return run(() => this.svc.setMemberStatus(id, tenantId, b ?? {})); }
}
