import { HttpException } from '@nestjs/common';
import { AccountError } from './account.dto';
import type { AccountCtx } from './account.repository';
export const acctCtx = (r: any): AccountCtx => ({ tenantId: r?.ctx?.tenantId, userId: r?.ctx?.userId, role: r?.ctx?.role });
export async function acctRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof AccountError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.httpStatus); throw e; }
}
