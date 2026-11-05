// phase11-b-migrations.pgtest — BUILD_PLAN Phase 11 (agent B), migrations 549–550 on the real schema:
//   * 549: payment_attempts gains stranded_at / resolution / resolved_at, payments gains stranded_at; the status vocabulary
//     accepts 'needs_review' AND the mobile §18 states (538 missed them), and still refuses anything else; resolution has
//     its own vocabulary; both files re-run cleanly and a fresh database defers nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { applyMigrationToPglite } from '../../db/migration-sql.mjs';
import { PAYMENT_ATTEMPT_STATES } from '../../../../modules/checkout/src/mobile-checkout/payment-attempt-state';

const T = 'e5490000-0000-4000-8000-0000000000a1', B = 'e5490000-0000-4000-8000-0000000000b1', TK = 'e5490000-0000-4000-8000-0000000000f1';
let pg: any; let db: any;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const cols = async (t: string) => (await q(sql`select column_name c from information_schema.columns where table_name = ${t}`)).map((r) => r.c);
let n = 0;
const insertAttempt = (status: string, resolution: string | null = null) =>
  sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, resolution) values (${T}, ${B}, ${TK}, 100, 'card', ${status}, ${'k' + (++n)}, ${resolution})`.execute(db);

beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });

describe('549 / 550', () => {
  it('adds the sweep columns and the partial indexes', async () => {
    expect(await cols('payment_attempts')).toEqual(expect.arrayContaining(['stranded_at', 'resolution', 'resolved_at']));
    expect(await cols('payments')).toContain('stranded_at');
    const idx = (await q(sql`select indexname from pg_indexes where tablename in ('payment_attempts', 'payments')`)).map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['idx_payment_attempts_processing', 'idx_payment_attempts_needs_review', 'idx_payments_processing_created']));
  });
  it('status: needs_review and every mobile §18 state are accepted; an unknown status is refused', async () => {
    await insertAttempt('needs_review', 'provider_approved_unrecorded');
    for (const s of PAYMENT_ATTEMPT_STATES) await insertAttempt(s);
    await expect(insertAttempt('bogus')).rejects.toThrow(/chk_payment_attempts_status_vocab/);
  });
  it('resolution: only the sweep\'s vocabulary', async () => {
    await insertAttempt('failed', 'provider_declined');
    await expect(insertAttempt('failed', 'guessed')).rejects.toThrow(/chk_payment_attempts_resolution_vocab/);
  });
  it('both constraints are validated on a fresh database (nothing deferred) and both files re-run cleanly', async () => {
    const v = await q(sql`select conname, convalidated from pg_constraint where conrelid = 'payment_attempts'::regclass and conname in ('chk_payment_attempts_resolution_vocab', 'chk_payment_attempts_status_vocab')`);   // 549's two (660 adds card-metadata checks of its own)
    expect(v.every((r) => r.convalidated)).toBe(true);
    expect(v.map((r) => r.conname).sort()).toEqual(['chk_payment_attempts_resolution_vocab', 'chk_payment_attempts_status_vocab']);
    for (const f of ['549_payment_attempt_stranded.sql', '550_payments_processing_index.sql']) await applyMigrationToPglite(pg, readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const deferred = await q(sql`select count(*)::int n from schema_deferred_constraints where migration like '549%'`);
    expect(Number(deferred[0].n)).toBe(0);
  });
});
