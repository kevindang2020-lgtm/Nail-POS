// event-retention.pgtest — §97–99 / §162 on real Postgres. The tests are about what retention must NEVER delete
// as much as what it must: unpublished work, open dead letters, and anything inside its window are untouchable.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { EventRetentionWorker, RETENTION_DAYS, PROCESSED_EVENTS_DAYS, DEAD_LETTER_FINAL_DAYS, retentionClassOf } from './event-retention';

const T = '11111111-1111-1111-1111-111111111111';
let db: any; let worker: EventRetentionWorker;
const NOW = new Date('2026-09-18T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

async function seedOutbox(id: string, type: string, status: string, publishedDaysAgo: number | null) {
  await sql`INSERT INTO outbox_events (id, event_type, tenant_id, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, publish_status, published_at, created_at)
            VALUES (${id}, ${type}, ${T}, 'x', 'x', ${id}, '{}'::jsonb, ${daysAgo(publishedDaysAgo ?? 0)}, ${status}, ${publishedDaysAgo == null ? null : daysAgo(publishedDaysAgo)}, ${daysAgo(publishedDaysAgo ?? 0)})`.execute(db);
}

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); worker = new EventRetentionWorker(db, () => NOW);
}, 60_000);

describe('§97 retention classes', () => {
  it('money and security events are long-lived; everything else is STANDARD', () => {
    expect(retentionClassOf('payment.captured')).toBe('FINANCIAL');
    expect(retentionClassOf('gift_card.redeemed')).toBe('FINANCIAL');
    expect(retentionClassOf('security.tenant_mismatch')).toBe('SECURITY');
    expect(retentionClassOf('platform.tenant_suspended')).toBe('SECURITY');
    expect(retentionClassOf('appointment.created')).toBe('STANDARD');
    expect(RETENTION_DAYS.FINANCIAL).toBeGreaterThan(RETENTION_DAYS.STANDARD);
  });
});

describe('§98 published outbox cleanup', () => {
  it('deletes only PUBLISHED rows past their class window — never pending/claimed/failed, never inside the window', async () => {
    const U = (n: string) => `00000000-0000-0000-0000-0000000000${n}`;
    await seedOutbox(U('01'), 'appointment.created', 'published', RETENTION_DAYS.STANDARD + 1);   // STANDARD, old → delete
    await seedOutbox(U('02'), 'appointment.created', 'published', RETENTION_DAYS.STANDARD - 1);   // STANDARD, inside window → keep
    await seedOutbox(U('03'), 'payment.captured',    'published', RETENTION_DAYS.STANDARD + 1);   // FINANCIAL, older than STANDARD but inside FINANCIAL → keep
    await seedOutbox(U('04'), 'payment.captured',    'published', RETENTION_DAYS.FINANCIAL + 1);  // FINANCIAL, past its window → delete
    await seedOutbox(U('05'), 'appointment.created', 'pending',   null);                          // WORK, never
    await seedOutbox(U('06'), 'appointment.created', 'failed',    null);                          // WORK, never
    await sql`UPDATE outbox_events SET created_at = ${daysAgo(500)} WHERE id IN (${U('05')}, ${U('06')})`.execute(db);  // even if ancient
    const r = await worker.tick();
    expect(r.outboxDeleted).toBe(2);
    const left = (await sql`SELECT id FROM outbox_events WHERE id::text LIKE '00000000-0000-0000-0000-0000000000%' ORDER BY id`.execute(db)).rows.map((x: any) => x.id);
    expect(left).toEqual([U('02'), U('03'), U('05'), U('06')]);
  });
});

describe('§162 processed_events window + closed dead letters', () => {
  it('trims processed_events past the window and only resolved/discarded dead letters — open and retrying stay', async () => {
    const E = (n: string) => `11111111-0000-0000-0000-0000000000${n}`;
    await sql`INSERT INTO processed_events (consumer_name, event_id, processed_at) VALUES ('c', ${E('01')}, ${daysAgo(PROCESSED_EVENTS_DAYS + 1)}), ('c', ${E('02')}, ${daysAgo(1)})`.execute(db);
    for (const [n, status, age] of [['03', 'resolved', DEAD_LETTER_FINAL_DAYS + 1], ['04', 'discarded', DEAD_LETTER_FINAL_DAYS + 1], ['05', 'open', 500], ['06', 'retrying', 500], ['07', 'resolved', 1]] as const) {
      await sql`INSERT INTO event_dead_letters (event_id, consumer_name, event_type, envelope_json, attempts, error_class, status, first_failed_at, last_failed_at)
                VALUES (${E(n)}, 'c', 'appointment.created', '{}'::jsonb, 1, 'PERMANENT', ${status}, ${daysAgo(age)}, ${daysAgo(age)})`.execute(db);
    }
    const r = await worker.tick();
    expect(r.processedDeleted).toBe(1);
    expect(r.deadLettersDeleted).toBe(2);
    expect((await sql`SELECT event_id FROM processed_events WHERE consumer_name = 'c'`.execute(db)).rows.map((x: any) => x.event_id)).toEqual([E('02')]);
    const dl = (await sql`SELECT status FROM event_dead_letters WHERE consumer_name = 'c' ORDER BY event_id`.execute(db)).rows.map((x: any) => x.status);
    expect(dl).toEqual(['open', 'retrying', 'resolved']);     // 05 open, 06 retrying, 07 recent resolved — all kept
  });

  it('a second pass is a no-op — retention is idempotent', async () => {
    expect(await worker.tick()).toEqual({ outboxDeleted: 0, processedDeleted: 0, deadLettersDeleted: 0 });
  });
});
