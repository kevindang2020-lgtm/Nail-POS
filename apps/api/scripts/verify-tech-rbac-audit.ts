/* verify-tech-rbac-audit.ts — proves granular tech.* permission enforcement and the §27 audit trail over REAL Postgres
 * (PGlite, incl. migration 051). A full-permission session performs view/accept/start/note/done/earnings and we assert
 * one audit row per action (technician-scoped, NO private note content). A tech.*-aware session missing tech.ticket.accept
 * is blocked (no audit row). A legacy session (no tech.* keys) is allowed (backward compatible). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyTechRepository } from '../../../modules/queue/src/tech/tech.kysely.repository';
import { TechService, TechError } from '../../../modules/queue/src/tech/tech.service';
import type { TechContext } from '../../../modules/queue/src/tech/tech.repository';
import { permissionsFor } from '../../../packages/permissions/src/rbac';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5473;
  const T = '00000000-0000-0000-0000-00000000a201', B = '00000000-0000-0000-0000-00000000b201';
  const U = '00000000-0000-0000-0000-00000000c201', TECH = '00000000-0000-0000-0000-00000000d201';
  const TKA = '00000000-0000-0000-0000-00000000e201', TKB = '00000000-0000-0000-0000-00000000e202', TKC = '00000000-0000-0000-0000-00000000e203';
  const TID_A = '00000000-0000-0000-0000-00000000f201';
  const SECRET = 'square shape soft pink — confidential';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot','pilot-r1','PILOTR1')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${TECH}','${T}','${B}','${U}','Amy','Nguyen','Amy Nguyen','available','percent',40,true)`);
  await db.exec(`INSERT INTO pos_tech_queue_tickets (id, tenant_id, branch_id, ticket_id, customer_name, status, assigned_technician_id, requested_services) VALUES
    ('${TKA}','${T}','${B}','${TID_A}','Jennifer Lee','assigned','${TECH}','[]'::jsonb),
    ('${TKB}','${T}','${B}',NULL,'Olivia Davis','assigned','${TECH}','["Pedicure"]'::jsonb),
    ('${TKC}','${T}','${B}',NULL,'Mia Anderson','assigned','${TECH}','["Gel"]'::jsonb)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    (gen_random_uuid(),'${T}','${B}','${TID_A}', gen_random_uuid(), '${TECH}','Acrylic Full Set',7000,60,'percent',40,7000,'pending',0)`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new TechService(new KyselyTechRepository(k));
  const full: TechContext = { tenantId: T, branchId: B, userId: U, role: 'TECHNICIAN' as any, permissions: permissionsFor('TECHNICIAN') as string[] };
  const noAccept: TechContext = { ...full, permissions: (permissionsFor('TECHNICIAN') as string[]).filter((p) => p !== 'tech.ticket.accept') };
  const legacy: TechContext = { ...full, permissions: ['pos.login', 'dashboard.view'] };

  const actions = async () => (await db.query<{ action: string; ticket_id: string | null; technician_id: string | null; metadata: any }>(`select action, ticket_id, technician_id, metadata from technician_audit_logs where tenant_id='${T}' order by created_at asc`)).rows;

  try {
    // ---- full permissions: a full lifecycle, each step audited ----
    await svc.getTicketDetail(full, TKA);
    await svc.accept(full, TKA);
    await svc.startService(full, TKA);
    await svc.addNote(full, TKA, { note: SECRET, visibility: 'internal' });
    await svc.serviceDone(full, TKA, {});
    await svc.getEarningsDetail(full, 'day');

    const rows = await actions();
    const acts = rows.map((r) => r.action);
    for (const a of ['technician_ticket_viewed', 'technician_ticket_accepted', 'technician_service_started', 'technician_note_added', 'technician_service_completed', 'technician_earnings_viewed'])
      ok(`audit row written: ${a}`, acts.includes(a));
    ok('audit rows are technician-scoped', rows.every((r) => r.technician_id === TECH));
    ok('ticket actions carry ticket_id', rows.filter((r) => r.action.startsWith('technician_ticket') || r.action.includes('service') || r.action === 'technician_note_added').every((r) => !!r.ticket_id || r.action === 'technician_earnings_viewed'));
    ok('audit NEVER stores the private note body', !rows.some((r) => JSON.stringify(r.metadata || {}).includes('confidential')), JSON.stringify(rows.map((r) => r.metadata)));
    // the note body DOES live on the ticket (that's correct — it's the ticket, not the audit log)
    const tkNotes = (await db.query<{ notes: string | null }>(`select notes from pos_tech_queue_tickets where id='${TKA}'`)).rows[0];
    ok('note body persisted on the ticket (not the audit log)', !!tkNotes.notes && tkNotes.notes.includes('confidential'));

    // ---- restricted session: accept blocked, no audit row ----
    let blocked = false;
    try { await svc.accept(noAccept, TKB); } catch (e) { blocked = e instanceof TechError && e.code === 'forbidden'; }
    ok('restricted session: accept is forbidden', blocked);
    const afterBlock = await actions();
    ok('restricted session: NO accepted audit row for the blocked ticket', !afterBlock.some((r) => r.action === 'technician_ticket_accepted' && r.ticket_id === TKB));
    const tkbStatus = (await db.query<{ status: string }>(`select status from pos_tech_queue_tickets where id='${TKB}'`)).rows[0];
    ok('restricted session: ticket state unchanged (still assigned)', tkbStatus.status === 'assigned', tkbStatus.status);

    // ---- legacy session (no tech.* keys): accept allowed ----
    const v = await svc.accept(legacy, TKC);
    ok('legacy session: accept allowed (backward compatible)', v.status === 'accepted', v.status);
    const afterLegacy = await actions();
    ok('legacy session: accepted audit row recorded for its ticket', afterLegacy.some((r) => r.action === 'technician_ticket_accepted' && r.ticket_id === TKC));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-tech-rbac-audit: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
