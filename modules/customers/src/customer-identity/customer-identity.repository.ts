// customer-identity.repository.ts — persistence for the global identity layer (Kevin's sync spec, Jul 26 2026).
// Port + InMemory + Kysely in one module (mirrors the audit-engine shape). The §8 concurrency story lives in
// createGlobal: the partial UNIQUE indexes on VERIFIED phone/email make the duplicate-create race collapse at the
// database — on a unique violation we re-look-up and hand the caller the winner to LINK instead of a second identity.
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_RECON_RUN, GLOBAL_CUSTOMER, CUSTOMER_IDENTITY_CONFLICT } from '../customer-lifecycles';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { GlobalCandidate, MatchConfidence } from './identity-core';

export interface GlobalCustomerInput {
  firstName: string | null; lastName: string | null; fullName: string | null;
  phone: string | null; phoneDisplay: string | null; phoneVerifiedAt: string | null;
  email: string | null; emailVerifiedAt: string | null;
}
export interface LinkInput {
  tenantId: string; customerId: string; globalCustomerId: string;
  confidence: MatchConfidence | 'manual'; source: 'realtime' | 'reconciliation' | 'manual' | 'activation' | 'import';
  runId?: string | null; userId?: string | null;
}

export interface ReconTenantOutcome { customersScanned: number; newGlobals: number; linkedExisting: number; duplicateSuspects: number; conflicts: number; errors: number }
export interface UnreconciledCustomer {
  customerId: string; tenantId: string;
  firstName: string | null; lastName: string | null; fullName: string | null;
  phoneRaw: string | null; email: string | null; updatedAt: string;
}

export interface CustomerIdentityRepositoryPort {
  // ---- reconciliation engine (§25-§29) ----
  withReconLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }>;
  /** Returns null when the DB guard rejects a SECOND concurrent platform-wide run (migration 422). */
  startRun(trigger: 'scheduled' | 'manual', scope: 'all' | 'tenant' | 'customer', scopeId: string | null, cursorFrom: string | null, userId: string | null): Promise<string | null>;
  finishRun(id: string, patch: { status: string; tenantsScanned: number; customersScanned: number; newGlobals: number; linkedExisting: number; duplicateSuspects: number; conflicts: number; errors: number; errorDetail?: string | null }): Promise<void>;
  writeTenantStat(runId: string, tenantId: string, o: ReconTenantOutcome, status: 'ok' | 'failed', errorDetail?: string | null): Promise<void>;
  lastCompletedAt(): Promise<string | null>;
  activeTenantIds(): Promise<string[]>;
  /** Keyset page of customers needing attention for a tenant: unlinked, or changed since the cursor. §29/§32. */
  /** `force` (scoped RE-SYNC): include ALREADY-LINKED, unchanged customers so a support engineer can force a
   *  re-examination without waiting for the customer to change. */
  customersToReconcile(tenantId: string, changedSince: string | null, afterId: string | null, limit: number, force?: boolean): Promise<UnreconciledCustomer[]>;
  listRuns(limit: number): Promise<any[]>;
  listTenantStats(runId: string): Promise<any[]>;
  listConflicts(status: string | null, limit: number): Promise<any[]>;
  /** §24 merge candidates: both identities plus the tenants each is linked into (relationship counts only —
   *  never another salon's private data). */
  mergePreview(aId: string, bId: string): Promise<{ a: any; b: any; aTenants: string[]; bTenants: string[] } | null>;
  /** §15/§24 REVERSIBLE merge: the source is marked merged (never deleted), its links are repointed, and the
   *  previous mapping is preserved so the operation can be undone. */
  mergeGlobals(sourceId: string, targetId: string, userId: string | null): Promise<{ moved: number } | null>;
  /** (tenantId, customerId) pairs linked to a global identity — used to consult legal holds before a merge. */
  linkedCustomersOf(globalId: string): Promise<{ tenantId: string; customerId: string }[]>;
  setConflictStatus(id: string, status: string, userId: string | null): Promise<boolean>;
  upsertConflict(c: { fingerprint: string; kind: string; tenantId: string | null; customerId: string | null; globalCustomerId?: string | null; otherGlobalCustomerId?: string | null; field?: string | null; mainMasked?: string | null; tenantMasked?: string | null; confidence?: string | null; recommendedAction?: string | null; runId: string }): Promise<'created' | 'bumped'>;
  // ---- real-time link path ----
  /** All ACTIVE global customers sharing the phone or email (the §7 candidate set). */
  findCandidates(phone: string | null, email: string | null): Promise<GlobalCandidate[]>;
  /** Race-safe create: returns the created id, or — after a verified-unique violation — the existing winner's id
   *  with created:false so the caller links instead of duplicating. */
  createGlobal(input: GlobalCustomerInput): Promise<{ id: string; created: boolean }>;
  linkFor(tenantId: string, customerId: string): Promise<{ globalCustomerId: string } | null>;
  /** The global identity row (for §12 precedence decisions). */
  globalById(id: string): Promise<{ id: string; phone: string | null; phoneVerified: boolean; email: string | null; emailVerified: boolean; version: number } | null>;
  /** Another ACTIVE global identity already holding this VERIFIED identifier (§9/§10 collision). */
  otherGlobalWithVerified(field: 'phone' | 'email', value: string, excludeGlobalId: string): Promise<string | null>;
  /** Version-guarded identity write (§30). Returns false when the row moved underneath us. */
  updateGlobalIdentity(id: string, patch: { phone?: string | null; phoneDisplay?: string | null; phoneVerifiedAt?: string | null; email?: string | null; emailVerifiedAt?: string | null }, expectedVersion: number): Promise<boolean>;
  createLink(input: LinkInput): Promise<{ id: string; created: boolean }>;
}

