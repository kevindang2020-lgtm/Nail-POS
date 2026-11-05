/**
 * backfill-global-tech.ts — give every technician who already exists their permanent global identity.
 *
 *   npx tsx apps/api/scripts/backfill-global-tech.ts            # DRY RUN — reports, writes nothing
 *   npx tsx apps/api/scripts/backfill-global-tech.ts --apply    # writes
 *
 * == WHY THIS EXISTS =======================================================================================
 *
 * Until migration 376, the manager's create-technician flow wrote a `technicians` row with no user_id and no
 * global_tech_profile_id, and created no `users` row at all. Every technician hired that way is sitting in the
 * database right now with no login and no global identity — and the ONLY code that ever minted a global
 * profile (`getOrCreateMyProfile`) requires them to be logged in, which they cannot do.
 *
 * New hires are fixed at the source. This is for the ones already there.
 *
 * == WHY IT IS A SCRIPT AND NOT PART OF THE MIGRATION ======================================================
 *
 * A migration that silently mints a platform identity for every technician in every salon — deduplicating
 * people ACROSS tenants as it goes, because that is exactly what it must do — is not something to run inside a
 * transaction nobody watched. It merges human beings. It gets a dry run, a report you read, and a decision.
 *
 * It reuses `identityKeys` from the pure core rather than re-implementing phone normalization. A second
 * normalizer would eventually disagree with the first, and the day it did, this script would mint a duplicate
 * global account for a technician who already had one — the precise failure it exists to prevent.
 */
import { Pool } from 'pg';
import { identityKeys, formatTechCode, splitName } from '../../../modules/workforce/src/tech-profile/global-tech-identity-core';
import { slugify } from '../../../modules/workforce/src/tech-profile/tech-profile-core';

const APPLY = process.argv.includes('--apply');
const rand = () => Math.random().toString(36).slice(2, 6);

interface Row {
  id: string; tenant_id: string; branch_id: string | null; user_id: string | null;
  full_name: string; normalized_phone: string | null; email: string | null; avatar_url: string | null;
  is_active: boolean; archived_at: Date | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();

  const stats = { scanned: 0, linkedExisting: 0, createdProfile: 0, adoptedUser: 0, createdUser: 0, noKeys: 0, memberships: 0 };
  const merges: string[] = [];

