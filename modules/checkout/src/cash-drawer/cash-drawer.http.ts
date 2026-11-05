import { HttpException } from '@nestjs/common';
import { CashDrawerError } from './cash-drawer.dto';
import type { DrawerCtx } from './cash-drawer.repository';
export const drawerCtx = (r: any): DrawerCtx => ({ tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId, userId: r?.ctx?.userId, role: r?.ctx?.role, permissions: r?.ctx?.permissions || [] });
export async function drawerRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof CashDrawerError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.httpStatus); throw e; }
}
