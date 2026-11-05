import { HttpException } from '@nestjs/common';
import { TechCashHandoffError } from './tech-cash-handoff.dto';
import type { TCHCtx } from './tech-cash-handoff.repository';
export const tchCtx = (r: any): TCHCtx => ({ tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId, userId: r?.ctx?.userId, role: r?.ctx?.role, permissions: r?.ctx?.permissions || [] });
export async function tchRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof TechCashHandoffError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.httpStatus); throw e; }
}
