// mfa-recovery-codes.ts — Constitution 3 §66–67 (Step 3, Oct 3 2026). Ten single-use codes, shown ONCE, stored only as
// a hash (bound to the user, so the same code typed for another account never matches). Generating a new set retires
// every unused code of the old one. Sign-in accepts a recovery code once where it would take a TOTP code; the login
// attempt budget (Constitution 12 §58) already counts a wrong one.
import { createHash, randomInt } from 'node:crypto';
import { sql } from 'kysely';

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L — a code is read off paper
/** XXXX-XXXX — 8 characters of a 31-letter alphabet (~40 bits); guessing is bounded by the login attempt budget. */
export function newRecoveryCode(): string {
  const c = () => ALPHABET[randomInt(ALPHABET.length)];
  return `${c()}${c()}${c()}${c()}-${c()}${c()}${c()}${c()}`;
}
/** Case, spaces and the hyphen do not matter when typed. */
export function normalizeRecoveryCode(raw: string): string { return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/** Does this input look like a recovery code (not a 6-digit TOTP)? */
export function looksLikeRecoveryCode(raw: string): boolean { return /^[A-Z0-9]{8}$/.test(normalizeRecoveryCode(raw)) && !/^\d{6}$/.test(String(raw ?? '').trim()); }
export function hashRecoveryCode(userId: string, raw: string): string { return createHash('sha256').update(`${userId}:${normalizeRecoveryCode(raw)}`).digest('hex'); }

export interface RecoveryCodeStore {
  /** Retire every live code of the user and store these hashes as the new set (one transaction). */
  replace(userId: string, hashes: string[]): Promise<void>;
  /** Mark the matching live code used — only if it is still live (compare-and-set: one use, even under a race). */
  consume(userId: string, hash: string): Promise<boolean>;
  remaining(userId: string): Promise<number>;
}
export class RecoveryCodes {
  constructor(private readonly store: RecoveryCodeStore) {}
  async generate(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.store.replace(userId, codes.map((c) => hashRecoveryCode(userId, c)));
    return codes;
  }
  async consume(userId: string, raw: string): Promise<boolean> {
    if (!looksLikeRecoveryCode(raw)) return false;
    return this.store.consume(userId, hashRecoveryCode(userId, raw));
  }
  remaining(userId: string): Promise<number> { return this.store.remaining(userId); }
}
export class KyselyRecoveryCodeStore implements RecoveryCodeStore {
  constructor(private readonly db: any) {}
  async replace(userId: string, hashes: string[]): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await sql`update mfa_recovery_codes set retired_at = now() where user_id = ${userId}::uuid and used_at is null and retired_at is null`.execute(trx);
      for (const h of hashes) await sql`insert into mfa_recovery_codes (user_id, code_hash) values (${userId}::uuid, ${h})`.execute(trx);
    });
  }
  async consume(userId: string, hash: string): Promise<boolean> {
    const r: any = await sql`update mfa_recovery_codes set used_at = now() where user_id = ${userId}::uuid and code_hash = ${hash} and used_at is null and retired_at is null`.execute(this.db);
    return Number(r.numAffectedRows ?? r.numUpdatedRows ?? 0) > 0;
  }
  async remaining(userId: string): Promise<number> {
    const r: any = await sql`select count(*)::int as n from mfa_recovery_codes where user_id = ${userId}::uuid and used_at is null and retired_at is null`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }
}
export class InMemoryRecoveryCodeStore implements RecoveryCodeStore {
  rows: { userId: string; hash: string; used: boolean; retired: boolean }[] = [];
  async replace(userId: string, hashes: string[]) { for (const r of this.rows) if (r.userId === userId && !r.used) r.retired = true; for (const h of hashes) this.rows.push({ userId, hash: h, used: false, retired: false }); }
  async consume(userId: string, hash: string) { const r = this.rows.find((x) => x.userId === userId && x.hash === hash && !x.used && !x.retired); if (!r) return false; r.used = true; return true; }
  async remaining(userId: string) { return this.rows.filter((r) => r.userId === userId && !r.used && !r.retired).length; }
}