export class KyselyCustomerIdentityRepository implements CustomerIdentityRepositoryPort {
  constructor(private readonly db: AppDatabase) {}


  // ---- reconciliation engine ----
  async withReconLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    const got: any = await sql`select pg_try_advisory_lock(hashtextextended('customer_reconciliation', 0)) as ok`.execute(this.db as any).then((x: any) => x.rows[0]);
    if (!got?.ok) return { ran: false };
    try { return { ran: true, result: await fn() }; }
    finally { await sql`select pg_advisory_unlock(hashtextextended('customer_reconciliation', 0))`.execute(this.db as any).catch(() => {}); }
  }
  async startRun(trigger: 'scheduled' | 'manual', scope: 'all' | 'tenant' | 'customer', scopeId: string | null, cursorFrom: string | null, userId: string | null): Promise<string | null> {
    try {
      const r: any = await sql`insert into customer_recon_runs (trigger, scope, scope_id, cursor_from, triggered_by_user_id)
        values (${trigger}, ${scope}, ${scopeId}, ${cursorFrom}, ${userId}) returning id`.execute(this.db as any).then((x: any) => x.rows[0]);
      return String(r.id);
    } catch (e: any) {
      // Migration 422: ux_recon_single_running_all. Another instance is already running a platform-wide pass —
      // even if it holds the advisory lock on a backend this one cannot see (transaction-pooled connections).
      if (scope === 'all' && /ux_recon_single_running_all|unique/i.test(String(e?.message ?? ''))) return null;
      throw e;
    }
  }
  async finishRun(id: string, p: { status: string; tenantsScanned: number; customersScanned: number; newGlobals: number; linkedExisting: number; duplicateSuspects: number; conflicts: number; errors: number; errorDetail?: string | null }): Promise<void> {
    await sql`update customer_recon_runs set status=${p.status}, finished_at=now(), tenants_scanned=${p.tenantsScanned},
      customers_scanned=${p.customersScanned}, new_globals=${p.newGlobals}, linked_existing=${p.linkedExisting},
      duplicate_suspects=${p.duplicateSuspects}, conflicts=${p.conflicts}, errors=${p.errors}, error_detail=${p.errorDetail ?? null}
      where id=${id} and ${canMoveToSql(CUSTOMER_RECON_RUN, p.status)}`.execute(this.db as any);
  }
  async writeTenantStat(runId: string, tenantId: string, o: ReconTenantOutcome, status: 'ok' | 'failed', errorDetail: string | null = null): Promise<void> {
    await sql`insert into customer_recon_tenant_stats (run_id, tenant_id, customers_scanned, new_globals, linked_existing, duplicate_suspects, conflicts, errors, status, error_detail)
      values (${runId}, ${tenantId}, ${o.customersScanned}, ${o.newGlobals}, ${o.linkedExisting}, ${o.duplicateSuspects}, ${o.conflicts}, ${o.errors}, ${status}, ${errorDetail})
      on conflict (run_id, tenant_id) do update set customers_scanned=${o.customersScanned}, status=${status}, error_detail=${errorDetail}`.execute(this.db as any);
  }
  async lastCompletedAt(): Promise<string | null> {
    const r: any = await sql`select finished_at from customer_recon_runs where status in ('COMPLETED','COMPLETED_WITH_ISSUES') and scope='all' order by finished_at desc limit 1`
      .execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r?.finished_at ? new Date(r.finished_at).toISOString() : null;
  }
  async activeTenantIds(): Promise<string[]> {
    const rows: any[] = await sql`select id from tenants order by id`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => String(r.id));
  }
  async customersToReconcile(tenantId: string, changedSince: string | null, afterId: string | null, limit: number, force = false): Promise<UnreconciledCustomer[]> {
    const rows: any[] = await sql`
      select c.id, c.tenant_id, c.first_name, c.last_name, c.full_name, c.phone_display, c.email, c.updated_at
      from customers c
      left join customer_global_links l on l.customer_id = c.id
      where c.tenant_id = ${tenantId}
        and c.archived_at is null
        and (${force} or l.id is null or (${changedSince}::timestamptz is not null and c.updated_at > ${changedSince}))
        and (${afterId}::uuid is null or c.id > ${afterId})
      order by c.id
      limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({ customerId: String(r.id), tenantId: String(r.tenant_id), firstName: r.first_name ?? null, lastName: r.last_name ?? null, fullName: r.full_name ?? null, phoneRaw: r.phone_display ?? null, email: r.email ?? null, updatedAt: new Date(r.updated_at).toISOString() }));
  }

  async listRuns(limit: number): Promise<any[]> {
    const rows: any[] = await sql`select * from customer_recon_runs order by started_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), trigger: r.trigger, scope: r.scope, scopeId: r.scope_id ? String(r.scope_id) : null, status: r.status,
      startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      tenantsScanned: Number(r.tenants_scanned || 0), customersScanned: Number(r.customers_scanned || 0), newGlobals: Number(r.new_globals || 0),
      linkedExisting: Number(r.linked_existing || 0), duplicateSuspects: Number(r.duplicate_suspects || 0), conflicts: Number(r.conflicts || 0), errors: Number(r.errors || 0) }));
  }
  async listTenantStats(runId: string): Promise<any[]> {
    const rows: any[] = await sql`select * from customer_recon_tenant_stats where run_id = ${runId} order by customers_scanned desc`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({ tenantId: String(r.tenant_id), customersScanned: Number(r.customers_scanned || 0), newGlobals: Number(r.new_globals || 0),
      linkedExisting: Number(r.linked_existing || 0), duplicateSuspects: Number(r.duplicate_suspects || 0), conflicts: Number(r.conflicts || 0), errors: Number(r.errors || 0), status: r.status, errorDetail: r.error_detail ?? null }));
  }
  async listConflicts(status: string | null, limit: number): Promise<any[]> {
    const rows: any[] = status
      ? await sql`select * from customer_identity_conflicts where status = ${status} order by updated_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => [])
      : await sql`select * from customer_identity_conflicts order by updated_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    // §23/§33: only MASKED values ever leave this repository.
    return rows.map((r) => ({ id: String(r.id), kind: r.kind, tenantId: r.tenant_id ? String(r.tenant_id) : null, customerId: r.customer_id ? String(r.customer_id) : null,
      globalCustomerId: r.global_customer_id ? String(r.global_customer_id) : null, otherGlobalCustomerId: r.other_global_customer_id ? String(r.other_global_customer_id) : null,
      field: r.field ?? null, mainValueMasked: r.main_value_masked ?? null, tenantValueMasked: r.tenant_value_masked ?? null,
      status: r.status, occurrences: Number(r.occurrences || 1), recommendedAction: r.recommended_action ?? null, createdAt: new Date(r.created_at).toISOString() }));
  }

  async mergePreview(aId: string, bId: string) {
    const rows: any[] = await sql`select id, first_name, last_name, full_name, normalized_phone, phone_verified_at, email, email_verified_at, status, created_at, updated_at
      from global_customers where id in (${aId}, ${bId})`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    if (rows.length < 2) return null;
    const links: any[] = await sql`select global_customer_id, tenant_id from customer_global_links where global_customer_id in (${aId}, ${bId})`
      .execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    const pick = (id: string) => rows.find((r) => String(r.id) === id);
    const tenantsOf = (id: string) => links.filter((l) => String(l.global_customer_id) === id).map((l) => String(l.tenant_id));
    return { a: pick(aId), b: pick(bId), aTenants: tenantsOf(aId), bTenants: tenantsOf(bId) };
  }

  async linkedCustomersOf(globalId: string): Promise<{ tenantId: string; customerId: string }[]> {
    const rows: any[] = await sql`select tenant_id, customer_id from customer_global_links where global_customer_id = ${globalId}`
      .execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({ tenantId: String(r.tenant_id), customerId: String(r.customer_id) }));
  }

  async mergeGlobals(sourceId: string, targetId: string, userId: string | null): Promise<{ moved: number } | null> {
    if (sourceId === targetId) return null;
    // One transaction (§31): repoint the links and retire the source together, or not at all. The source row is
    // KEPT (status='merged', merged_into_id set) — §15 forbids destroying originals, and it is what makes the
    // merge reversible.
    return (this.db as any).transaction().execute(async (trx: any) => {
      const moved: any = await sql`update customer_global_links set global_customer_id = ${targetId}, confidence = 'manual', linked_by_user_id = ${userId}
        where global_customer_id = ${sourceId} returning id`.execute(trx).then((x: any) => x.rows);
      await sql`update global_customers set status = 'merged', merged_into_id = ${targetId}, version = version + 1, updated_at = now() where id = ${sourceId} and ${canMoveToSql(GLOBAL_CUSTOMER, 'merged')}`.execute(trx);
      return { moved: moved.length };
    }).catch(() => null);
  }

  async setConflictStatus(id: string, status: string, userId: string | null): Promise<boolean> {
    const r: any = await sql`update customer_identity_conflicts set status = ${status}, resolved_by_user_id = ${userId},
      resolved_at = case when ${status} in ('RESOLVED','MERGED','KEEP_SEPARATE','IGNORED','FALSE_POSITIVE') then now() else null end,
      updated_at = now() where id = ${id} and ${canMoveToSql(CUSTOMER_IDENTITY_CONFLICT, status)} returning id`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return !!r?.id;
  }
  async upsertConflict(c: { fingerprint: string; kind: string; tenantId: string | null; customerId: string | null; globalCustomerId?: string | null; otherGlobalCustomerId?: string | null; field?: string | null; mainMasked?: string | null; tenantMasked?: string | null; confidence?: string | null; recommendedAction?: string | null; runId: string }): Promise<'created' | 'bumped'> {
    const existing: any = await sql`select id, status from customer_identity_conflicts where fingerprint = ${c.fingerprint} limit 1`
      .execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    if (existing?.id) {
      // Phase 12 (#27): a re-seen conflict keeps its status (the old `status = case … then status else status end` was a no-op write)
      await sql`update customer_identity_conflicts set occurrences = occurrences + 1, last_seen_run = ${c.runId},
        updated_at = now() where id = ${existing.id}`.execute(this.db as any);
      return 'bumped';
    }
    await sql`insert into customer_identity_conflicts (fingerprint, kind, tenant_id, customer_id, global_customer_id, other_global_customer_id, field, main_value_masked, tenant_value_masked, confidence, recommended_action, first_seen_run, last_seen_run)
      values (${c.fingerprint}, ${c.kind}, ${c.tenantId}, ${c.customerId}, ${c.globalCustomerId ?? null}, ${c.otherGlobalCustomerId ?? null}, ${c.field ?? null}, ${c.mainMasked ?? null}, ${c.tenantMasked ?? null}, ${c.confidence ?? null}, ${c.recommendedAction ?? null}, ${c.runId}, ${c.runId})`.execute(this.db as any);
    return 'created';
  }

  async findCandidates(phone: string | null, email: string | null): Promise<GlobalCandidate[]> {
    if (!phone && !email) return [];
    const rows: any[] = await sql`
      select id, normalized_phone, phone_verified_at, email, email_verified_at, full_name
      from global_customers
      where status = 'active'
        and ((${phone}::text is not null and normalized_phone = ${phone})
          or (${email}::text is not null and email = ${email}))
      limit 20`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({
      globalCustomerId: String(r.id),
      phone: r.normalized_phone ?? null, phoneVerified: r.phone_verified_at != null,
      email: r.email ?? null, emailVerified: r.email_verified_at != null,
      name: r.full_name ?? null,
    }));
  }

  async createGlobal(input: GlobalCustomerInput): Promise<{ id: string; created: boolean }> {
    try {
      const r: any = await sql`
        insert into global_customers (first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at, email, email_verified_at)
        values (${input.firstName}, ${input.lastName}, ${input.fullName}, ${input.phone}, ${input.phoneDisplay},
                ${input.phoneVerifiedAt}, ${input.email}, ${input.emailVerifiedAt})
        returning id`.execute(this.db as any).then((x: any) => x.rows[0]);
      return { id: String(r.id), created: true };
    } catch (e: any) {
      // §8: a concurrent create with the same VERIFIED identifier won the partial-unique race — link the winner.
      const winner: any = await sql`
        select id from global_customers
        where status = 'active'
          and ((${input.phone}::text is not null and normalized_phone = ${input.phone} and phone_verified_at is not null)
            or (${input.email}::text is not null and email = ${input.email} and email_verified_at is not null))
        limit 1`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
      if (winner?.id) return { id: String(winner.id), created: false };
      throw e;                                              // a genuine failure, not the race — surface it
    }
  }

  async linkFor(tenantId: string, customerId: string): Promise<{ globalCustomerId: string } | null> {
    const r: any = await sql`select global_customer_id from customer_global_links where tenant_id = ${tenantId} and customer_id = ${customerId} limit 1`
      .execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { globalCustomerId: String(r.global_customer_id) } : null;
  }


  async globalById(id: string) {
    const r: any = await sql`select id, normalized_phone, phone_verified_at, email, email_verified_at, version from global_customers where id = ${id} limit 1`
      .execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { id: String(r.id), phone: r.normalized_phone ?? null, phoneVerified: r.phone_verified_at != null, email: r.email ?? null, emailVerified: r.email_verified_at != null, version: Number(r.version || 1) } : null;
  }
  async otherGlobalWithVerified(field: 'phone' | 'email', value: string, excludeGlobalId: string): Promise<string | null> {
    const r: any = field === 'phone'
      ? await sql`select id from global_customers where status='active' and normalized_phone = ${value} and phone_verified_at is not null and id <> ${excludeGlobalId} limit 1`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined)
      : await sql`select id from global_customers where status='active' and email = ${value} and email_verified_at is not null and id <> ${excludeGlobalId} limit 1`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r?.id ? String(r.id) : null;
  }
  async updateGlobalIdentity(id: string, patch: { phone?: string | null; phoneDisplay?: string | null; phoneVerifiedAt?: string | null; email?: string | null; emailVerifiedAt?: string | null }, expectedVersion: number): Promise<boolean> {
    // §30 optimistic concurrency: the version guard is the whole point — a stale writer matches zero rows.
    const r: any = await sql`update global_customers set
        normalized_phone = coalesce(${patch.phone ?? null}, normalized_phone),
        phone_display = coalesce(${patch.phoneDisplay ?? null}, phone_display),
        phone_verified_at = coalesce(${patch.phoneVerifiedAt ?? null}, phone_verified_at),
        email = coalesce(${patch.email ?? null}, email),
        email_verified_at = coalesce(${patch.emailVerifiedAt ?? null}, email_verified_at),
        version = version + 1, updated_at = now()
      where id = ${id} and version = ${expectedVersion} returning id`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return !!r?.id;
  }
  async createLink(input: LinkInput): Promise<{ id: string; created: boolean }> {
    try {
      const r: any = await sql`
        insert into customer_global_links (tenant_id, customer_id, global_customer_id, confidence, source, linked_run_id, linked_by_user_id)
        values (${input.tenantId}, ${input.customerId}, ${input.globalCustomerId}, ${input.confidence}, ${input.source},
                ${input.runId ?? null}, ${input.userId ?? null})
        returning id`.execute(this.db as any).then((x: any) => x.rows[0]);
      return { id: String(r.id), created: true };
    } catch {
      // customer_id UNIQUE — an idempotent retry (§27): the link already exists.
      const existing: any = await sql`select id from customer_global_links where tenant_id = ${input.tenantId} and customer_id = ${input.customerId} limit 1`
        .execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
      return existing?.id ? { id: String(existing.id), created: false } : { id: '', created: false };
    }
  }
}

