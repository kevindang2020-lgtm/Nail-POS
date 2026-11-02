// audit-rows.ts — Finish the Five (Oct 30 2026): the team screens' bridge to the audit module's FAIL-CLOSED write
// (recordAuditStrict, modules/audit). A review transition writes its audit row in the same transaction as the state
// change; a sensitive CSV export fails closed (503) when its row cannot be written. Also: the request id helper.
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { recordAuditStrict, type StrictAuditInput } from '@aipowersalon/audit';
import { branchOf, type TeamCtx } from './screen-kit';

export type AuditRowInput = StrictAuditInput;
const REQ = /^[A-Za-z0-9._:-]{1,100}$/;
/** the caller's request id (?requestId / x-request-id) when well-formed, otherwise a fresh one */
export function requestIdOf(req: any, fromQuery?: unknown): string {
  const c = [fromQuery, req?.headers?.['x-request-id'], req?.id].find((v) => typeof v === 'string' && REQ.test(v));
  return (c as string | undefined) ?? randomUUID();
}
export function writeAuditRow(db: Kysely<any>, ctx: TeamCtx, a: AuditRowInput): Promise<void> {
  return recordAuditStrict(db, { tenantId: ctx.tenantId, branchId: branchOf(ctx), userId: ctx.userId, role: ctx.role }, a);
}
