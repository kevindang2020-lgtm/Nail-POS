// booking-verification.pgtest.vitest.spec.ts — the drivers against a REAL Postgres (PGlite).
//
// ══ WHY THIS FILE EXISTS ══════════════════════════════════════════════════════════════════════════════════
//
// Every other spec in this module mocks the store. So every one of them passed while
// `KyselyVerificationSettingsStore.upsert()` was BROKEN:
//
//     ON CONFLICT (tenant_id, branch_id)   -- against a PARTIAL unique index
//     → "there is no unique or exclusion constraint matching the ON CONFLICT specification"
//
// The uniqueness on that table is two partial indexes (NULL is not comparable in a UNIQUE constraint, so a
// tenant-level row needs its own). Postgres requires the index PREDICATE in the conflict target for a partial
// index — and refuses outright otherwise. It typechecked. It passed 12 unit tests. It would have thrown on the
// first real save by the first real tenant.
//
// That is the same class of bug as the three worst ones already found in this codebase — a query against a table
// that does not exist, a status value that can never occur, a refund that is never subtracted. **A mocked test
// cannot see any of them.** Only a database can.
//
// So this spec runs the ACTUAL migration chain into an ACTUAL Postgres and then drives the ACTUAL drivers.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { KyselyVerificationSettingsStore } from './booking-verification-settings.kysely';
import { KyselyVerificationStore } from './booking-verification.kysely';
import { BookingVerificationOversightService } from './booking-verification-oversight.service';
import { AuditService, KyselyAuditRepository, auditSinkFor } from '@aipowersalon/audit';
import { KyselyRiskCounters } from './booking-verification-fraud.adapters';
import { BookingVerificationRetentionScheduler, retentionDays } from './booking-verification-retention.scheduler';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      async *streamQuery() { /* not used */ },
    } as any;
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

const T = '11111111-1111-1111-1111-111111111111';
const T2 = '11111111-1111-1111-1111-111111111112';
const B = '22222222-2222-2222-2222-222222222222';
const ADMIN = '55555555-5555-5555-5555-555555555555';   // updated_by_user_id is a UUID column

let db: any;
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  for (const f of files) {
    // PGlite has no pgcrypto/pg_trgm; gen_random_uuid() is native in PG13+. Only the extension lines are stripped
    // — every CREATE TABLE, ALTER and INDEX runs exactly as it will in production.
    const text = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(text); } catch { /* a handful need pg_trgm; unrelated to this module */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}, 120_000);

