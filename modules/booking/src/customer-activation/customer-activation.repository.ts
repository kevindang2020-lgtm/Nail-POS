// customer-activation.repository.ts — persistence for first-time activation.
//
// Reuses the EXISTING tables throughout: `customers` (the salon's record of a person), `users` (the app account,
// role CUSTOMER), `tenants`, and `customer_phone_verifications` (the OTP store, extended by migration 364 to
// work pre-auth). No new customer table, no second OTP system, no duplicate account model.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { DirectoryMatch } from '@aipowersalon/customers';

export interface StoredCode {
  id: string;
  codeHash: string;
  expiresAt: number;
  consumed: boolean;
  attempts: number;
  createdAt: number;
}

export interface ActivationRepo {
  /** Directory lookup: every salon record for this phone. `customers` is tenant-scoped, so a phone may appear in
   *  several salons — that is a legitimate multi-salon customer, NOT a duplicate to be merged. */
  findByPhone(e164: string): Promise<DirectoryMatch[]>;
  storeCode(input: { phone: string; codeHash: string; expiresAt: Date; ip?: string | null; deviceId?: string | null }): Promise<void>;
  /** Newest live activation code for a phone (any state — the core decides). */
  latestCode(phone: string): Promise<StoredCode | null>;
  bumpAttempts(id: string): Promise<void>;
  consume(id: string): Promise<void>;
  /** Constitution 12 §112–114: ATOMICALLY claim one attempt on an unconsumed, unexpired code under `max`; one statement. */
  claimAttempt(id: string, max: number): Promise<boolean>;
  /** ATOMICALLY consume: true only for the ONE caller that flips it. */
  consumeOnce(id: string): Promise<boolean>;
  /** Invalidate any outstanding codes for this phone — a new code must retire the old one. */
  invalidateOutstanding(phone: string): Promise<void>;
  /** Find or create the CUSTOMER app account (a `users` row) for a resolved salon customer. Never duplicates. */
  linkAccount(match: DirectoryMatch, e164: string): Promise<{ userId: string; created: boolean } | null>;
  markPhoneVerified(match: DirectoryMatch): Promise<void>;
  /** How many codes this IP / device has requested in the last hour — throttles walking a list of numbers. */
  sourceCounts(ip: string | null, deviceId: string | null): Promise<{ ipLastHour: number; deviceLastHour: number }>;
}

const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => {
  try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; }
};
const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => {
  try { return (await q.execute(db)).rows as T[]; } catch { return []; }
};
const exec = async (db: AppDatabase, q: any): Promise<void> => { try { await q.execute(db); } catch { /* degrade */ } };

export class KyselyActivationRepo implements ActivationRepo {
  constructor(private readonly db: AppDatabase) {}

  async findByPhone(e164: string): Promise<DirectoryMatch[]> {
    const list = await rows<any>(this.db, sql`
      select c.id as customer_id, c.tenant_id, c.branch_id, c.status, c.archived_at,
             t.display_name as salon_name
      from customers c
      join tenants t on t.id = c.tenant_id
      where c.normalized_phone = ${e164}
        -- Phase 3 (audit E14): a number staff typed in WITHOUT an SMS (tenant policy, or a manager's manual
        -- confirmation) is not proof that whoever holds that phone is this customer — a mistyped digit would hand a
        -- stranger this customer's profile. It becomes a claim key once it is proved (an app or booking code).
        and not exists (select 1 from customer_phones p
                         where p.tenant_id = c.tenant_id and p.customer_id = c.id and p.normalized_phone = ${e164}
                           and p.status = 'active_unverified' and p.verification_provider = 'staff_override')
      order by c.created_at asc
      limit 20`);
    return list.map((r) => ({
      customerId: String(r.customer_id),
      tenantId: String(r.tenant_id),
      branchId: r.branch_id ?? null,
      salonName: String(r.salon_name ?? 'Salon'),
      inactive: !!r.archived_at || String(r.status ?? '').toLowerCase() === 'archived',
    }));
  }

  async storeCode(input: { phone: string; codeHash: string; expiresAt: Date; ip?: string | null; deviceId?: string | null }): Promise<void> {
    await exec(this.db, sql`
      insert into customer_phone_verifications
        (tenant_id, customer_id, purpose, normalized_phone, destination, code_hash, expires_at, ip_address, device_id)
      values (null, null, 'activation', ${input.phone}, ${input.phone}, ${input.codeHash}, ${input.expiresAt}, ${input.ip ?? null}, ${input.deviceId ?? null})`);
  }

