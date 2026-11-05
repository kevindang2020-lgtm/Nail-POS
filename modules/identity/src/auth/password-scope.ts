// password-scope.ts — a technician has ONE password. The salons just each keep a copy of the hash.
//
// == WHY THIS EXISTS, AND WHY IT IS NOT A SECURITY WEAKENING ==============================================
//
// Under the per-salon login model a technician has one `users` row per salon, each with its own `password_hash`.
// That looked like isolation. It never was:
//
//   • `POST /tech/context/switch` re-mints her session for any salon she is actively employed at. One
//     authentication already reached all of them.
//   • Her passkey does the same, since cross-salon Face ID (webauthn.service: "the passkey proves WHO; the
//     challenge decides WHERE").
//
// So a second password bought ZERO isolation and cost her a second password. It was friction with no security
// behind it. This makes it one password — which is what "the account belongs to the technician" has meant all
// along — and it does so WITHOUT touching the tenant-scoped login query, which stays exactly as it is.
//
// == THE PART THAT IS A SECURITY DECISION =================================================================
//
// Propagation is deliberately ONE-DIRECTIONAL, and the asymmetry is the whole design:
//
//   SHE CHANGES HER PASSWORD (signed in, or through a verified reset)  →  propagate to every salon.
//   SHE ACCEPTS AN INVITATION AT A NEW SALON                           →  NEVER propagate. Verify instead.
//
// If accepting an invitation could SET her password, then anyone holding an invite link for a new salon could
// choose a password that then rotated her credential at the salons she already works at. An invitation is an
// offer of employment. It is not a password reset, and it must not become one.
//
// So `acceptInvitation` asks her for the password she already has, checks it against the copy at her existing
// salon, and reuses that hash. Her existing password is never overwritten by a link somebody sent her.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

/**
 * The technician's OTHER logins — the same human, at her other salons.
 *
 * Same predicate as cross-salon Face ID, deliberately: what the passkey may unlock and what the password may
 * unlock must be the same set of rows, or one of them becomes the hole the other does not have.
 *
 * Only `active` rows. An invited-but-never-accepted row is a salon she has not joined; a password must not
 * arrive there and quietly become a working login.
 */
export async function technicianPasswordPeers(db: AppDatabase | null, userId: string): Promise<string[]> {
  if (!db) return [];
  const r: any = await sql`
    select peer.id
      from users me
      join users peer on peer.global_tech_profile_id = me.global_tech_profile_id and peer.id <> me.id
      join global_tech_profiles p on p.id = me.global_tech_profile_id
     where me.id = ${userId}
       and me.global_tech_profile_id is not null
       and me.role = 'TECHNICIAN' and peer.role = 'TECHNICIAN'
       and peer.status = 'active'
       and p.status = 'active'`.execute(db).catch(() => null);
  return (r?.rows ?? []).map((x: any) => String(x.id));
}

/**
 * She changed her password. It is HER password, so it changes everywhere she works.
 *
 * Called from every flow where SHE chooses the new password: change-password while signed in, completing a
 * password reset, and setting a real password after a temporary one. Never from accept-invitation — see above.
 *
 * Best-effort and non-throwing: a failure here must never leave her unable to sign in at the salon she was
 * actually standing in when she changed it. It returns how many peers it reached so a caller can log the truth.
 */
export async function propagateTechnicianPassword(db: AppDatabase | null, userId: string, hash: string): Promise<number> {
  if (!db) return 0;
  const peers = await technicianPasswordPeers(db, userId);
  if (!peers.length) return 0;
  try {
    await sql`
      update users
         set password_hash = ${hash}, must_change_password = false, password_changed_at = now(), updated_at = now()
       where id = any(${peers}::uuid[])`.execute(db);
    return peers.length;
  } catch {
    return 0;
  }
}

/**
 * The password she ALREADY HAS, if she already works somewhere.
 *
 * Used by accept-invitation to verify rather than overwrite. `null` means this is genuinely her first salon and
 * the password she is typing is a new one.
 */
export async function existingTechnicianPasswordHash(db: AppDatabase | null, userId: string): Promise<string | null> {
  if (!db) return null;
  const peers = await technicianPasswordPeers(db, userId);
  if (!peers.length) return null;
  const r: any = await sql`
    select password_hash from users
     where id = any(${peers}::uuid[]) and password_hash is not null
     order by password_changed_at desc nulls last
     limit 1`.execute(db).catch(() => null);
  return r?.rows?.[0]?.password_hash ? String(r.rows[0].password_hash) : null;
}
