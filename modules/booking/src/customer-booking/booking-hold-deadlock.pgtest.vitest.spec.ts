// booking-hold-deadlock.pgtest — the fourth full run (Oct 21 2026) found, in the real-Postgres race lane, two booking sessions
// grabbing the same slot at once and one of them receiving a raw `deadlock detected` (40P01) instead of the clean "held for
// another booking": two inserts racing on the booking_holds no-overlap exclusion constraint can deadlock, and Postgres aborts
// one of them. The victim's single INSERT was rolled back — nothing of it exists — so the right answer is to try it ONCE
// more: the winner has committed by then, so the retry meets the constraint (→ HoldSlotTakenError) or, if the winner rolled
// back, succeeds. Here a temporary trigger plays the deadlock (raises 40P01 on cue) on the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyHoldRepository, HoldSlotTakenError } from './booking-hold.kysely';

const T = 'd2100000-0000-4000-8000-000000000001', B = 'd2100000-0000-4000-8000-000000000002', TECH = 'd2100000-0000-4000-8000-0000000000c1';
let pg: any; let repo: KyselyHoldRepository;
const hour = (h: number) => Date.parse(`2026-11-02T${String(h).padStart(2, '0')}:00:00Z`);
const sess = (n: number) => `d2100000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
const req = (h: number, sid: string) => ({ tenantId: T, branchId: B, technicianId: TECH, startsAt: hour(h), endsAt: hour(h + 1), bookingSessionId: sid, channel: 'online', expiresAt: Date.now() + 600_000 }) as any;
/** the next `n` inserts into booking_holds abort with SQLSTATE 40P01, as Postgres does to a deadlock victim */
// (a sequence, because nextval survives the aborted INSERT — a counter row would roll back with it)
const deadlockNext = (n: number) => pg.exec(`UPDATE deadlock_script SET until = ${n}; SELECT setval('deadlock_seq', 1, false);`);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'H', 'H', 'hold-dl', 'HOLDDL', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${TECH}', '${T}', '${B}', 'A', 'B', 'A B');
    CREATE TABLE deadlock_script (until int NOT NULL); INSERT INTO deadlock_script VALUES (0); CREATE SEQUENCE deadlock_seq;
    CREATE FUNCTION play_deadlock() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('deadlock_seq') <= (SELECT until FROM deadlock_script) THEN
        RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER zz_play_deadlock BEFORE INSERT ON booking_holds FOR EACH ROW EXECUTE FUNCTION play_deadlock();
  `);
  repo = new KyselyHoldRepository(kyselyFor(pg) as never);
}, 120000);

describe('a deadlocked hold insert is retried once, never surfaced raw', () => {
  it('deadlock victim, slot still free → the retry takes the hold', async () => {
    await deadlockNext(1);
    const { holdId } = await repo.create(req(10, sess(1)));
    expect(holdId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('deadlock victim, the winner committed the slot → the retry gets the clean HoldSlotTakenError', async () => {
    await deadlockNext(1);
    await expect(repo.create(req(10, sess(2)))).rejects.toBeInstanceOf(HoldSlotTakenError);
  });
  it('a second deadlock in a row is still never raw: it is the same clean refusal, retryable by the guest', async () => {
    await deadlockNext(2);
    await expect(repo.create(req(12, sess(3)))).rejects.toBeInstanceOf(HoldSlotTakenError);
    expect(Number((await pg.query(`SELECT last_value FROM deadlock_seq`)).rows[0].last_value)).toBe(2);   // exactly two attempts
  });
});
