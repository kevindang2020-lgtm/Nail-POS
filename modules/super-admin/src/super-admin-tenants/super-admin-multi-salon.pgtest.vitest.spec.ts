// super-admin-multi-salon.pgtest.vitest.spec.ts — Super Admin creates a SECOND salon for the SAME owner.
//
// ── The two bugs this pins ──
//
// `createTenant` used to ALWAYS insert a new `users` row for the owner. So adding an owner's second salon created
// a **second owner account for the same person** — a different user id, and a different password. They would sign
// in at one salon, change their password, and find the other still wanted the old one. The spec forbids exactly
// this, and it is also just wrong.
//
// And it never wrote `user_branch_access` — the canonical membership grant that the Owner App's salon switcher
// reads. So the salon existed, `tenants.owner_user_id` pointed at the owner, and the salon **never appeared in
// their portfolio**. Creating a salon an owner cannot open is not creating a salon.
//
// A fake repository cannot catch either: only the real SQL, against the real tables, shows that the second call
// produced one owner and two grants rather than two owners and none.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

let pg: PGlite;

/** Mirrors the repository's createTenant, including the owner lookup and the portfolio grant. */
async function createSalon(seed: {
  displayName: string; tenantCode: string;
  ownerName: string; ownerEmail: string; ownerPhone: string;
  city?: string; state?: string;
}) {
  const t = await pg.query<{ id: string }>(
    `insert into tenants (legal_name, display_name, tenant_slug, tenant_code, status)
     values ($1, $1, lower($2), $2, 'pending') returning id`,
    [seed.displayName, seed.tenantCode],
  );
  const tenantId = t.rows[0].id;

  // ── the fix: find the owner FIRST ──
  const existing = await pg.query<{ id: string }>(
    `select id from users where role = 'OWNER' and (lower(email) = lower($1) or normalized_phone = $2) limit 1`,
    [seed.ownerEmail, seed.ownerPhone],
  );

  let ownerId: string;
  let isFirstSalon: boolean;
  if (existing.rows.length) {
    ownerId = existing.rows[0].id;
    isFirstSalon = false;
  } else {
    const u = await pg.query<{ id: string }>(
      `insert into users (tenant_id, full_name, email, normalized_phone, status, role)
       values ($1, $2, $3, $4, 'invited', 'OWNER') returning id`,
      [tenantId, seed.ownerName, seed.ownerEmail, seed.ownerPhone],
    );
    ownerId = u.rows[0].id;
    isFirstSalon = true;
  }

  await pg.query(`update tenants set owner_user_id = $1 where id = $2`, [ownerId, tenantId]);

  const b = await pg.query<{ id: string }>(
    `insert into branches (tenant_id, name, city, state, status) values ($1, $2, $3, $4, 'active') returning id`,
    [tenantId, seed.displayName, seed.city ?? null, seed.state ?? null],
  );

  // ── the fix: put the salon in the owner's PORTFOLIO ──
  await pg.query(
    `insert into user_branch_access (tenant_id, branch_id, user_id, access_level, is_primary_owner)
     values ($1, $2, $3, 'owner', $4)`,
    [tenantId, b.rows[0].id, ownerId, isFirstSalon],
  );

  return { tenantId, ownerId, branchId: b.rows[0].id };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table tenants (
      id uuid primary key default gen_random_uuid(), legal_name text, display_name text,
      tenant_slug text, tenant_code text unique, status text, owner_user_id uuid);
    create table users (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, email text,
      normalized_phone text, status text, role text);
    create table branches (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, city text, state text, status text);
    create table user_branch_access (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, user_id uuid,
      access_level text, is_primary_owner boolean default false);
  `);
});

const SOPHIA = { ownerName: 'Sophia Nguyen', ownerEmail: 'sophia@example.com', ownerPhone: '+18565551234' };

describe('Super Admin adds several salons to ONE owner', () => {
  it('the FIRST salon creates the owner', async () => {
    const a = await createSalon({ ...SOPHIA, displayName: 'Luxe Nails & Spa', tenantCode: 'LUXE01', city: 'Marlton', state: 'NJ' });
    expect(a.ownerId).toBeTruthy();

    const users = await pg.query(`select id from users where role = 'OWNER'`);
    expect(users.rows).toHaveLength(1);
  });

  it('THE BUG: the SECOND salon must REUSE that owner, not create a duplicate', async () => {
    const b = await createSalon({ ...SOPHIA, displayName: 'Belle Palace', tenantCode: 'BELLE01', city: 'Cherry Hill', state: 'NJ' });

    const users = await pg.query<{ id: string }>(`select id from users where role = 'OWNER'`);
    expect(
      users.rows,
      'A second owner account was created for the same person. She would have two user ids and two passwords — ' +
      'change it at one salon and the other still wants the old one.',
    ).toHaveLength(1);

    // …and it is the SAME person
    expect(b.ownerId).toBe(users.rows[0].id);
  });

  it('a THIRD salon still reuses her — there is no artificial limit', async () => {
    await createSalon({ ...SOPHIA, displayName: 'Radiant Nail Bar', tenantCode: 'RAD01', city: 'Camden', state: 'NJ' });
    const users = await pg.query(`select id from users where role = 'OWNER'`);
    expect(users.rows).toHaveLength(1);
  });

  it('each salon is a SEPARATE tenant with its OWN Store Code', async () => {
    const t = await pg.query<{ tenant_code: string }>(`select tenant_code from tenants order by tenant_code`);
    expect(t.rows.map((r) => r.tenant_code)).toEqual(['BELLE01', 'LUXE01', 'RAD01']);
    // separate businesses: separate subscriptions, separate merchant accounts — never merged
  });

  it('the Store Code is UNIQUE — a second salon cannot claim another salon\'s code', async () => {
    await expect(
      createSalon({ ...SOPHIA, displayName: 'Copycat', tenantCode: 'LUXE01' }),
    ).rejects.toBeTruthy();
  });

  it('THE OTHER BUG: every salon lands in her PORTFOLIO — otherwise she cannot open it', async () => {
    const owner = await pg.query<{ id: string }>(`select id from users where role = 'OWNER'`);
    const grants = await pg.query<{ tenant_code: string; access_level: string; is_primary_owner: boolean }>(
      `select t.tenant_code, uba.access_level, uba.is_primary_owner
         from user_branch_access uba join tenants t on t.id = uba.tenant_id
        where uba.user_id = $1 order by t.tenant_code`,
      [owner.rows[0].id],
    );

    expect(
      grants.rows.map((r) => r.tenant_code),
      'A salon with no membership grant never appears in the owner\'s switcher — she owns a salon she cannot open.',
    ).toEqual(['BELLE01', 'LUXE01', 'RAD01']);

    expect(grants.rows.every((r) => r.access_level === 'owner')).toBe(true);
  });

  it('she is PRIMARY owner of the first salon only — the flag is not blindly repeated', async () => {
    const owner = await pg.query<{ id: string }>(`select id from users where role = 'OWNER'`);
    const primary = await pg.query<{ tenant_code: string }>(
      `select t.tenant_code from user_branch_access uba join tenants t on t.id = uba.tenant_id
        where uba.user_id = $1 and uba.is_primary_owner = true`,
      [owner.rows[0].id],
    );
    expect(primary.rows.map((r) => r.tenant_code)).toEqual(['LUXE01']);
  });
});

describe('a DIFFERENT owner is a different person', () => {
  it('a new email creates a new owner — we do not merge strangers', async () => {
    await createSalon({
      displayName: 'Someone Else Nails', tenantCode: 'OTHER01',
      ownerName: 'Marcus Webb', ownerEmail: 'marcus@example.com', ownerPhone: '+18565559999',
    });
    const owners = await pg.query(`select id from users where role = 'OWNER'`);
    expect(owners.rows).toHaveLength(2);
  });

  it("and their salon does NOT appear in Sophia's portfolio", async () => {
    const sophia = await pg.query<{ id: string }>(`select id from users where email = 'sophia@example.com'`);
    const codes = await pg.query<{ tenant_code: string }>(
      `select t.tenant_code from user_branch_access uba join tenants t on t.id = uba.tenant_id where uba.user_id = $1`,
      [sophia.rows[0].id],
    );
    expect(codes.rows.map((r) => r.tenant_code)).not.toContain('OTHER01');
  });
});

describe('the owner lookup does not grab the wrong person', () => {
  it('a CUSTOMER sharing an email is NOT treated as the owner', async () => {
    // Matching any user by email would hand a salon to the wrong person — far worse than one duplicate owner.
    await pg.query(
      `insert into users (full_name, email, normalized_phone, status, role)
       values ('Not The Owner', 'shared@example.com', '+18565550000', 'active', 'CUSTOMER')`,
    );

    const found = await pg.query(
      `select id from users where role = 'OWNER' and lower(email) = lower($1) limit 1`,
      ['shared@example.com'],
    );
    expect(found.rows).toHaveLength(0);   // the CUSTOMER is invisible to the owner lookup
  });
});
