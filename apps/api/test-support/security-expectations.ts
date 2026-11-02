// security-expectations.ts — Constitution 12 §297: reusable security assertions.
//
// expectIsolated is the core of every cross-tenant test, and it is PAIRED on purpose: the owner's call must FIND the
// record before the attacker's denial means anything. A query broken so it always returns nothing would otherwise
// "pass" every isolation test while proving nothing.
import { expect } from 'vitest';

const DENIED_STATUS = new Set([401, 403, 404]);
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') { const o = v as any; if (Array.isArray(o.items)) return o.items.length === 0; if (Array.isArray(o.rows)) return o.rows.length === 0; }
  return false;
}
function isDenialError(e: unknown): boolean {
  const s = (e as any)?.status ?? (e as any)?.statusCode ?? (e as any)?.getStatus?.();
  return DENIED_STATUS.has(Number(s)) || /not ?found|forbidden|denied|not allowed/i.test(String((e as any)?.message ?? ''));
}

/** The attacker's call is denied: empty, null, or a 401/403/404-shaped error. */
export async function expectTenantDenied(attempt: () => Promise<unknown>, label = 'cross-tenant read'): Promise<void> {
  let result: unknown;
  try { result = await attempt(); } catch (e) { expect(isDenialError(e), `${label}: threw a non-denial error: ${String((e as any)?.message)}`).toBe(true); return; }
  expect(isEmpty(result), `${label}: another tenant's record came back: ${JSON.stringify(result).slice(0, 200)}`).toBe(true);
}

/** The owner FINDS it, and the attacker (another tenant, same id) is denied. */
export async function expectIsolated(owner: () => Promise<unknown>, attacker: () => Promise<unknown>, label: string): Promise<void> {
  const mine = await owner();
  expect(isEmpty(mine), `${label}: the OWNER could not read its own record — the denial below would prove nothing`).toBe(false);
  await expectTenantDenied(attacker, label);
}

/** A permission check refuses (403-shaped). */
export async function expectPermissionDenied(attempt: () => Promise<unknown> | unknown, label = 'permission'): Promise<void> {
  let threw = false;
  try { await attempt(); } catch (e) { threw = true; const s = Number((e as any)?.status ?? (e as any)?.getStatus?.()); expect(s === 403 || /forbidden|permission|not allowed/i.test(String((e as any)?.message)), `${label}: wrong error`).toBe(true); }
  expect(threw, `${label}: was NOT refused`).toBe(true);
}

/** No secret value survives into logged/serialised output. */
export function expectSecretRedacted(output: unknown, secrets: string[]): void {
  const s = typeof output === 'string' ? output : JSON.stringify(output);
  for (const v of secrets) expect(s.includes(v), `secret leaked: ${v.slice(0, 4)}…`).toBe(false);
}

/** A webhook with a bad signature is refused (401/403, or a 204 that performed nothing — checked by the caller). */
export function expectWebhookRejected(status: number): void {
  expect([401, 403]).toContain(status);
}

// ── Security Deep Scan §75 / §187: branch isolation (same salon, another location) ────────────────────────────────
/** A branch-scoped caller's attempt on ANOTHER branch's record (same salon) is denied: empty, null, or a 401/403/404. */
export async function expectBranchDenied(attempt: () => Promise<unknown>, label = 'cross-branch read'): Promise<void> {
  await expectTenantDenied(attempt, `${label} (other branch, same salon)`);
}

/** The record's own branch FINDS it, and a manager scoped to another branch of the same salon is denied. Paired like
 *  expectIsolated, so a query broken to return nothing cannot pass. */
export async function expectBranchIsolated(ownBranch: () => Promise<unknown>, otherBranch: () => Promise<unknown>, label: string): Promise<void> {
  const mine = await ownBranch();
  expect(isEmpty(mine), `${label}: the record's OWN branch could not read it — the denial below would prove nothing`).toBe(false);
  await expectBranchDenied(otherBranch, label);
}
