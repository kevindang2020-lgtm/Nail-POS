// push.controller.ts — device-token registration for the signed-in user (any authenticated app: customer/tech/owner/
// front-desk). req.ctx is set by the global auth middleware; a user may only register tokens for themselves.
import { Body, Controller, Post, Req, HttpException } from '@nestjs/common';
import { PushService, PushError } from './push.service';
import { PUSH_REGISTER_BODY, PUSH_UNREGISTER_BODY } from '../request-schemas';
import { ValidatedBody, ResourceScope } from '@aipowersalon/permissions/guards';

@ResourceScope('OWN')   // §38: the signed-in person's own device tokens
@Controller('push')
export class PushController {
  constructor(private readonly svc: PushService) {}
  private ctx(r: any) { const c = r?.ctx || {}; if (!c.userId) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return { tenantId: c.tenantId ?? null, userId: c.userId }; }
  private run<T>(fn: () => Promise<T>) { return fn().catch((e) => { if (e instanceof PushError) throw new HttpException({ ok: false, code: e.code, message: e.message }, 400); throw e; }); }

  @Post('register') register(@Req() r: any, @Body(ValidatedBody(PUSH_REGISTER_BODY, { strict: true })) b: any) { return this.run(() => this.svc.register(this.ctx(r), String(b?.platform || ''), String(b?.token || ''), b?.app ? String(b.app) : undefined)); }
  @Post('unregister') unregister(@Req() r: any, @Body(ValidatedBody(PUSH_UNREGISTER_BODY, { strict: true })) b: any) { return this.run(() => this.svc.unregister(this.ctx(r), String(b?.token || ''))); }
}