  async latestCode(phone: string): Promise<StoredCode | null> {
    const r = await one<any>(this.db, sql`
      select id, code_hash, expires_at, consumed_at, attempts, created_at
      from customer_phone_verifications
      where purpose = 'activation' and normalized_phone = ${phone}
      order by created_at desc limit 1`, null);
    if (!r) return null;
    return {
      id: String(r.id),
      codeHash: String(r.code_hash),
      expiresAt: new Date(r.expires_at).getTime(),
      consumed: !!r.consumed_at,
      attempts: Number(r.attempts ?? 0),
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async bumpAttempts(id: string): Promise<void> {
    await exec(this.db, sql`update customer_phone_verifications set attempts = attempts + 1 where id = ${id}`);
  }

  // NOT through `exec`: that helper returns nothing and swallows every error, so these would always read "no rows"
  // (fail closed — every correct code refused) and a broken query would be indistinguishable from a lost race. An
  // error here is thrown to the caller, where it fails the verification loudly instead of silently.
  async claimAttempt(id: string, max: number): Promise<boolean> {
    const r: any = await sql`update customer_phone_verifications set attempts = attempts + 1
      where id = ${id} and consumed_at is null and expires_at > now() and attempts < ${max} returning id`.execute(this.db as any);
    return (r?.rows?.length ?? 0) === 1;
  }
  async consumeOnce(id: string): Promise<boolean> {
    const r: any = await sql`update customer_phone_verifications set consumed_at = now() where id = ${id} and consumed_at is null returning id`.execute(this.db as any);
    return (r?.rows?.length ?? 0) === 1;
  }
  async consume(id: string): Promise<void> {
    await exec(this.db, sql`update customer_phone_verifications set consumed_at = now() where id = ${id}`);
  }

  async invalidateOutstanding(phone: string): Promise<void> {
    // A newly issued code must retire any older one — otherwise two live codes exist for the same phone.
    await exec(this.db, sql`
      update customer_phone_verifications set consumed_at = now()
      where purpose = 'activation' and normalized_phone = ${phone} and consumed_at is null`);
  }

  /** Find the existing CUSTOMER app account for this salon customer, or create one. NEVER creates a second
   *  customer profile — the `customers` row already exists; this only ensures the login account exists. */
  async linkAccount(match: DirectoryMatch, e164: string): Promise<{ userId: string; created: boolean } | null> {
    const existing = await one<any>(this.db, sql`
      select id from users
      where tenant_id = ${match.tenantId} and role = 'CUSTOMER' and normalized_phone = ${e164}
      limit 1`, null);
    if (existing) return { userId: String(existing.id), created: false };

    const c = await one<any>(this.db, sql`
      select first_name, last_name, full_name, email, branch_id
      from customers where id = ${match.customerId} and tenant_id = ${match.tenantId}`, null);
    if (!c) return null;

    const created = await one<any>(this.db, sql`
      insert into users (tenant_id, branch_id, role, status, first_name, last_name, full_name, email, normalized_phone)
      values (${match.tenantId}, ${c.branch_id ?? match.branchId}, 'CUSTOMER', 'active',
              ${c.first_name ?? null}, ${c.last_name ?? null}, ${c.full_name ?? null}, ${c.email ?? null}, ${e164})
      returning id`, null);
    return created ? { userId: String(created.id), created: true } : null;
  }

  async markPhoneVerified(match: DirectoryMatch): Promise<void> {
    await exec(this.db, sql`
      update customers set phone_verified_at = now(), updated_at = now()
      where id = ${match.customerId} and tenant_id = ${match.tenantId}`);
  }

  async sourceCounts(ip: string | null, deviceId: string | null): Promise<{ ipLastHour: number; deviceLastHour: number }> {
    const r = await one<any>(this.db, sql`
      select
        (select count(*) from customer_phone_verifications
          where purpose = 'activation' and ${ip}::text is not null and ip_address = ${ip}
            and created_at > now() - interval '1 hour')::int as ip_count,
        (select count(*) from customer_phone_verifications
          where purpose = 'activation' and ${deviceId}::text is not null and device_id = ${deviceId}
            and created_at > now() - interval '1 hour')::int as device_count`, null);
    return { ipLastHour: Number(r?.ip_count ?? 0), deviceLastHour: Number(r?.device_count ?? 0) };
  }
}

/** In-memory repo for tests / no-DB dev. */
export class InMemoryActivationRepo implements ActivationRepo {
  matches: DirectoryMatch[] = [];
  codes: (StoredCode & { phone: string })[] = [];
  accounts = new Map<string, string>();     // `${tenantId}:${phone}` -> userId
  verified: DirectoryMatch[] = [];
  private n = 0;

  async findByPhone(_e164: string) { return this.matches.map((m) => ({ ...m })); }
  async storeCode(i: { phone: string; codeHash: string; expiresAt: Date }) {
    this.codes.push({ id: `code-${++this.n}`, phone: i.phone, codeHash: i.codeHash, expiresAt: i.expiresAt.getTime(), consumed: false, attempts: 0, createdAt: Date.now() });
  }
  async latestCode(phone: string) {
    const list = this.codes.filter((c) => c.phone === phone).sort((a, b) => b.createdAt - a.createdAt);
    return list[0] ? { ...list[0] } : null;
  }
  async bumpAttempts(id: string) { const c = this.codes.find((x) => x.id === id); if (c) c.attempts++; }
  async consume(id: string) { const c = this.codes.find((x) => x.id === id); if (c) c.consumed = true; }
  async claimAttempt(id: string, max: number) { const c = this.codes.find((x) => x.id === id); if (!c || c.consumed || c.expiresAt <= Date.now() || c.attempts >= max) return false; c.attempts++; return true; }
  async consumeOnce(id: string) { const c = this.codes.find((x) => x.id === id); if (!c || c.consumed) return false; c.consumed = true; return true; }
  async invalidateOutstanding(phone: string) { this.codes.filter((c) => c.phone === phone && !c.consumed).forEach((c) => { c.consumed = true; }); }
  async linkAccount(match: DirectoryMatch, e164: string) {
    const key = `${match.tenantId}:${e164}`;
    const existing = this.accounts.get(key);
    if (existing) return { userId: existing, created: false };
    const id = `user-${++this.n}`;
    this.accounts.set(key, id);
    return { userId: id, created: true };
  }
  async markPhoneVerified(match: DirectoryMatch) { this.verified.push(match); }
  counts = { ipLastHour: 0, deviceLastHour: 0 };
  async sourceCounts() { return { ...this.counts }; }
}
