import { HttpException } from '@nestjs/common';
import { SkipLineError } from './skip-line-checkout.dto';
import type { SLCtx } from './skip-line-checkout.repository';
export const slcCtx = (r: any): SLCtx => ({ tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId, userId: r?.ctx?.userId, role: r?.ctx?.role, permissions: r?.ctx?.permissions || [] });
export async function slcRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof SkipLineError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.httpStatus); throw e; }
}
