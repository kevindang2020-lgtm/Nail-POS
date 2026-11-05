import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  const files = readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  for (const f of files) {
    // CREATE EXTENSION is stripped (PGlite ships no pgcrypto; gen_random_uuid is core since PG13) and the
    // EARLIER migrations are tolerant, exactly as tenant-isolation.pgtest is — pg_trgm/btree_gist indexes are
    // not what this test is about.
    //
    // 376 is NOT tolerant. It runs outside the try/catch, so if the migration this session added does not apply
    // to a real Postgres engine, this suite fails LOUDLY instead of quietly testing a schema that never built.
    const sql = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    if (f.startsWith('376')) await pg.exec(sql);
    else try { await pg.exec(sql); } catch { /* pg_trgm / btree_gist */ }
  }
}, 180000);

describe('migration 376 applies to a REAL Postgres engine', () => {
  it('the permanent id column exists, is NOT NULL, and is unique', async () => {
    const c: any = await pg.query(`select column_name, is_nullable from information_schema.columns
      where table_name='global_tech_profiles' and column_name in
      ('tech_code','phone_hash','email_normalized','normalized_phone','status','anonymized_at')`);
    expect(c.rows.map((r: any) => r.column_name).sort()).toEqual(
      ['anonymized_at','email_normalized','normalized_phone','phone_hash','status','tech_code']);
    expect(c.rows.find((r: any) => r.column_name === 'tech_code').is_nullable).toBe('NO');
  });

  it('users links UP to the global profile', async () => {
    const c: any = await pg.query(`select 1 from information_schema.columns
      where table_name='users' and column_name='global_tech_profile_id'`);
    expect(c.rows.length).toBe(1);
  });

  it('the sequence hands out codes that are never reused', async () => {
    const a: any = await pg.query(`select nextval('global_tech_code_seq') as n`);
    const b: any = await pg.query(`select nextval('global_tech_code_seq') as n`);
    expect(Number(b.rows[0].n)).toBe(Number(a.rows[0].n) + 1);
  });

  it('the CHECK constraint accepts all 9 employment statuses and REFUSES an invented one', async () => {
    const t: any = await pg.query(`insert into tenants (legal_name, display_name, tenant_slug, tenant_code, status)
      values ('L','L','l','L1','active') returning id`);
    const p: any = await pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name)
      values ('TECH-900001','x-1','X') returning id`);
    for (const s of ['pending_invite','pending_tech_approval','pending_salon_approval','active','suspended','former','rejected','revoked','cancelled']) {
      await pg.query(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, status)
        values ($1,$2,$3,$4)`, [p.rows[0].id, t.rows[0].id, null, s]).catch((e) => { throw new Error(`${s} rejected: ${e.message}`); });
      await pg.query(`delete from tech_salon_memberships where global_tech_profile_id = $1`, [p.rows[0].id]);
    }
    await expect(pg.query(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, status)
      values ($1,$2,'deleted')`, [p.rows[0].id, t.rows[0].id])).rejects.toThrow();
  });

  it('TWO global profiles cannot share one phone hash — the dedupe is enforced by the DATABASE, not by hope', async () => {
    await pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name, phone_hash)
      values ('TECH-900002','y-1','Y','samehash')`);
    await expect(pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name, phone_hash)
      values ('TECH-900003','y-2','Y2','samehash')`)).rejects.toThrow();
  });

  it('an ANONYMIZED tombstone releases its phone but KEEPS its code — so the id is never reused', async () => {
    await pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name, phone_hash, status)
      values ('TECH-900004','z-1','Z','deadhash','anonymized')`);
    // a new hire on the same number is allowed — the tombstone does not block them
    await pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name, phone_hash)
      values ('TECH-900005','z-2','Z2','deadhash')`);
    // but the code is gone forever
    await expect(pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name)
      values ('TECH-900004','z-3','Z3')`)).rejects.toThrow();
  });

  it('one technician cannot have two logins at one salon', async () => {
    const t: any = await pg.query(`insert into tenants (legal_name, display_name, tenant_slug, tenant_code, status)
      values ('M','M','m','M1','active') returning id`);
    const p: any = await pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name)
      values ('TECH-900006','w-1','W') returning id`);
    await pg.query(`insert into users (tenant_id, role, status, global_tech_profile_id) values ($1,'TECHNICIAN','invited',$2)`, [t.rows[0].id, p.rows[0].id]);
    await expect(pg.query(`insert into users (tenant_id, role, status, global_tech_profile_id) values ($1,'TECHNICIAN','invited',$2)`,
      [t.rows[0].id, p.rows[0].id])).rejects.toThrow();
  });
});
