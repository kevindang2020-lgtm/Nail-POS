import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'crypto';
import { PosSearchKyselyRepository } from '../dist/pos/pos-search.kysely.repository.js';

const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ host:'/tmp', port:5433, user:'postgres', database:'aps_srch' }) }) });
const repo = new PosSearchKyselyRepository(db);
const A='11111111-1111-1111-1111-111111111111', brA='aaaaaaaa-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222', brB='bbbbbbbb-2222-2222-2222-222222222222';
const Q='Zephyrsearch';
const ID = {};

async function seedTenant(t, br, tag) {
  const cust=randomUUID(), tech=randomUUID(), tk=randomUUID();
  ID['cust'+tag]=cust;
  await sql`INSERT INTO customers (id,tenant_id,branch_id,first_name,last_name,full_name,status) VALUES (${cust},${t},${br},'Zephyr','S',${Q+' Customer'},'active')`.execute(db);
  await sql`INSERT INTO technicians (id,tenant_id,branch_id,first_name,last_name,full_name,status) VALUES (${tech},${t},${br},'Zephyr','S',${Q+' Tech'},'active')`.execute(db);
  await sql`INSERT INTO pos_tech_appointments (id,tenant_id,branch_id,technician_id,customer_id,customer_name,appt_date,start_time,end_time,status) VALUES (${randomUUID()},${t},${br},${tech},${cust},${Q+' Customer'},current_date,'10:00','11:00','booked')`.execute(db);
  await sql`INSERT INTO pos_queue_items (id,tenant_id,branch_id,customer_id,customer_name,status) VALUES (${randomUUID()},${t},${br},${cust},${Q+' Customer'},'waiting')`.execute(db);
  await sql`INSERT INTO tickets (id,tenant_id,branch_id,customer_id,ticket_number,status) VALUES (${tk},${t},${br},${cust},${Q.toUpperCase()+'-'+tag},'open')`.execute(db).catch(e=>console.log('  ticket seed('+tag+'):',String(e.message).slice(0,60)));
  await sql`INSERT INTO receipts (id,tenant_id,branch_id,ticket_id,receipt_number) VALUES (${randomUUID()},${t},${br},${tk},${Q.toUpperCase()+'-RCP-'+tag})`.execute(db).catch(e=>console.log('  receipt seed('+tag+'):',String(e.message).slice(0,60)));
  // services need a category — try to make one
  try {
    const cat=randomUUID();
    await sql`INSERT INTO service_categories (id,tenant_id,branch_id,name) VALUES (${cat},${t},${br},'ZCat')`.execute(db);
    await sql`INSERT INTO services (id,tenant_id,branch_id,category_id,name,duration_minutes,price_cents,status) VALUES (${randomUUID()},${t},${br},${cat},${Q+' Service'},30,5000,'active')`.execute(db);
  } catch(e){ console.log('  service seed('+tag+'):',String(e.message).slice(0,60)); }
}
await seedTenant(A,brA,'A'); await seedTenant(B,brB,'B');

const scopeA={ tenantId:A, branchId:brA };
async function ownerOf(table,id){ const r=await sql`SELECT tenant_id FROM ${sql.raw(table)} WHERE id=${id}`.execute(db); return r.rows[0]?.tenant_id; }
const groups=[
  ['customers','customers'],['technicians','technicians'],['appointments','pos_tech_appointments'],
  ['queue','pos_queue_items'],['tickets','tickets'],['receipts','receipts'],['services','services'],
];
let allOk=true;
for (const [method,table] of groups){
  const rows = await repo[method](scopeA, Q, 20);
  let leak=false;
  for (const r of rows){ const o=await ownerOf(table, r.id); if(o && o!==A){leak=true;} }
  const works = rows.length>=1, iso = !leak;
  if(!works||!iso) allOk=false;
  console.log(`${method.padEnd(13)} functional=${works?'✓':'✗ (0 rows)'}  isolated=${iso?'✓':'✗ LEAK'}  (${rows.length} row${rows.length===1?'':'s'})`);
}
// cleanup
for (const t of [A,B]){ for (const tbl of ['receipts','tickets','pos_queue_items','pos_tech_appointments','services','service_categories','technicians','customers']){ await sql`DELETE FROM ${sql.raw(tbl)} WHERE tenant_id=${t}`.execute(db).catch(()=>{}); } }
await db.destroy();
console.log('\n'+(allOk?'SEARCH_ALL_OK — every group returns results and is tenant-isolated.':'SEARCH_CHECK: some groups need attention (see above).'));