export class InMemoryCustomerIdentityRepository implements CustomerIdentityRepositoryPort {
  globals: (GlobalCandidate & { verifiedUnique?: boolean })[] = [];
  links: LinkInput[] = [];
  tenants: string[] = [];
  customers: UnreconciledCustomer[] = [];
  runs: any[] = [];
  tenantStats: any[] = [];
  conflictRows: any[] = [];
  locked = false;
  private seq = 0;
  async withReconLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    if (this.locked) return { ran: false };
    this.locked = true;
    try { return { ran: true, result: await fn() }; } finally { this.locked = false; }
  }
  async startRun(trigger: 'scheduled' | 'manual', scope: 'all' | 'tenant' | 'customer', scopeId: string | null, cursorFrom: string | null, userId: string | null): Promise<string | null> {
    if (scope === 'all' && this.runs.some((r) => r.status === 'RUNNING' && r.scope === 'all')) return null;   // mirrors ux_recon_single_running_all
    const id = `run_${++this.seq}`;
    this.runs.unshift({ id, trigger, scope, scopeId, cursorFrom, userId, status: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null });
    return id;
  }
  async finishRun(id: string, patch: any): Promise<void> { const r = this.runs.find((x) => x.id === id); if (r) Object.assign(r, patch, { finishedAt: new Date().toISOString() }); }
  async writeTenantStat(runId: string, tenantId: string, o: ReconTenantOutcome, status: 'ok' | 'failed', errorDetail: string | null = null): Promise<void> {
    this.tenantStats.push({ runId, tenantId, ...o, status, errorDetail });
  }
  async lastCompletedAt(): Promise<string | null> { return this.runs.find((r) => ['COMPLETED', 'COMPLETED_WITH_ISSUES'].includes(r.status) && r.scope === 'all')?.finishedAt ?? null; }
  async activeTenantIds(): Promise<string[]> { return [...this.tenants]; }
  async customersToReconcile(tenantId: string, changedSince: string | null, afterId: string | null, limit: number, force = false): Promise<UnreconciledCustomer[]> {
    const linked = new Set(this.links.map((l) => l.customerId));
    return this.customers
      .filter((c) => c.tenantId === tenantId)
      .filter((c) => force || !linked.has(c.customerId) || (changedSince != null && c.updatedAt > changedSince))
      .filter((c) => afterId == null || c.customerId > afterId)
      .sort((a, b) => a.customerId.localeCompare(b.customerId))
      .slice(0, limit);
  }

  async listRuns(limit: number): Promise<any[]> { return this.runs.slice(0, limit); }
  async listTenantStats(runId: string): Promise<any[]> { return this.tenantStats.filter((s) => s.runId === runId); }
  async listConflicts(status: string | null, limit: number): Promise<any[]> { return this.conflictRows.filter((c) => !status || c.status === status).slice(0, limit); }

  async mergePreview(aId: string, bId: string) {
    const a = this.globals.find((g) => g.globalCustomerId === aId);
    const b = this.globals.find((g) => g.globalCustomerId === bId);
    if (!a || !b) return null;
    const tenantsOf = (id: string) => this.links.filter((l) => l.globalCustomerId === id).map((l) => l.tenantId);
    return { a, b, aTenants: tenantsOf(aId), bTenants: tenantsOf(bId) };
  }
  async linkedCustomersOf(globalId: string) { return this.links.filter((l) => l.globalCustomerId === globalId).map((l) => ({ tenantId: l.tenantId, customerId: l.customerId })); }
  async mergeGlobals(sourceId: string, targetId: string, userId: string | null) {
    if (sourceId === targetId) return null;
    const src: any = this.globals.find((g) => g.globalCustomerId === sourceId);
    if (!src) return null;
    let moved = 0;
    for (const l of this.links) if (l.globalCustomerId === sourceId) { l.globalCustomerId = targetId; l.confidence = 'manual' as any; l.userId = userId; moved++; }
    src.status = 'merged'; src.mergedIntoId = targetId;
    return { moved };
  }
  async setConflictStatus(id: string, status: string, userId: string | null): Promise<boolean> {
    const c = this.conflictRows.find((x) => x.id === id || x.fingerprint === id);
    if (!c) return false;
    c.status = status; c.resolvedByUserId = userId; c.resolvedAt = new Date().toISOString();
    return true;
  }
  async upsertConflict(c: any): Promise<'created' | 'bumped'> {
    const existing = this.conflictRows.find((x) => x.fingerprint === c.fingerprint);
    if (existing) { existing.occurrences++; existing.lastSeenRun = c.runId; return 'bumped'; }
    this.conflictRows.push({ ...c, occurrences: 1, status: 'NEW', firstSeenRun: c.runId, lastSeenRun: c.runId });
    return 'created';
  }
  async findCandidates(phone: string | null, email: string | null): Promise<GlobalCandidate[]> {
    return this.globals.filter((g) => (phone && g.phone === phone) || (email && g.email === email)).map((g) => ({ ...g }));
  }
  async createGlobal(input: GlobalCustomerInput): Promise<{ id: string; created: boolean }> {
    const clash = this.globals.find((g) =>
      (input.phoneVerifiedAt && g.phoneVerified && g.phone === input.phone) ||
      (input.emailVerifiedAt && g.emailVerified && g.email === input.email));
    if (clash) return { id: clash.globalCustomerId, created: false };   // the race, in memory
    const id = `g_${++this.seq}`;
    this.globals.push({ globalCustomerId: id, phone: input.phone, phoneVerified: !!input.phoneVerifiedAt, email: input.email, emailVerified: !!input.emailVerifiedAt, name: input.fullName });
    return { id, created: true };
  }
  async linkFor(tenantId: string, customerId: string) { const l = this.links.find((x) => x.tenantId === tenantId && x.customerId === customerId); return l ? { globalCustomerId: l.globalCustomerId } : null; }

  async globalById(id: string) {
    const g = this.globals.find((x) => x.globalCustomerId === id);
    return g ? { id, phone: g.phone, phoneVerified: g.phoneVerified, email: g.email, emailVerified: g.emailVerified, version: (g as any).version ?? 1 } : null;
  }
  async otherGlobalWithVerified(field: 'phone' | 'email', value: string, excludeGlobalId: string): Promise<string | null> {
    const hit = this.globals.find((g) => g.globalCustomerId !== excludeGlobalId && (field === 'phone' ? g.phoneVerified && g.phone === value : g.emailVerified && g.email === value));
    return hit?.globalCustomerId ?? null;
  }
  async updateGlobalIdentity(id: string, patch: any, expectedVersion: number): Promise<boolean> {
    const g: any = this.globals.find((x) => x.globalCustomerId === id);
    if (!g || (g.version ?? 1) !== expectedVersion) return false;
    if (patch.phone != null) { g.phone = patch.phone; if (patch.phoneVerifiedAt) g.phoneVerified = true; }
    if (patch.email != null) { g.email = patch.email; if (patch.emailVerifiedAt) g.emailVerified = true; }
    g.version = (g.version ?? 1) + 1;
    return true;
  }
  async createLink(input: LinkInput): Promise<{ id: string; created: boolean }> {
    if (this.links.some((x) => x.customerId === input.customerId)) return { id: 'dup', created: false };
    this.links.push({ ...input });
    return { id: `l_${++this.seq}`, created: true };
  }
}
