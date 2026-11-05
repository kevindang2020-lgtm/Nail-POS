import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'crypto';
import { PosSearchKyselyRepository } from '../dist/pos/pos-search.kysely.repository.js';

const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ host:'/tmp', port:5433, user:'postgres', database:'aps_iso' }) }) });
const repo = new PosSearchKyselyRepository(db);
const A='11111111-1111-1111-1111-111111111111', brA='aaaaaaaa-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222', brB='bbbbbbbb-2222-2222-2222-222222222222';
const NAME='Zephyr Iso Testperson';   // IDENTICAL name seeded in BOTH tenants
const ids = {};

for (const [t,br,tag] of [[A,brA,'A'],[B,brB,'B']]) {
  const cid=randomUUID(), tech=randomUUID(); ids['cust'+tag]=cid; ids['tech'+tag]=tech;
  await sql`INSERT INTO customers (id,tenant_id,branch_id,first_name,last_name,full_name,status) VALUES (${cid},${t},${br},'Zephyr','Iso',${NAME},'active')`.execute(db);
  await sql`INSERT INTO technicians (id,tenant_id,branch_id,first_name,last_name,full_name,status) VALUES (${tech},${t},${br},'Zephyr','IsoTech',${NAME},'active')`.execute(db);
  await sql`INSERT INTO pos_tech_appointments (id,tenant_id,branch_id,technician_id,customer_id,customer_name,appt_date,start_time,end_time,status)
            VALUES (${randomUUID()},${t},${br},${tech},${cid},${NAME},current_date,now(),now()+interval '1 hour','booked')`.execute(db);
}

let fail=0;
const scopeA={ tenantId:A, branchId:brA };
async function check(label, rows, ownTenantFn){
  let leak=false;
  for (const r of rows){ const owner=await ownTenantFn(r.id); if(owner!==A){ leak=true; console.log(`  ✗ LEAK in ${label}: row ${String(r.id).slice(0,8)} belongs to ${owner}`);} }
  console.log(`${label}: ${rows.length} row(s) as tenant A ->`, rows.length>=1?'returns results ✓':'0 results', leak?'CROSS-TENANT LEAK ✗✗':'no leak ✓');
  if (leak || rows.length<1) fail++;
}
await check('customers', await repo.customers(scopeA,'Zephyr',20), async id=>(await sql`SELECT tenant_id FROM customers WHERE id=${id}`.execute(db)).rows[0]?.tenant_id);
await check('technicians', await repo.technicians(scopeA,'Zephyr',20), async id=>(await sql`SELECT tenant_id FROM technicians WHERE id=${id}`.execute(db)).rows[0]?.tenant_id);
await check('appointments (joined, fixed table)', await repo.appointments(scopeA,'Zephyr',20), async id=>(await sql`SELECT tenant_id FROM pos_tech_appointments WHERE id=${id}`.execute(db)).rows[0]?.tenant_id);

// cleanup
for (const t of [A,B]){ await sql`DELETE FROM pos_tech_appointments WHERE tenant_id=${t}`.execute(db); await sql`DELETE FROM technicians WHERE tenant_id=${t}`.execute(db); await sql`DELETE FROM customers WHERE tenant_id=${t}`.execute(db);}
await db.destroy();
console.log(fail===0 ? '\nSEARCH_ISOLATION_OK — tenant A sees only its own rows across all groups; identical-named tenant B data never leaks.' : `\nSEARCH_ISOLATION_FAIL (${fail})`);
process.exit(fail?1:0);
