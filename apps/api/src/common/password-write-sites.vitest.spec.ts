// password-write-sites.vitest.spec.ts — you cannot add a password write that forgets the rule.
//
// == THE FAILURE THIS PREVENTS ============================================================================
//
// A technician has ONE password (auth/password-scope.ts). Every salon keeps a copy of the hash, and when she
// changes it, every copy changes.
//
// That holds only as long as EVERY place that writes `users.password_hash` knows about it. Miss one, and she
// changes her password at Luxe, it silently does not change at Belle, and she is locked out of a salon she
// works at by a feature that was supposed to help her. Nothing throws. Nothing logs. She just cannot get in,
// and nobody can tell her why.
//
// There are four such places today. A fifth added six months from now, by someone who has never read
// password-scope.ts, is the entire risk — and it is exactly the kind of thing a code review does not catch,
// because the new code looks perfectly correct on its own.
//
// So: a source assertion. Any file that writes a password hash must be a file that knows the rule.
import { codeRoots, codeKey } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

/**
 * Files that write a password hash and deliberately do NOT propagate, each for a stated reason.
 *
 * This list is not a way around the rule. It is the rule's exception register, and an entry costs a sentence
 * explaining itself.
 */
const REVIEWED: Record<string, string> = {
  'auth/password-scope.ts':
    'The propagation itself.',
  'super-admin-platform/super-admin-platform.repository.ts':
    'Two writes. (1) acceptInvitation — VERIFIES against her existing hash and reuses it; it must never SET a ' +
    'password, or an invite link could rotate her credential at the salons she already works at. (2) the remaining ' +
    'platform-account writes stay scoped to that one account. Since Security Deep Scan C2 (Oct 23 2026) an admin no ' +
    'longer SETS anyone\'s password: admin-credential-delivery.ts sends a temporary credential to the account holder ' +
    '(temp_password_hash), and the owner reset in super-admin-tenants no longer writes a hash at all. Imports password-scope.',
};

const texts = new Map<string, string>();
function sources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      // Keyed by codeKey (API files relative to src, module files <module>/<file>, packages packages/<p>/<file>) — the
      // old p.slice(SRC.length + 1) produced a garbage key for any file outside apps/api/src once code roots widened.
      else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) { const t = readFileSync(p, 'utf8'); out.push([codeKey(p), t]); texts.set(codeKey(p), t); }
    }
  };
  codeRoots().flatMap((r) => walk(r));
  return out;
}

/** A WRITE, not a read. `select password_hash` and type declarations must not trip this. */
const writesPasswordHash = (text: string) =>
  /\.set\(\s*\{[^}]*\bpassword_hash\s*:/s.test(text) ||           // kysely:  .set({ password_hash: … })
  /\bset\b[^;]{0,200}?\bpassword_hash\s*=/is.test(text);          // raw sql: set password_hash = …

describe('every place that writes a password hash knows a technician has only one', () => {
  it('names them all — and each either propagates, or is on the reviewed register', () => {
    const writers = sources().filter(([, t]) => writesPasswordHash(t)).map(([f]) => f);

    expect(writers.length).toBeGreaterThan(0);   // the guard is watching something real

    const unaccounted = writers.filter((f) => {
      if (REVIEWED[f]) return false;
      const text = texts.get(f) ?? '';
      // It must at least IMPORT the rule: relatively inside identity, or by name from @aipowersalon/identity outside it
      // (Constitution 13). My import re-resolver once rewrote THIS regex into a syntax error — the file failed to load.
      return !(/from '.*password-scope'/.test(text) || /\b(propagateTechnicianPassword|technicianPasswordPeers|existingTechnicianPasswordHash)\b[^;]*from '@aipowersalon\/identity'/.test(text));
    });

    expect(
      unaccounted,
      `These files write users.password_hash but neither propagate it (auth/password-scope.ts) nor appear on the ` +
      `reviewed register in this spec. A technician has ONE password: if a write does not propagate, she changes ` +
      `it at one salon and is silently locked out of another.`,
    ).toEqual([]);
  });

  it('the register itself is honest — every entry is a file that really writes one', () => {
    // A stale exemption is worse than none: it silently forgives a file that no longer needs forgiving, and the
    // next person assumes the whole list was checked.
    const writers = new Set(sources().filter(([, t]) => writesPasswordHash(t)).map(([f]) => f));
    for (const f of Object.keys(REVIEWED)) {
      if (f === 'auth/password-scope.ts') continue;   // the propagation, by definition
      expect(writers.has(f), `${f} is on the reviewed register but no longer writes a password hash — remove it`).toBe(true);
    }
  });

  it('the three flows where SHE chooses the password all propagate', () => {
    for (const f of [
      'auth/account.controller.ts',            // change password while signed in
      'auth/password-reset.ports.kysely.ts',   // complete a password reset
      'auth/system-reset.ports.kysely.ts',     // set a real password after a temporary one
    ]) {
      const text = texts.get(f) ?? readFileSync(join(SRC, f), 'utf8');   // the walked text, keyed by codeKey (identity is a module now)
      expect(text, `${f} writes a password but does not propagate it`).toMatch(/propagateTechnicianPassword/);
    }
  });
});