  try {
    const { rows } = await c.query<Row>(`
      select id, tenant_id, branch_id, user_id, full_name, normalized_phone, email, avatar_url, is_active, archived_at
        from technicians where global_tech_profile_id is null order by created_at`);
    stats.scanned = rows.length;

    if (APPLY) await c.query('begin');

    for (const t of rows) {
      const keys = identityKeys({ phone: t.normalized_phone, email: t.email });

      // No phone and no email → nothing to identify this person BY. A profile minted here could never be
      // recognised as the same human at another salon, which is the entire point. Report it; do not guess.
      if (!keys.phoneHash && !keys.emailNormalized) { stats.noKeys++; continue; }

      // ── find the global profile, ACROSS tenants. This is the merge, and it is the whole job.
      const found = await c.query(`
        select id, tech_code, display_name from global_tech_profiles
         where status <> 'anonymized'
           and (($1::text is not null and phone_hash = $1) or ($2::text is not null and email_normalized = $2))
         limit 1`, [keys.phoneHash, keys.emailNormalized]);

      let profileId: string;
      if (found.rows.length) {
        profileId = found.rows[0].id;
        stats.linkedExisting++;
        merges.push(`  ${t.full_name} @ tenant ${t.tenant_id.slice(0, 8)} → EXISTING ${found.rows[0].tech_code} (${found.rows[0].display_name})`);
        if (APPLY) {
          await c.query(`
            update global_tech_profiles set
              normalized_phone = coalesce(normalized_phone, $2),
              phone_hash       = coalesce(phone_hash, $3),
              email_normalized = coalesce(email_normalized, $4),
              updated_at = now()
            where id = $1`, [profileId, keys.normalizedPhone, keys.phoneHash, keys.emailNormalized]);
        }
      } else {
        stats.createdProfile++;
        if (APPLY) {
          const seq = await c.query(`select nextval('global_tech_code_seq') as n`);
          const code = formatTechCode(Number(seq.rows[0].n));
          const ins = await c.query(`
            insert into global_tech_profiles
              (tech_code, public_slug, display_name, avatar_url, normalized_phone, phone_hash, email_normalized, status)
            values ($1, $2, $3, $4, $5, $6, $7, 'active') returning id`,
            [code, slugify(t.full_name || 'nail-tech', rand()), t.full_name || 'Technician', t.avatar_url,
              keys.normalizedPhone, keys.phoneHash, keys.emailNormalized]);
          profileId = ins.rows[0].id;
        } else { profileId = '(new)'; continue; }
      }

      // ── the per-salon login. Adopt an existing users row before creating a second one.
      let userId = t.user_id;
      if (!userId) {
        const legacy = await c.query(`
          select id from users
           where tenant_id = $1 and role = 'TECHNICIAN' and global_tech_profile_id is null
             and (($2::text is not null and lower(email) = $2) or ($3::text is not null and normalized_phone = $3))
           limit 1`, [t.tenant_id, keys.emailNormalized, keys.normalizedPhone]);
        if (legacy.rows.length) { userId = legacy.rows[0].id; stats.adoptedUser++; }
        else {
          stats.createdUser++;
          const n = splitName(t.full_name || 'Technician');
          const ins = await c.query(`
            insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone,
                               role, status, global_tech_profile_id)
            values ($1, $2, $3, $4, $5, $6, $7, 'TECHNICIAN', 'invited', $8) returning id`,
            [t.tenant_id, t.branch_id, n.firstName, n.lastName, n.fullName,
              keys.emailNormalized, keys.normalizedPhone, profileId]);
          userId = ins.rows[0].id;
        }
      }
      await c.query(`update users set global_tech_profile_id = $2, updated_at = now() where id = $1 and tenant_id = $3`,
        [userId, profileId, t.tenant_id]);

      // ── the employment relationship. An archived technician becomes 'former', not 'active' — backfilling a
      //    salon a technician has already left back into their live Workplaces list would be a lie.
      const status = t.is_active && !t.archived_at ? 'active' : 'former';
      await c.query(`
        insert into tech_salon_memberships
          (global_tech_profile_id, tenant_id, branch_id, technician_id, user_id, status, role_label, start_date)
        values ($1, $2, $3, $4, $5, $6, 'Technician', case when $6 = 'active' then now() else null end)
        on conflict (global_tech_profile_id, tenant_id, branch_id) do update
          set technician_id = excluded.technician_id, user_id = excluded.user_id, updated_at = now()`,
        [profileId, t.tenant_id, t.branch_id, t.id, userId, status]);
      stats.memberships++;

      await c.query(`update technicians set user_id = $2, global_tech_profile_id = $3, updated_at = now()
                      where id = $1 and tenant_id = $4`, [t.id, userId, profileId, t.tenant_id]);
    }

    if (APPLY) await c.query('commit');
  } catch (e) {
    if (APPLY) await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }

  console.log(APPLY ? '\n── APPLIED ──' : '\n── DRY RUN (nothing written; pass --apply) ──');
  console.log(`  technicians with no global identity : ${stats.scanned}`);
  console.log(`  linked to an EXISTING global profile: ${stats.linkedExisting}   ← the same human, already on the platform`);
  console.log(`  new global profiles                 : ${stats.createdProfile}`);
  console.log(`  users rows adopted / created        : ${stats.adoptedUser} / ${stats.createdUser}`);
  console.log(`  memberships written                 : ${stats.memberships}`);
  console.log(`  SKIPPED — no phone and no email     : ${stats.noKeys}   ← cannot be identified across salons; fix the data, then re-run`);
  if (merges.length) { console.log('\n  cross-salon merges:'); merges.slice(0, 40).forEach((m) => console.log(m)); }
}

main().catch((e) => { console.error(e); process.exit(1); });
