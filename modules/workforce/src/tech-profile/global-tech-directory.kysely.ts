// global-tech-directory.kysely.ts — the ONLY cross-tenant reads in the technician identity system.
//
// CROSS-TENANT BY DESIGN: a technician is ONE person who may work at several salons. The question "does this
// human already have an AIPowerSalon technician account?" cannot be answered from inside one tenant — that is
// the entire point of a global identity. Same shape as owner-portfolio.repository.ts: allowed to cross tenants
// for exactly one question, and no others.
//
// This file is deliberately TINY, and that is the whole design.
//
// check:tenant grants its exemption per FILE. The last time a broad exemption existed — customer-phone/ got one
// because a single controller in that directory was super-admin — a real cross-tenant customer read sailed
// straight through it, and the planted-leak test caught what the checker had waved past. So this exemption buys
// three SELECTs and nothing else:
//
//     1. find a global profile by its global keys        (global_tech_profiles — has no tenant_id at all)
//     2. read one global profile by id                   (same)
//     3. which salons is this profile ACTIVE at          (tech_salon_memberships — the one genuinely exempt query)
//     4. which salons already hold an OPEN relationship   (memberships not yet active / roster rows — compared, never listed)
//
// Every WRITE — the users row, the membership, the technicians link — lives in global-tech-identity.service.ts,
// which carries NO exemption and is therefore still fully guarded by check:tenant.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { ExistingProfile, GlobalProfileRow, IdentityKeys } from './global-tech-identity-core';

@Injectable()
export class GlobalTechDirectory {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}

  get available(): boolean { return !!this.db; }

  /**
   * Find the technician's existing global account by the keys that identify a HUMAN, not an employee.
   *
   * Phone wins over email, deliberately. A salon's own email address gets typed into a lot of staff records
   * (`frontdesk@luxenails.com`), and two technicians sharing an employer's email must not collapse into one
   * person. Nobody shares a mobile number with a colleague by accident.
   *
   * An anonymized profile is a tombstone whose keys were released; it is skipped here so a deleted technician
   * can never be resurrected by a new hire who happens to reuse their phone number.
   */
  async findByKeys(keys: IdentityKeys): Promise<ExistingProfile | null> {
    if (!this.db) return null;

    if (keys.phoneHash) {
      const r: any = await sql`
        select id, tech_code, display_name, status, merged_into_profile_id
          from global_tech_profiles
         where phone_hash = ${keys.phoneHash} and status <> 'anonymized'
         order by (status = 'merged') asc, created_at asc
         limit 1`.execute(this.db).catch(() => null);
      const row = r?.rows?.[0];
      if (row) return this.canonical(row, 'phone');
    }

    if (keys.emailNormalized) {
      const r: any = await sql`
        select id, tech_code, display_name, status, merged_into_profile_id
          from global_tech_profiles
         where email_normalized = ${keys.emailNormalized} and status <> 'anonymized'
         order by (status = 'merged') asc, created_at asc
         limit 1`.execute(this.db).catch(() => null);
      const row = r?.rows?.[0];
      if (row) return this.canonical(row, 'email');
    }

    return null;
  }

  /**
   * A MERGED profile is a signpost, not a person. The merge releases its keys, but a row merged before that rule
   * existed — or one whose keys were restored by hand — can still match. Follow `merged_into_profile_id` to the
   * account that survived (bounded, so a cycle in bad data cannot hang the lookup) and answer with THAT.
   */
  private async canonical(row: any, matchedOn: 'phone' | 'email'): Promise<ExistingProfile | null> {
    let cur = row;
    for (let hops = 0; hops < 5 && String(cur.status) === 'merged' && cur.merged_into_profile_id; hops++) {
      const r: any = await sql`
        select id, tech_code, display_name, status, merged_into_profile_id
          from global_tech_profiles where id = ${cur.merged_into_profile_id} limit 1`.execute(this.db!).catch(() => null);
      if (!r?.rows?.length) break;
      cur = r.rows[0];
    }
    if (String(cur.status) === 'anonymized') return null;   // the chain ended at a tombstone
    return { profileId: String(cur.id), techCode: String(cur.tech_code), displayName: String(cur.display_name), status: cur.status, matchedOn };
  }

  /** The full global row + the salons it is ACTIVE at. Shaped for a manager by managerLookupView(), never raw. */
  async loadRow(profileId: string): Promise<GlobalProfileRow | null> {
    if (!this.db) return null;
    const r: any = await sql`
      select id, tech_code, display_name, avatar_url, years_experience, overall_rating, rating_count,
             portfolio_photo_count, status, normalized_phone, email_normalized
        from global_tech_profiles where id = ${profileId} limit 1`.execute(this.db).catch(() => null);
    const p = r?.rows?.[0];
    if (!p) return null;
    return {
      profileId: String(p.id),
      techCode: String(p.tech_code),
      displayName: String(p.display_name ?? ''),
      avatarUrl: p.avatar_url ?? null,
      yearsExperience: p.years_experience == null ? null : Number(p.years_experience),
      overallRating: p.overall_rating == null ? null : Number(p.overall_rating),
      ratingCount: Number(p.rating_count ?? 0),
      portfolioPhotoCount: Number(p.portfolio_photo_count ?? 0),
      status: p.status,
      normalizedPhone: p.normalized_phone ?? null,
      emailNormalized: p.email_normalized ?? null,
      activeTenantIds: await this.activeTenantIds(profileId),
      openTenantIds: await this.openTenantIds(profileId),
    };
  }

  /**
   * Salons that already HAVE this technician in some non-ended state — a pending invite or approval, a paused or
   * suspended membership, or a live roster row carrying the profile — but not 'active'. Same disclosure rule as
   * activeTenantIds: the caller may only ever compare, never list.
   */
  async openTenantIds(profileId: string): Promise<string[]> {
    if (!this.db) return [];
    const r: any = await sql`
      select tenant_id from tech_salon_memberships
       where global_tech_profile_id = ${profileId} and status not in ('active', 'former', 'rejected', 'revoked', 'cancelled')
      union
      select tenant_id from technicians
       where global_tech_profile_id = ${profileId} and archived_at is null`.execute(this.db).catch(() => null);
    return (r?.rows ?? []).map((x: any) => String(x.tenant_id));
  }

  /**
   * Which salons this technician is actively employed at.
   *
   * THE exempt query. It has no tenant_id predicate and must not have one: it exists to answer a question ABOUT
   * a technician that spans tenants. What protects it is not scoping but DISCLOSURE — the caller
   * (managerLookupView) is only ever allowed to turn this into a COUNT and an "is one of them mine?" boolean.
   * The tenant ids themselves never leave the server.
   */
  async activeTenantIds(profileId: string): Promise<string[]> {
    if (!this.db) return [];
    const r: any = await sql`
      select distinct tenant_id from tech_salon_memberships
       where global_tech_profile_id = ${profileId} and status = 'active'`.execute(this.db).catch(() => null);
    return (r?.rows ?? []).map((x: any) => String(x.tenant_id));
  }
}
