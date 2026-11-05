// scope.ts — Constitution 6 §25, §46–48: every cached server read belongs to ONE realm + tenant + branch (+ user). The
// scope is the first three segments of every query key, and the persisted cache / journal are partitioned by it, so a
// tenant or branch switch can never show the previous salon's rows.
export interface QueryScope {
  /** 'tenant' (tech / owner / manager-pay staff) or 'customer'. */
  realm: string;
  tenantId: string | null;
  branchId: string | null;
  /** Never part of the query key (keys stay shareable inside one session) but part of the storage partition. */
  userId: string | null;
}
const seg = (v: string | null | undefined) => (v == null || v === '' ? '-' : String(v));

/** The query key: [realm, tenantId, branchId, ...parts]. */
export function scopedKey(scope: QueryScope, ...parts: unknown[]): unknown[] {
  return [scope.realm, seg(scope.tenantId), seg(scope.branchId), ...parts];
}
/** A stable string id of a scope (storage partition): realm:tenant:branch:user. */
export function scopeKey(scope: QueryScope): string {
  return [scope.realm, seg(scope.tenantId), seg(scope.branchId), seg(scope.userId)].map(encodeURIComponent).join(':');
}
export function sameScope(a: QueryScope | null | undefined, b: QueryScope | null | undefined): boolean {
  if (!a || !b) return a == b;
  return scopeKey(a) === scopeKey(b);
}
/** Does this query key belong to the scope? (its first three segments) */
export function keyInScope(key: readonly unknown[], scope: QueryScope): boolean {
  return key[0] === scope.realm && key[1] === seg(scope.tenantId) && key[2] === seg(scope.branchId);
}

/** The scope of a signed-in principal (auth providers' `principal`), or null while signed out. */
export function scopeFromPrincipal(realm: string, p: { userId?: string | null; tenantId?: string | null; branchId?: string | null } | null | undefined): QueryScope | null {
  if (!p || !p.userId) return null;
  return { realm, tenantId: p.tenantId ?? null, branchId: p.branchId ?? null, userId: p.userId };
}
