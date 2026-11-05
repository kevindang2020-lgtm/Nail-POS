/* verify-tech.ts — proves the Technician backend over REAL Postgres (PGlite): rich ticket detail (customer/services/
 * total/timestamps), tickets list, queue state, more/profile, add-note, request-cancel, the accept→start→service-done
 * lifecycle (DB-valid statuses + line completion), and ownership/tenant isolation. Constructs the Kysely adapter +
 * TechService directly (tsx doesn't emit Nest decorator metadata). No fabricated data. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyTechRepository } from '../../../modules/queue/src/tech/tech.kysely.repository';
import { TechService, TechError } from '../../../modules/queue/src/tech/tech.service';
import type { TechContext } from '../../../modules/queue/src/tech/tech.repository';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5471;
  const T = '00000000-0000-0000-0000-00000000a001', B = '00000000-0000-0000-0000-00000000b001';
  const T2 = '00000000-0000-0000-0000-00000000a002', B2 = '00000000-0000-0000-0000-00000000b002';
  const U = '00000000-0000-0000-0000-00000000c001', U2 = '00000000-0000-0000-0000-00000000c002';
  const TECH = '00000000-0000-0000-0000-00000000d001', TECH2 = '00000000-0000-0000-0000-00000000d002';
  const TKA = '00000000-0000-0000-0000-00000000e001', TKB = '00000000-0000-0000-0000-00000000e002', TKX = '00000000-0000-0000-0000-00000000e003';
  const TID_A = '00000000-0000-0000-0000-00000000f001';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  // tenants + branches
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES
    ('${T}','Pilot LLC','Pilot Salon','pilot-t1','PILOTT1'), ('${T2}','Other LLC','Other Salon','pilot-t2','PILOTT2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main'), ('${B2}','${T2}','Main2')`);
  // technicians (resolveTechnicianId matches technicians.user_id + is_active; no users row needed)
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, is_active) VALUES
    ('${TECH}','${T}','${B}','${U}','Amy','Nguyen','Amy Nguyen','Nail Technician','available','percent',40,true),
    ('${TECH2}','${T}','${B}','${U2}','Bea','Tran','Bea Tran','Nail Technician','available','percent',40,true)`);
  // tech-queue tickets: A (in_service, assigned to TECH, has a real ticket_id + service lines),
  //   B (assigned, not started, requested_services fallback), X (assigned to TECH2 — ownership isolation)
  await db.exec(`INSERT INTO pos_tech_queue_tickets (id, tenant_id, branch_id, ticket_id, customer_id, customer_name, customer_phone, status, assigned_technician_id, assigned_at, accepted_at, started_at, notes, requested_services) VALUES
    ('${TKA}','${T}','${B}','${TID_A}', NULL, 'Jennifer Lee','(555) 123-4567','in_service','${TECH}', now() - interval '40 minutes', now() - interval '35 minutes', now() - interval '30 minutes', 'Prefers square shape.', '[]'::jsonb),
    ('${TKB}','${T}','${B}', NULL, NULL, 'Olivia Davis','(555) 987-6543','assigned','${TECH}', now() - interval '5 minutes', NULL, NULL, NULL, '["Pedicure Deluxe"]'::jsonb),
    ('${TKX}','${T}','${B}', NULL, NULL, 'Hidden Customer','(555) 000-0000','assigned','${TECH2}', now(), NULL, NULL, NULL, '["Gel Manicure"]'::jsonb)`);
  // service lines for ticket A (3 lines → $105.00 total, 90 min)
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    (gen_random_uuid(),'${T}','${B}','${TID_A}', gen_random_uuid(), '${TECH}','Acrylic Full Set',7000,60,'percent',40,7000,'pending',0),
    (gen_random_uuid(),'${T}','${B}','${TID_A}', gen_random_uuid(), '${TECH}','Gel Polish',1500,15,'percent',40,1500,'pending',0),
    (gen_random_uuid(),'${T}','${B}','${TID_A}', gen_random_uuid(), '${TECH}','Nail Art – Simple',2000,15,'percent',40,2000,'pending',0)`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new TechService(new KyselyTechRepository(k));
  const ctx: TechContext = { tenantId: T, branchId: B, userId: U, role: 'TECHNICIAN' as any, permissions: [] };
  const ctx2: TechContext = { tenantId: T, branchId: B, userId: U2, role: 'TECHNICIAN' as any, permissions: [] };

  try {
    // ---- rich ticket detail ----
    const d = await svc.getTicketDetail(ctx, TKA);
    ok('ticket detail: customer name', d.customerName === 'Jennifer Lee', d.customerName || '');
    ok('ticket detail: phone is masked to last 4 (privacy)', d.customerPhoneMasked === '•••-•••-4567', d.customerPhoneMasked || '');
    ok('ticket detail: 3 service lines', (d.services?.length ?? 0) === 3, String(d.services?.length));
    ok('ticket detail: total = $105.00 (10500 cents)', d.totalCents === 10500, String(d.totalCents));
    ok('ticket detail: duration = 90 min', d.durationMinutes === 90, String(d.durationMinutes));
    ok('ticket detail: status maps in_service → serving', d.status === 'serving', d.status);
    ok('ticket detail: acceptedAt + startedAt present', !!d.acceptedAt && !!d.startedAt);
    ok('ticket detail: completedAt null while in service', d.completedAt == null, String(d.completedAt));
    ok('ticket detail: ticketNumber derived', !!d.ticketNumber && d.ticketNumber.startsWith('#'), d.ticketNumber);

    // ---- tickets list ----
    const list = await svc.getTickets(ctx);
    ok('tickets list: only this technician’s tickets (2: A + B, not TECH2’s X)', list.length === 2, JSON.stringify(list.map((t) => t.customerName)));
    const aRow = list.find((t) => t.customerName === 'Jennifer Lee');
    ok('tickets list: ticket A total = 10500', aRow?.totalCents === 10500, String(aRow?.totalCents));
    const bRow = list.find((t) => t.customerName === 'Olivia Davis');
    ok('tickets list: ticket B serviceSummary from requested_services', bRow?.serviceSummary === 'Pedicure Deluxe', bRow?.serviceSummary || '');

    // ---- queue ----
    const q = await svc.getQueue(ctx);
    ok('queue: upNext is the soonest pending (Olivia)', q.upNext?.name === 'Olivia Davis', q.upNext?.name || '');
    ok('queue: turnPosition reflects pending count', q.turnPosition === 1, String(q.turnPosition));
    ok('queue: not on break', q.onBreak === false);

    // ---- more / profile ----
    const m = await svc.getMore(ctx);
    ok('more: identity name', m.technician.fullName === 'Amy Nguyen', m.technician.fullName);
    ok('more: role label', m.technician.roleLabel === 'Nail Technician', m.technician.roleLabel);
    ok('more: working-hours/skills null (no schema columns, not fabricated)', m.workingHoursLabel === null && m.skillsLabel === null);

    // ---- add note (round-trips into the ticket) ----
    const afterNote = await svc.addNote(ctx, TKA, { note: 'Soft pink tones requested', visibility: 'internal' });
    ok('add note: appended to ticket notes', !!afterNote.notes && afterNote.notes.includes('Soft pink tones requested'), afterNote.notes || '');

    // ---- ownership / tenant isolation ----
    let forbidden = false;
    try { await svc.getTicketDetail(ctx, TKX); } catch (e) { forbidden = e instanceof TechError && e.code === 'forbidden'; }
    ok('isolation: cannot open another technician’s ticket (forbidden)', forbidden);
    let notFoundOtherTenant = false;
    const ctxOtherTenant: TechContext = { tenantId: T2, branchId: B2, userId: U, role: 'TECHNICIAN' as any, permissions: [] };
    try { await svc.getTicketDetail(ctxOtherTenant, TKA); } catch (e) { notFoundOtherTenant = e instanceof TechError && (e.code === 'not_technician' || e.code === 'not_found'); }
    ok('isolation: other tenant cannot see this ticket', notFoundOtherTenant);

    // ---- lifecycle: accept (B) → start → service-done, with DB-valid statuses ----
    // B is 'assigned' → accept
    const acc = await svc.accept(ctx, TKB);
    ok('lifecycle: accept moves assigned → accepted', acc.status === 'accepted', acc.status);
    const started = await svc.startService(ctx, TKB);
    ok('lifecycle: start moves accepted → serving (stored in_service)', started.status === 'serving', started.status);
    const qstat = (await db.query<{ status: string }>(`select status from pos_tech_queue_tickets where id='${TKB}'`)).rows[0];
    ok('lifecycle: stored status is DB-valid in_service (passes CHECK)', qstat.status === 'in_service', qstat.status);
    // service-done on A (it has service lines) → lines completed + detail shows done
    const done = await svc.serviceDone(ctx, TKA, { notes: 'All set' });
    ok('lifecycle: service-done derives status done from completed lines', done.status === 'done', done.status);
    ok('lifecycle: service-done sets completedAt', !!done.completedAt);
    const lines = (await db.query<{ status: string; completed_at: string | null }>(`select status, completed_at from ticket_service_lines where ticket_id='${TID_A}'`)).rows;
    ok('lifecycle: all service lines completed in DB', lines.length === 3 && lines.every((l) => l.status === 'completed' && !!l.completed_at), JSON.stringify(lines.map((l) => l.status)));

    // ---- request cancel (records request; tech can't hard-cancel) ----
    await svc.requestCancel(ctx, TKB, { reason: 'Customer left' });
    const cx = (await db.query<{ notes: string | null }>(`select notes from pos_tech_queue_tickets where id='${TKB}'`)).rows[0];
    ok('request-cancel: cancellation request recorded in notes for the front desk', !!cx.notes && cx.notes.includes('cancel-requested'), cx.notes || '');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e));
    console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-tech: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
