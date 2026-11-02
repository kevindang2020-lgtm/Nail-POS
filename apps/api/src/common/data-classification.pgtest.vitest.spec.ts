// data-classification.pgtest — Constitution 12 §13–14: every secret in the schema is hashed or encrypted, by name.
//
// SECURITY_DATA_CLASSIFICATION.md is generated from the schema; this is what keeps it TRUE. A new column that looks
// like a secret (`*secret*`, `*token*`, `*api_key*`, `*auth_token*`, `*private_key*`, `*password*`) must carry an
// `_enc`, `_hash`, `_ciphertext` or `_last4` suffix — or appear in the allowlist below with a finding number. The
// allowlist is meant to shrink: M6 (bank webhook signing secret, plaintext) is fixed in Phase 7 and leaves it then.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

const SECRET_NAME = /(secret|token|api_key|auth_token|private_key|password|totp|passcode)/i;
const SAFE_SUFFIX = /(_enc|_hash|_ciphertext|_last4|_masked|_fingerprint|_prefix|_id|_at|_count|_kind|_type|_status|_name|_ref|_reference|_url|_version|_expires|_used)$/i;
/** Columns that name a secret but are NOT secrets in the hashing sense — reviewed one by one, with the reason. */
const REVIEWED_NOT_SECRET = new Set([
  'customer_payment_methods.token',     // §85 a processor payment token: useless without merchant credentials, and it must stay usable — tokenization IS the minimisation
  'device_push_tokens.token',           // §105 a push token is not authentication and must be usable to send
  'synthetic_probe_heartbeats.token',   // C11 probe: a random value written and read back, a credential for nothing
  'users.temp_password_delivery',       // HOW the temporary password was delivered (sms/email), not the password — that is temp_password_hash
  'tenant_messaging_credentials.api_key_sid', // Phase 4: a Twilio API key's SID — an identifier like the account SID; its secret is api_key_secret_enc
]);
/** Plaintext secrets that EXIST TODAY. Each carries its finding. Adding to this list is a security review, not a fix. */
const KNOWN_PLAINTEXT: Record<string, string> = {
  // (empty) M6 — bank_webhook_endpoints.token / signing_secret — was dropped by migration 542 (BUILD_PLAN Phase 10).
};
// M7 (billing_export_jobs.download_token → download_token_hash) and M8 (public_check_in_sessions.public_token dropped)
// are gone from the schema, so they are gone from here — the guard demanded it.
/** A planted column the scan MUST flag — with the allowlist empty, this is what proves the scan still sees anything. */
const PROBE = '_classification_probe.api_secret';

let plaintext: string[] = [];
beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`CREATE TABLE _classification_probe (id uuid, api_secret text)`);
  const cols = (await pg.query(`select table_name t, column_name c, data_type d from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows as Array<{ t: string; c: string; d: string }>;
  plaintext = cols
    .filter((r) => SECRET_NAME.test(r.c) && !SAFE_SUFFIX.test(r.c) && !REVIEWED_NOT_SECRET.has(`${r.t}.${r.c}`))
    .filter((r) => /text|char/.test(r.d))                       // a boolean "has_token" or a timestamp is not a secret
    .filter((r) => !/(enabled|required|verified|sent|attempts|expires|last|next|has_|is_|can_|allow|policy|method|provider|scope|kind|type|status|name|purpose|source|reason|_by$|_url$|_ref$|_at$|_count$|_ttl|_mode|_class|_len|_size|_format|_label|_channel|_length)/i.test(r.c))
    .map((r) => `${r.t}.${r.c}`);
});

describe('§13 secrets are never plaintext columns', () => {
  it('every secret-shaped TEXT column is hashed/encrypted — or is a known, numbered exception', () => {
    const unexpected = plaintext.filter((c) => !(c in KNOWN_PLAINTEXT) && c !== PROBE);
    expect(unexpected, `plaintext secret columns with no finding:\n${unexpected.join('\n')}`).toEqual([]);
  });
  it('the allowlist only shrinks — an entry that no longer exists must be removed, not left as a false claim', () => {
    for (const c of Object.keys(KNOWN_PLAINTEXT)) expect(plaintext, `${c} is in the allowlist but is no longer a plaintext column`).toContain(c);
  });
  it('the scan finds a planted plaintext secret at all — a scan that matches nothing guards nothing', () => {
    expect(plaintext).toContain(PROBE);
  });
});
