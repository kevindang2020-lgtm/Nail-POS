// anonymize.mjs — Security Deep Scan §157: the rules that turn a COPY of a production database into one a lower environment
// may hold (docs/security/DATA_HANDLING.md). Pure planning (columns → SQL) + a runner over any `exec(sql)` function, so the
// CLI (scripts/anonymize-dump.mjs) and the test (src/common/anonymize-dump.pgtest) run the same statements.
//
// Per column, by name (every table, so a new table is covered the day it is created):
//   e-mail      → u<md5 10>@example.invalid            deterministic: uniqueness and joins by e-mail survive
//   phone       → +1555 + 7 digits from md5            deterministic
//   person name → 'Person <md5 6>' (first / last / full / customer / contact / recipient / guardian names)
//   address     → 'Redacted' · date of birth → NULL · IP address → NULL · user agent → NULL
//   free text   → 'redacted' (notes, messages, transcripts, prompts, AI completions, SMS bodies, review text)
//   secrets     → NULL (or 'redacted' when NOT NULL): *_enc, *_ciphertext, *_hash, *secret*, *token*, *password*, api keys
// Whole tables EMPTIED: sessions, refresh tokens, auth events, login attempts, one-time links, device credentials (biometric,
// passkeys, push tokens), recovery codes, OTPs — nothing in them is needed to test and all of it is credential material.
// Runs with session_replication_role = replica (triggers off: append-only / immutability triggers would refuse the rewrite),
// which needs the database OWNER of the copy — never the application's role.
export const EMAIL = /(^|_)e?mails?(_|$)/i;
export const PHONE = /(^|_)(phone|phones|mobile|cell|msisdn)(_|$)|^(sms_to|to_number|from_number|caller_number|callback_number|caller_id)$/i;
export const NAME = /(^|_)(first|last|full|middle|given|family|customer|contact|recipient|guardian|owner|cardholder|emergency_contact|legal_first|legal_last)_name$|^name_on_card$/i;
export const ADDRESS = /(^|_)(address|address_line1|address_line2|street|street_address)$/i;
export const DOB = /(^|_)(dob|date_of_birth|birth_date|birthday)$/i;
export const IP = /(^|_)(ip|ip_address|client_ip|last_ip|remote_ip|user_agent)$/i;
export const FREE_TEXT = /^(notes?|internal_notes?|message|message_body|body|sms_body|transcript|transcript_text|prompt|system_prompt|completion|response_text|review_text|comment|comments|reply_text)$/i;
export const SECRET = /(_enc|_ciphertext|_hash|secret|token|password|passcode|api_key|private_key|pin_code|otp)$|^(token|secret|password)$/i;
export const EMPTY_TABLE = /^(sessions|refresh_tokens|auth_events|login_attempts|security_not_me_tokens|platform_device_approvals|password_reset[a-z_]*|[a-z_]*reset_tokens?|device_biometric_credentials|webauthn_[a-z_]+|device_push_tokens|mfa_recovery_codes|[a-z_]*otp[a-z_]*|auth_devices|stream_tickets|user_invitation_tokens)$/i;
/** columns never rewritten (keys, joins, money, state) even when a rule's words appear in them */
const KEEP = /(^id$|_id$|_at$|_count$|_cents$|_status$|^status$|_type$|_kind$|_last4$|_prefix$|_masked$|_fingerprint$|_verified$|_enabled$|_required$|_consent)/i;

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
/** md5 of the value (text), stable across runs */
const h = (col) => `md5(${q(col)}::text)`;

/** columns: [{ table, column, dataType, nullable }] → { empty: [table], updates: [{ table, sets: [sql], cols: [col] }] } */
export function anonymizePlan(columns) {
  const tables = [...new Set(columns.map((c) => c.table))];
  const empty = tables.filter((t) => EMPTY_TABLE.test(t)).sort();
  const byTable = new Map();
  for (const c of columns) {
    if (empty.includes(c.table) || KEEP.test(c.column)) continue;
    const text = /text|char/.test(c.dataType); const date = /date|time/.test(c.dataType);
    let set = null;
    if (text && EMAIL.test(c.column)) set = `'u' || substr(${h(c.column)}, 1, 10) || '@example.invalid'`;
    else if (text && PHONE.test(c.column)) set = `'+1555' || lpad(((('x' || substr(${h(c.column)}, 1, 7))::bit(28)::int) % 10000000)::text, 7, '0')`;
    else if (text && NAME.test(c.column)) set = `'Person ' || substr(${h(c.column)}, 1, 6)`;
    else if (text && ADDRESS.test(c.column)) set = `'Redacted'`;
    else if (DOB.test(c.column) && (date || text)) set = c.nullable ? 'NULL' : null;
    else if (IP.test(c.column)) set = c.nullable ? 'NULL' : (text ? `'0.0.0.0'` : null);
    else if (text && FREE_TEXT.test(c.column)) set = `'redacted'`;
    else if (text && SECRET.test(c.column)) set = c.nullable ? 'NULL' : `'redacted'`;
    if (!set) continue;
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table).push({ col: c.column, set });
  }
  const updates = [...byTable].sort(([a], [b]) => a.localeCompare(b)).map(([table, cs]) => ({ table, cols: cs.map((x) => x.col),
    sql: `update ${q(table)} set ${cs.map((x) => (x.set === 'NULL' ? `${q(x.col)} = NULL` : `${q(x.col)} = case when ${q(x.col)} is null then null else ${x.set} end`)).join(', ')}` }));
  return { empty, updates };
}

/** Run the plan. `exec(sql)` returns rows for a select. */
export async function anonymize(exec, { log = () => {} } = {}) {
  const columns = (await exec(`select c.table_name as "table", c.column_name as "column", c.data_type as "dataType", c.is_nullable = 'YES' as nullable
      from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' order by 1, 2`));
  const plan = anonymizePlan(columns);
  await exec('begin');
  try {
    await exec(`set local session_replication_role = replica`);
    for (const t of plan.empty) { await exec(`delete from ${q(t)}`); log(`emptied ${t}`); }
    for (const u of plan.updates) { await exec(u.sql); log(`rewrote ${u.table}: ${u.cols.join(', ')}`); }
    await exec('commit');
  } catch (e) { await exec('rollback').catch(() => undefined); throw e; }
  return plan;
}

/** Residual PII shapes in a text dump / sample (the CLI's verification step, and the test's). */
export function residualPii(text) {
  const found = [];
  for (const m of String(text).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) if (!/@example\.invalid$/i.test(m[0]) && !/@(aipowersalon\.(com|test)|example\.(com|org|net))$/i.test(m[0])) found.push(`email ${m[0].replace(/^(.).*@/, '$1***@')}`);
  for (const m of String(text).matchAll(/(?<![\d])\+?1?[ .(-]*[2-9]\d{2}[ .)-]*\d{3}[ .-]*\d{4}(?![\d])/g)) {
    const d = m[0].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d.length === 10 && !d.startsWith('555')) found.push(`phone ***${d.slice(-4)}`);
  }
  return found;
}
