import { BadRequestException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { NailPhotoConsentService, NailPhotoConsentError } from './nail-photo-consent.service';
import type { NailShowcaseContext } from './nail-showcase.repository';

function ctxFrom(req: any): NailShowcaseContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NailPhotoConsentError) {
      if (e.code === 'not_customer') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

// Customer-facing photo-consent controller: a customer views and withdraws consent for their own published photos.
@Controller('customer')
export class NailPhotoConsentController {
  constructor(@Inject(NailPhotoConsentService) private readonly svc: NailPhotoConsentService) {}

  @Get('my-photo-consents') list(@Req() r: any) { return run(() => this.svc.listMine(ctxFrom(r))); }
  @Post('my-photo-consents/:photoId/withdraw') withdraw(@Req() r: any, @Param('photoId') id: string) { return run(() => this.svc.withdraw(ctxFrom(r), id)); }
}