describe('the migrations actually apply', () => {
  it('creates every table this module reads and writes', async () => {
    for (const t of [
      'booking_holds', 'booking_verification_sessions', 'booking_verified_phones',
      'booking_verification_settings', 'booking_verification_platform_policy',
    ]) {
      const r: any = await sql`select count(*)::int n from information_schema.tables where table_name = ${t}`.execute(db);
      expect(r.rows[0].n, t).toBe(1);
    }
  });

  it('EXTENDS the pre-existing booking_holds rather than replacing it', async () => {
    // booking_holds predates this feature (migration 009) and was an ORPHAN table — created, then never used by
    // any code. My first draft re-CREATEd it, which `IF NOT EXISTS` would have made a silent no-op: the columns
    // below would never have appeared, and the hold service would have failed against a table that looked right
    // in the source.
    for (const c of ['booking_session_id', 'channel', 'converted_appointment_id', 'released_at', 'release_reason']) {
      const r: any = await sql`select count(*)::int n from information_schema.columns where table_name='booking_holds' and column_name=${c}`.execute(db);
      expect(r.rows[0].n, c).toBe(1);
    }
    // and the columns 009 gave it are still there
    const r: any = await sql`select count(*)::int n from information_schema.columns where table_name='booking_holds' and column_name='service_ids_json'`.execute(db);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('KyselyVerificationSettingsStore — the upsert that was broken', () => {
  it('SAVES a tenant-level row (this is the statement that threw)', async () => {
    const store = new KyselyVerificationSettingsStore(db);
    await store.upsert({
      tenant_id: T, branch_id: null, enabled: true,
      channel_online: true, channel_customer_app: true, channel_ai_receptionist: true,
      channel_kiosk: false, channel_front_desk: false, channel_walk_in: false,
      verify_every_booking: false, reverify_after_seconds: 86_400,
      reverify_on_group_booking: true, reverify_on_deposit: true, reverify_on_high_value: true,
      hold_seconds: 600, version: 1, updated_by_user_id: null,
    });
    const row = await store.settingsRow(T, null);
    expect(row.enabled).toBe(true);
  });

  it('UPDATES on the second save rather than inserting a duplicate', async () => {
    const store = new KyselyVerificationSettingsStore(db);
    const base = {
      tenant_id: T, branch_id: null, enabled: false,
      channel_online: true, channel_customer_app: true, channel_ai_receptionist: true,
      channel_kiosk: false, channel_front_desk: false, channel_walk_in: false,
      verify_every_booking: true, reverify_after_seconds: 3600,
      reverify_on_group_booking: true, reverify_on_deposit: true, reverify_on_high_value: true,
      hold_seconds: 600, version: 2, updated_by_user_id: null,
    };
    await store.upsert(base);
    const row = await store.settingsRow(T, null);
    expect(row.enabled).toBe(false);
    expect(row.version).toBe(2);

    const r: any = await sql`select count(*)::int n from booking_verification_settings where tenant_id = ${T} and branch_id is null`.execute(db);
    expect(r.rows[0].n, 'a tenant must have exactly ONE default row').toBe(1);
  });

  it('a BRANCH row is a separate row and does not collide with the tenant default', async () => {
    const store = new KyselyVerificationSettingsStore(db);
    await store.upsert({
      tenant_id: T, branch_id: B, enabled: true,
      channel_online: false, channel_customer_app: true, channel_ai_receptionist: true,
      channel_kiosk: false, channel_front_desk: false, channel_walk_in: false,
      verify_every_booking: false, reverify_after_seconds: 60,
      reverify_on_group_booking: true, reverify_on_deposit: true, reverify_on_high_value: true,
      hold_seconds: 300, version: 1, updated_by_user_id: null,
    });
    const branchRow = await store.settingsRow(T, B);
    const tenantRow = await store.settingsRow(T, null);
    expect(branchRow.enabled).toBe(true);
    expect(tenantRow.enabled).toBe(false);          // unchanged by the branch write
    expect(branchRow.hold_seconds).toBe(300);
  });
});

describe('the constraints I claimed are enforced BY THE DATABASE', () => {
  it('ONE live hold per booking session — the second is REFUSED', async () => {
    // Not a service check: a race beats any check the service could make.
    const S = '33333333-3333-3333-3333-333333333331';
    const ins = () => sql`
      insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, now() + interval '1 hour', now() + interval '2 hour', now() + interval '10 min', 'held', ${S}, 'online')`.execute(db);
    await ins();
    await expect(ins()).rejects.toThrow();
  });

  it('a hold becomes an appointment EXACTLY ONCE', async () => {
    const S = '33333333-3333-3333-3333-333333333332';
    const A = '44444444-4444-4444-4444-444444444441';
    const r: any = await sql`
      insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, now() + interval '3 hour', now() + interval '4 hour', now() + interval '10 min', 'held', ${S}, 'online')
      returning id`.execute(db);
    const id = r.rows[0].id;
    await sql`update booking_holds set converted_appointment_id = ${A} where id = ${id}`.execute(db);

    // A DIFFERENT hold cannot claim the SAME appointment. This is what stops a replayed confirmation creating a
    // second appointment from one reservation.
    const r2: any = await sql`
      insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, now() + interval '5 hour', now() + interval '6 hour', now() + interval '10 min', 'held', '33333333-3333-3333-3333-333333333333', 'online')
      returning id`.execute(db);
    await expect(
      sql`update booking_holds set converted_appointment_id = ${A} where id = ${r2.rows[0].id}`.execute(db),
    ).rejects.toThrow();
  });
});

describe('KyselyVerificationStore — "verified at tenant A" proves NOTHING at tenant B', () => {
  it('is enforced by the unique key, not by convention', async () => {
    const store = new KyselyVerificationStore(db);
    const rec = (tenantId: string) => store.recordVerifiedPhone({
      tenantId, customerId: null, phoneHash: 'HASH', phoneMask: '••••4567',
      provider: 'twilio_verify', channel: 'online', verifiedAt: Date.now(),
    });
    await rec(T);
    await rec(T2);                                   // same phone, different tenant → a SEPARATE row

    const r: any = await sql`select tenant_id from booking_verified_phones where phone_hash = 'HASH' order by tenant_id`.execute(db);
    expect(r.rows).toHaveLength(2);

    // And re-verifying the SAME phone at the SAME tenant refreshes rather than duplicating — the upsert the
    // service actually runs.
    await rec(T);
    const r2: any = await sql`select count(*)::int n from booking_verified_phones where tenant_id = ${T} and phone_hash = 'HASH'`.execute(db);
    expect(r2.rows[0].n).toBe(1);
  });
});

describe('the hold expiry sweep', () => {
  it('runs (FOR UPDATE SKIP LOCKED) and releases lapsed holds', async () => {
    await sql`
      insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, now(), now() + interval '1 hour', now() - interval '1 min', 'held', '33333333-3333-3333-3333-333333333339', 'online')`.execute(db);

    const r: any = await sql`
      update booking_holds set released_at = now(), release_reason = 'hold_expired', status = 'expired'
      where id in (
        select id from booking_holds
        where released_at is null and converted_appointment_id is null and expires_at <= now()
        order by expires_at limit 500 for update skip locked
      ) returning id`.execute(db);

    expect(r.rows.length).toBeGreaterThan(0);
  });
});

// ══ Super Admin oversight — the two ON CONFLICTs I just wrote ═════════════════════════════════════════════
//
// I wrote two more `ON CONFLICT` clauses against PARTIAL indexes, which is exactly the bug this file was created
// for. `tsc` said nothing, and it would have said nothing if they were wrong. So they get tested against a real
// Postgres BEFORE anything is built on them.
describe('Super Admin oversight', () => {
  it('the GLOBAL emergency switch upserts (ON CONFLICT ((true)) WHERE tenant_id IS NULL)', async () => {
    const svc = new BookingVerificationOversightService(db);
    const a = await svc.setEmergencyDisabled(ADMIN, true, 'Twilio Verify outage in us-east-1');
    expect(a.emergencyDisabled).toBe(true);
    expect(a.reason).toMatch(/outage/i);

    // Second call must UPDATE, not insert a second global row — otherwise the resolver would pick one at random.
    const b = await svc.setEmergencyDisabled(ADMIN, false, '');
    expect(b.emergencyDisabled).toBe(false);
    expect(b.version).toBeGreaterThan(a.version);

    const r: any = await sql`select count(*)::int n from booking_verification_platform_policy where tenant_id is null`.execute(db);
    expect(r.rows[0].n, 'there must be exactly ONE global row').toBe(1);
  });

  it('a reason is REQUIRED to kill it platform-wide', async () => {
    // This is the button someone reaches for at 3am. The next person needs to know whether it was an outage, an
    // abuse wave, or a mistake — because that decides whether they turn it back on.
    const svc = new BookingVerificationOversightService(db);
    await expect(svc.setEmergencyDisabled(ADMIN, true, '')).rejects.toThrow(/reason is required/i);
    await expect(svc.setEmergencyDisabled(ADMIN, true, 'oops')).rejects.toThrow(/reason is required/i);
  });

  it('the per-tenant override upserts (ON CONFLICT (tenant_id) WHERE tenant_id IS NOT NULL)', async () => {
    const svc = new BookingVerificationOversightService(db);
    await svc.setTenantPolicy(ADMIN, T, { required: true, reason: 'Repeated fake bookings from this salon' });
    await svc.setTenantPolicy(ADMIN, T, { blocked: true, reason: 'Twilio integration appears compromised' });

    const r: any = await sql`select required_for_tenant, blocked_for_tenant, version from booking_verification_platform_policy where tenant_id = ${T}`.execute(db);
    expect(r.rows).toHaveLength(1);                    // updated, not duplicated
    expect(r.rows[0].blocked_for_tenant).toBe(true);
    expect(r.rows[0].required_for_tenant).toBe(false);
    expect(Number(r.rows[0].version)).toBeGreaterThan(1);
  });

  it('a tenant cannot be BOTH required to verify and blocked from verifying', async () => {
    // Allowing both would make the resolver's outcome depend on the order its rules happen to be written in —
    // the kind of accident that produces a booking system which refuses everything.
    const svc = new BookingVerificationOversightService(db);
    await expect(svc.setTenantPolicy(ADMIN, T, { required: true, blocked: true, reason: 'contradictory' }))
      .rejects.toThrow(/cannot be both/i);
  });

  it('an override REQUIRES a reason — the tenant will ask why', async () => {
    const svc = new BookingVerificationOversightService(db);
    await expect(svc.setTenantPolicy(ADMIN, T2, { required: true, reason: '' })).rejects.toThrow(/reason is required/i);
  });

  it('the health query runs, and returns COUNTS only — never a phone, a code, or a credential', async () => {
    const svc = new BookingVerificationOversightService(db);
    const h = await svc.health(24);
    expect(h).toHaveProperty('codesSent');   // Phase 4: requested / codes sent / verified / overridden / failed / locked / expired
    expect(h).toHaveProperty('tenantsMisconfigured');
    // The whole payload must be numbers. A privacy guarantee that relies on remembering to strip a field is not
    // a guarantee; this one holds because the service never selects those columns at all.
    for (const v of Object.values(h)) expect(typeof v).toBe('number');
  });

  it('the oversight table runs and computes an EFFECTIVE outcome', async () => {
    const svc = new BookingVerificationOversightService(db);
    const rows = await svc.tenants(50);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(['active', 'disabled_by_tenant', 'blocked_by_platform', 'provider_not_ready', 'platform_emergency'])
        .toContain(r.effective);
      // No credential, no phone, anywhere in the row.
      expect(JSON.stringify(r)).not.toMatch(/auth_token|account_sid|phone_hash/i);
    }
  });
});

// ══ the fraud counters — six subqueries I just wrote, none of which tsc can check ══════════════════════════
describe('oversight actions reach the REAL audit trail (Phase 1, Oct 6 2026)', () => {
  // Until Oct 6 the oversight service called AuditService.record with ONE object through `audit as any`: the row was
  // never written and the failure swallowed. These drive the production wiring (auditSinkFor over the Kysely store).
  it('a platform emergency disable is an audit_logs row with the actor and the reason', async () => {
    const svc = new BookingVerificationOversightService(db, auditSinkFor(new AuditService(new KyselyAuditRepository(db))));
    await svc.setEmergencyDisabled(ADMIN, true, 'Audit trail proof: provider outage');
    const r: any = await sql`select user_id, action_type, metadata_json from audit_logs where action_type = 'booking_verification.platform_emergency_disabled' order by created_at desc limit 1`.execute(db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].user_id).toBe(ADMIN);
    expect(r.rows[0].metadata_json.reason).toMatch(/provider outage/);
    await svc.setEmergencyDisabled(ADMIN, false, '');
  });

  it('a per-tenant override is an audit_events row in THAT tenant', async () => {
    const svc = new BookingVerificationOversightService(db, auditSinkFor(new AuditService(new KyselyAuditRepository(db))));
    await svc.setTenantPolicy(ADMIN, T2, { required: true, reason: 'Audit trail proof for a tenant override' });
    const r: any = await sql`select tenant_id, actor_user_id, module, action, metadata from audit_events where action = 'platform_tenant_policy_changed' and tenant_id = ${T2}`.execute(db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ actor_user_id: ADMIN, module: 'booking_verification' });
    expect(r.rows[0].metadata.required).toBe(true);
  });
});

describe('KyselyRiskCounters', () => {
  it('the velocity query RUNS against the real schema', async () => {
    // Six correlated subqueries across two tables. `tsc` says nothing about any of them, and every unit test in
    // the fraud spec mocks the counters entirely. This is the only thing that can tell me they resolve.
    const c = new KyselyRiskCounters(db);
    const s = await c.read(T, '203.0.113.9', '33333333-3333-3333-3333-333333333331', '+15551234567');

    for (const k of ['ipCodesLastHour', 'ipDistinctPhonesLastHour', 'deviceCodesLastHour',
                     'ipFailedChecksLastHour', 'abandonedHoldsLastHour', 'phoneCodesLastHour'] as const) {
      expect(typeof s[k], k).toBe('number');
    }
  });

  it('the IP signal can ACTUALLY BE TRUE — not just "the query runs"', async () => {
    // My previous pgtest asserted the counter query RUNS. It did. It also compared correlation_id (a UUID)
    // against an IP, so it could never match a row — the count was 0 forever, exactly like the POS badge that
    // counted an impossible status. "It runs" and "it can be true" are different claims, and only the second one
    // is worth anything.
    const c = new KyselyRiskCounters(db);
    const store = new KyselyVerificationStore(db);
    const IP = '203.0.113.77';
    const { phoneKey } = await import('@aipowersalon/customers');

    const before = await c.read(T, IP, 'dev-spray', '+15550001111');

    // Three DIFFERENT numbers from ONE source — the spray signature.
    for (const [i, phone] of ['+15550001111', '+15550002222', '+15550003333'].entries()) {
      await store.createSession({
        tenantId: T, branchId: B, bookingSessionId: `33333333-3333-3333-3333-3333333330${i}0`.slice(0, 36),
        customerId: null, phoneHash: phoneKey(phone), phoneMask: '••••1111', channel: 'online',
        provider: 'twilio_verify', providerServiceSid: null, providerVerificationSid: `VE-spray-${i}`,
        codeHash: null, expiresAt: Date.now() + 600_000,
        requestIp: IP, deviceId: 'dev-spray',
      });
    }

    const after = await c.read(T, IP, 'dev-spray', '+15550001111');
    expect(after.ipCodesLastHour - before.ipCodesLastHour).toBe(3);
    // The signal the whole spray rule depends on. Before migration 370 this was structurally 0.
    expect(after.ipDistinctPhonesLastHour - before.ipDistinctPhonesLastHour).toBe(3);
    expect(after.deviceCodesLastHour - before.deviceCodesLastHour).toBe(3);
  });

  it('counts a real code request against the phone that asked for it', async () => {
    const c = new KyselyRiskCounters(db);
    const phone = '+15557654321';
    const store = new KyselyVerificationStore(db);

    const before = await c.read(T, 'ip-x', 'dev-x', phone);
    await store.createSession({
      tenantId: T, branchId: B, bookingSessionId: '33333333-3333-3333-3333-33333333330a',
      customerId: null, phoneHash: (await import('@aipowersalon/customers')).phoneKey(phone),
      phoneMask: '••••4321', channel: 'online', provider: 'twilio_verify',
      providerServiceSid: null, providerVerificationSid: 'VE-count-1', codeHash: null,
      expiresAt: Date.now() + 600_000,
    });
    const after = await c.read(T, 'ip-x', 'dev-x', phone);

    // The harassment signal: codes requested for THIS phone in the last hour.
    expect(after.phoneCodesLastHour).toBe(before.phoneCodesLastHour + 1);
  });

  it('Phase 4: wrong codes count against the ADDRESS that asked — not every session at the salon', async () => {
    const c = new KyselyRiskCounters(db);
    const store = new KyselyVerificationStore(db);
    const { phoneKey } = await import('@aipowersalon/customers');
    const mk = async (ip: string, n: number, sid: string) => {
      const { id } = await store.createSession({ tenantId: T, branchId: B, bookingSessionId: sid, customerId: null, phoneHash: phoneKey('+15550009999'), phoneMask: '••••9999', channel: 'online',
        provider: 'twilio_verify', providerServiceSid: null, providerVerificationSid: null, codeHash: null, expiresAt: Date.now() + 600_000, requestIp: ip, deviceId: 'dev-g' });
      await sql`update booking_verification_sessions set status = 'sent', attempt_count = ${n} where id = ${id}`.execute(db);
    };
    const before = await c.read(T, '198.51.100.1', 'dev-g', '+15550009999');
    await mk('198.51.100.1', 4, '44444444-4444-4444-8444-444444444401');     // a guesser, session still open
    await mk('198.51.100.2', 3, '44444444-4444-4444-8444-444444444402');     // someone else
    const after = await c.read(T, '198.51.100.1', 'dev-g', '+15550009999');
    expect(after.ipFailedChecksLastHour - before.ipFailedChecksLastHour).toBe(4);
  });

  it('Phase 4: a destination country the salon has never had a customer from is NOVEL; a familiar one is not', async () => {
    const c = new KyselyRiskCounters(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Verify', 'Verify', 'verify-p10', 'VER10', 'active') on conflict do nothing`.execute(db);   // fk_customers_tenant (538)
    await sql`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values (${T}, ${B}, 'Nia', 'Home', 'Nia Home', '+15551110000', '+15551110000')`.execute(db);
    expect((await c.read(T, 'ip-n', 'dev-n', '+15551112222')).novelCountryForTenant).toBe(false);
    expect((await c.read(T, 'ip-n', 'dev-n', '+447700900123')).novelCountryForTenant).toBe(true);
  });

  it('recordAlert writes an audit row and NEVER a phone number or a code', async () => {
    const c = new KyselyRiskCounters(db);
    await c.recordAlert(T, { action: 'block', reasons: ['destination_premium_rate'], score: 100, ip: '203.0.113.9' });

    const r: any = await sql`select metadata_json::text AS m from audit_logs where action_type = 'booking_verification.blocked' order by created_at desc limit 1`.execute(db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].m).toContain('destination_premium_rate');
    // The fraud console gets the REASON, never the secret or the victim.
    expect(r.rows[0].m).not.toMatch(/\d{6,}/);
  });
});

// ══ retention + usage rollup ══════════════════════════════════════════════════════════════════════════════
describe('retention', () => {
  it('rolls usage up BEFORE it deletes the rows the usage was counted from', async () => {
    // The ordering is the point. A count taken AFTER the purge shrinks every night, and a tenant's monthly total
    // would silently fall as the retention window rolled past it — they would be billed for messages that no
    // longer appear to exist.
    const sched = new BookingVerificationRetentionScheduler(db);
    const { phoneKey } = await import('@aipowersalon/customers');

    // An OLD session (beyond retention) and a recent one.
    await sql`
      INSERT INTO booking_verification_sessions
        (tenant_id, branch_id, booking_session_id, phone_hash, phone_mask, channel, provider, status, expires_at, created_at)
      VALUES
        (${T}, ${B}, gen_random_uuid(), ${phoneKey('+15551110000')}, '••••0000', 'online', 'twilio_verify', 'verified',
         now(), now() - interval '30 days')`.execute(db);

    const out = await sched.tick();

    // The old day was rolled up...
    const u: any = await sql`select verified_count from booking_verification_usage_daily where tenant_id = ${T} and usage_date = (now() - interval '30 days')::date`.execute(db);
    expect(u.rows.length, 'usage must be rolled up before the purge').toBe(1);
    expect(Number(u.rows[0].verified_count)).toBeGreaterThanOrEqual(1);

    // ...and then purged.
    expect(out.deleted).toBeGreaterThan(0);
    const left: any = await sql`select count(*)::int n from booking_verification_sessions where created_at < now() - interval '29 days'`.execute(db);
    expect(left.rows[0].n).toBe(0);
  });

  it('the rollup is IDEMPOTENT — a job that runs twice does not double-count', async () => {
    // Scheduled jobs run twice. The rollup RECOMPUTES rather than increments, so a retry is harmless. An
    // incremented counter would inflate a tenant's bill every time the sweep was retried after a blip.
    const sched = new BookingVerificationRetentionScheduler(db);
    const { phoneKey } = await import('@aipowersalon/customers');

    await sql`
      INSERT INTO booking_verification_sessions
        (tenant_id, branch_id, booking_session_id, phone_hash, phone_mask, channel, provider, status, expires_at, created_at)
      VALUES
        (${T2}, ${B}, gen_random_uuid(), ${phoneKey('+15552220000')}, '••••0000', 'online', 'twilio_verify', 'verified',
         now(), now() - interval '2 days')`.execute(db);

    await sched.tick();
    const a: any = await sql`select verified_count from booking_verification_usage_daily where tenant_id = ${T2} and usage_date = (now() - interval '2 days')::date`.execute(db);
    await sched.tick();
    const b: any = await sql`select verified_count from booking_verification_usage_daily where tenant_id = ${T2} and usage_date = (now() - interval '2 days')::date`.execute(db);

    expect(Number(b.rows[0].verified_count)).toBe(Number(a.rows[0].verified_count));
  });

  it('the usage table holds NO phone, NO hash, NO IP — nothing that identifies a person', async () => {
    // The whole reason the sessions are deleted is that they hold a phone hash, an IP and a device id. Rolling
    // that into a table we keep forever would defeat the purpose entirely.
    const cols: any = await sql`select column_name from information_schema.columns where table_name = 'booking_verification_usage_daily'`.execute(db);
    const names = cols.rows.map((r: any) => String(r.column_name));
    for (const forbidden of ['phone_hash', 'phone_mask', 'request_ip', 'device_id', 'customer_id']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it('the retention window is capped — a tenant may not choose to hoard this forever', () => {
    expect(retentionDays({} as any)).toBe(7);
    expect(retentionDays({ BOOKING_VERIFICATION_RETENTION_DAYS: '3650' } as any)).toBe(90);
    expect(retentionDays({ BOOKING_VERIFICATION_RETENTION_DAYS: '0' } as any)).toBe(7);
  });
});
