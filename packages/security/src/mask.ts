// mask.ts — display masking for secrets and PII (Constitution 13 §81). Three maskEmail implementations existed in the API
// with three different outputs; this is the one. Masking is for DISPLAY — it is not encryption, hashing or redaction.

/** `jane.doe@example.com` → `j•••@example.com`; empty/invalid → `•••`. */
export function maskEmail(email: string | null | undefined): string {
  const e = (email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at <= 0) return '•••';
  return `${e[0]}•••${e.slice(at)}`;
}

/** Last four digits of a phone number, or `•••` when there are fewer than four. */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.length < 4 ? '•••' : `•••• ${digits.slice(-4)}`;
}

/** Show the start and end of a long secret (an API key) with the middle hidden; short values are fully hidden. */
export function maskSecret(secret: string | null | undefined, keep = 4): string {
  const s = (secret || '').trim();
  if (s.length <= keep * 2 + 2) return '•'.repeat(Math.max(6, s.length));
  return `${s.slice(0, keep)}${'•'.repeat(8)}${s.slice(-keep)}`;
}

/** The last four characters of a credential, for display ("…a1b2"); null when too short to show safely. */
export function secretLast4(secret: string | null | undefined): string | null {
  const s = (secret || '').trim();
  return s.length >= 4 ? s.slice(-4) : null;
}

/** The settings/payments display form of a stored credential: "•••• •••• " + its last four characters ('' when unset).
 *  Moved from apps/api/src/settings/settings.dto (Constitution 13): the payments resolver and the settings surface both
 *  show credentials this way, and the payments domain may not import the settings directory. */
export function maskSecretTail(secret: string | null | undefined): string {
  if (!secret) return '';
  return '•••• •••• ' + secret.slice(-4);
}
