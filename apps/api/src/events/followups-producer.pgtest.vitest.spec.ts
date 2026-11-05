// followups-producer.pgtest — §80/§18 on real Postgres: the nightly queue emits ONE generated event, a re-run
// emits none (the partial-unique makes it a no-op), and task actions emit per-task facts.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDailyFollowUpRepository } from '@aipowersalon/communications';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const U = (n: string) => `66666666-6666-6666-6666-6666666666${n}`;
let db: any; let repo: KyselyDailyFollowUpRepository;

const row = (n: string) => ({
  tenantId: T, branchId: B, businessDate: '2026-09-18', customerId: U('01'), technicianId: U(n === '11' ? '02' : '03'),
  ticketId: U('04'), ticketServiceLineId: U(n), serviceId: U('05'), serviceName: 'Gel Manicure',
  customerName: 'Olivia Brown', customerPhone: '+16095550123', technicianName: 'Mia Nguyen',
  customerAppUserId: null, completedAt: new Date().toISOString(), templateKey: 'default', suggestedMessage: 'Hope you love your nails!',
});

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;
                 INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  repo = new KyselyDailyFollowUpRepository(db, new OutboxWriter());
}, 60_000);

describe('followup.tasks_generated — one fact per nightly batch (§80)', () => {
  it('generating two tasks writes ONE event carrying counts and technician ids, never the customer snapshots', async () => {
    expect(await repo.insertTasksIgnoreConflict([row('11'), row('12')] as any)).toBe(2);
    const out = (await sql`SELECT event_type, aggregate_id, payload_json, actor_type FROM outbox_events WHERE event_type = 'followup.tasks_generated'`.execute(db)).rows as any[];
    expect(out.length).toBe(1);
    expect(out[0].aggregate_id).toBe(`${B}:2026-09-18`);
    expect(out[0].actor_type).toBe('worker');
    const p = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect(p).toMatchObject({ businessDate: '2026-09-18', count: 2 });
    expect(p.technicianIds.length).toBe(2);
    expect(JSON.stringify(p)).not.toMatch(/Olivia|Brown|0123|Mia|Hope you love/);     // §95
  });

  it('§3 a re-run inserts nothing and therefore emits nothing — the nightly scheduler is safe to retry', async () => {
    expect(await repo.insertTasksIgnoreConflict([row('11'), row('12')] as any)).toBe(0);
    const n: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'followup.tasks_generated'`.execute(db)).rows[0];
    expect(n.n).toBe(1);
  });

  it('markSent and markStatus emit per-task facts with the owning technician, not the message text', async () => {
    const task: any = (await sql`SELECT id, technician_id FROM service_follow_up_tasks WHERE ticket_service_line_id = ${U('11')}`.execute(db)).rows[0];
    // Phase 12 (#27): a SENT follow-up can no longer be skipped / dismissed (the service always refused it; the write now
    // refuses it too) — so the status change comes first (skipped), then the send (skipped → sent is a real flow).
    await repo.markStatus(T, task.id, 'skipped' as any, 'customer opted out');
    await repo.markSent(T, task.id, 'Hope you love your nails!', U('06'), null);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${task.id} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['followup.task_status_changed', 'followup.task_sent']);
    const sent = typeof out[1].payload_json === 'string' ? JSON.parse(out[1].payload_json) : out[1].payload_json;
    expect(sent).toMatchObject({ taskId: task.id, technicianId: task.technician_id, status: 'sent', hasNotification: false });
    expect(JSON.stringify(out)).not.toMatch(/Hope you love|opted out/);               // §95: text stays in the row
  });

  it("a follow-up write names its tenant: another salon's tenant id updates NOTHING, even with the right task id", async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    const task: any = (await sql`SELECT id, status, suggested_message FROM service_follow_up_tasks WHERE ticket_service_line_id = ${U('11')}`.execute(db)).rows[0];
    await repo.markStatus(OTHER, task.id, 'skipped' as any, 'cross-tenant attempt');
    await repo.updateMessage(OTHER, task.id, 'overwritten by another salon');
    await repo.markCustomerViewed(OTHER, task.id);
    const after: any = (await sql`SELECT status, suggested_message, customer_viewed_at FROM service_follow_up_tasks WHERE id = ${task.id}`.execute(db)).rows[0];
    expect(after.status).toBe(task.status);
    expect(after.suggested_message).toBe(task.suggested_message);
    expect(after.customer_viewed_at).toBeNull();
  });
  it("a customer's reply records followup.customer_replied (declared and projected, produced by nothing until now)", async () => {
    const task: any = (await sql`SELECT id FROM service_follow_up_tasks WHERE ticket_service_line_id = ${U('11')}`.execute(db)).rows[0];
    await repo.markStatus(T, task.id, 'customer_replied' as any);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${task.id} ORDER BY occurred_at DESC LIMIT 1`.execute(db)).rows as any[];
    expect(out[0].event_type).toBe('followup.customer_replied');
    expect(out[0].payload_json).toMatchObject({ taskId: task.id, status: 'customer_replied' });
  });
});
