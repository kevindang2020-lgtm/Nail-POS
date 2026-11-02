/**
 * salon-code.ts — Super Admin tenant code generation.
 *
 * Pure, deterministic-when-seeded, collision-safe salon/tenant code generator.
 * Wire `allocateSalonCode` into your Super Admin "Create Tenant" flow so every
 * tenant is assigned a unique, human-readable Salon Code (e.g. LUXE7K2) that
 * staff type on the tenant login screen.
 *
 * No external deps. Keep the generator pure; do the DB existence check in the
 * `exists` predicate you pass in (e.g. tenants.repository.codeExists(code)).
 */

// Crockford-ish set: no I, O, 0, 1 — avoids "is that an O or a 0?" support calls.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Uppercase, strip accents and non-alphanumerics. "Luxe Nails & Spa" -> "LUXENAILSSPA". */
export function slugifyName(displayName: string): string {
  return (displayName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/** Letter prefix from the name, padded to `len` (default 4). "Luxe Nails" -> "LUXE". */
export function namePrefix(displayName: string, len = 4): string {
  const letters = slugifyName(displayName).replace(/[^A-Z]/g, '');
  const base = (letters || 'SALON').slice(0, len);
  return base.padEnd(len, 'X');
}

/** Random suffix from the unambiguous alphabet. Inject `rnd` for deterministic tests. */
export function randomSuffix(n = 3, rnd: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  }
  return out;
}

/** Shape check for a salon code (2–6 letters + 2–8 alphanumerics, no separators). */
export function isValidSalonCode(code: string): boolean {
  return /^[A-Z]{2,6}[A-Z0-9]{2,8}$/.test(code || '');
}

export interface SalonCodeOptions {
  prefixLen?: number;
  suffixLen?: number;
  rnd?: () => number;
}

/** Build a single candidate code (no uniqueness check). */
export function generateSalonCode(displayName: string, opts: SalonCodeOptions = {}): string {
  const { prefixLen = 4, suffixLen = 3, rnd } = opts;
  return namePrefix(displayName, prefixLen) + randomSuffix(suffixLen, rnd);
}

export interface AllocateOptions extends SalonCodeOptions {
  maxTries?: number;
}

/**
 * Collision-safe allocation. `exists` returns true if a code is already taken
 * (sync or async). Retries, then widens the suffix to guarantee headroom.
 */
export async function allocateSalonCode(
  displayName: string,
  exists: (code: string) => Promise<boolean> | boolean,
  opts: AllocateOptions = {},
): Promise<string> {
  const maxTries = opts.maxTries ?? 50;
  const baseSuffix = opts.suffixLen ?? 3;

  for (let i = 0; i < maxTries; i++) {
    const code = generateSalonCode(displayName, opts);
    if (!(await exists(code))) return code;
  }
  // Widen the suffix to expand the space, then keep trying.
  for (let i = 0; i < maxTries; i++) {
    const code = generateSalonCode(displayName, { ...opts, suffixLen: baseSuffix + 2 });
    if (!(await exists(code))) return code;
  }
  throw new Error('Could not allocate a unique salon code after retries');
}
