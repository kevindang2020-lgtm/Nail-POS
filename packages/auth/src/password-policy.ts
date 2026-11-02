// password-policy.ts — pure, tested. Strong temporary-password generation + strength checks (§7).
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // no I/O
const LOWER = "abcdefghijkmnpqrstuvwxyz";   // no l/o
const DIGIT = "23456789";                    // no 0/1
const SYM = "!@#$%^&*-_+=?";

// rngInt(maxExclusive) must be a CSPRNG in production (crypto.randomInt); injected for deterministic tests.
export function generateTempPassword(rngInt: (maxExclusive: number) => number, length = 12): string {
  if (length < 12) length = 12;
  const pools = [UPPER, LOWER, DIGIT, SYM];
  const chars: string[] = pools.map((p) => p[rngInt(p.length)]); // guarantee 1 of each class
  const all = UPPER + LOWER + DIGIT + SYM;
  while (chars.length < length) chars.push(all[rngInt(all.length)]);
  // Fisher–Yates shuffle with the same rng so the guaranteed chars aren't always in front
  for (let i = chars.length - 1; i > 0; i--) { const j = rngInt(i + 1); const t = chars[i]; chars[i] = chars[j]; chars[j] = t; }
  return chars.join("");
}

export function isStrongPassword(pw: string, minLen = 12): boolean {
  return pw.length >= minLen && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// new password the user sets: at least 10, letters+numbers, not equal to the temp, and (recommended) strong.
export function validateNewPassword(newPw: string, confirmPw: string, tempPlain: string): { ok: boolean; error?: string } {
  if (!newPw || newPw.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  if (newPw !== confirmPw) return { ok: false, error: "Passwords do not match." };
  if (newPw === tempPlain) return { ok: false, error: "New password cannot be the temporary password." };
  if (!/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) return { ok: false, error: "Use letters and numbers." };
  return { ok: true };
}

// 0..4 strength score for the meter.
export function passwordScore(pw: string): number {
  let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}
