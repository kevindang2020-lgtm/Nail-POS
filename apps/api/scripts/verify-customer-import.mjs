/**
 * verify-customer-import.mjs — end-to-end check of the bulk customer CSV import at scale.
 *
 * Generates a CSV of N customers (default 50,000) with realistic names/phones/emails/birthdays plus ~4% duplicate rows,
 * a handful of malformed emails, and a few name-only rows, then exercises the real endpoints:
 *   POST /pos/customers/import/preview  (dry run — classifies create/duplicate/error, writes nothing)
 *   POST /pos/customers/import/commit   (batched insert into the tenant customers table)
 * It asserts the counts, confirms the tenant customer total grew by the created amount, and that a second commit is
 * idempotent for contactable rows. Customers land in the tenant's own table — the same Postgres the tenant AI
 * customer-insights reads — so one import covers both "tenant POS" and "AI lookup" while preserving tenant isolation.
 *
 * Assumes an API is running (sandbox) at BASE with the JSON body limit raised (MAX_BODY_SIZE, default 25mb in main.ts).
 *   BASE=http://127.0.0.1:3000 SALON=LUXE IDENT=owner@luxenails.test PASSWORD='Owner123!' ROWS=50000 \
 *   node apps/api/scripts/verify-customer-import.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SALON = process.env.SALON || 'LUXE';
const IDENT = process.env.IDENT || 'owner@luxenails.test';
const PASSWORD = process.env.PASSWORD || 'Owner123!';
const UNIQUE = Number(process.env.ROWS || 48000);     // unique customers
const DUPES = Math.round(UNIQUE / 24);                // ~4% duplicate rows
const NAME_ONLY = 20;

let cookie = ''; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '\u2705' : '\u274c'} ${n}${x ? ' \u2014 ' + x : ''}`); c ? pass++ : fail++; };
async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}

function buildCsv() {
  const first = ['Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kara', 'Liam', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Ruby', 'Sam', 'Tina', 'An', 'Binh', 'Chau', 'Minh', 'Linh', 'Trang'];
  const last = ['Nguyen', 'Tran', 'Le', 'Pham', 'Smith', 'Johnson', 'Williams', 'Brown', 'Garcia', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong', 'Ly'];
  const rows = ['first name,last name,phone,email,birthday'];
  for (let i = 0; i < UNIQUE; i++) {
    const f = first[i % first.length], l = last[(i * 7) % last.length];
    const phone = '+1609' + String(2000000 + i);
    let email = (f + '.' + l + i + '@example.com').toLowerCase();
    if (i % 1600 === 0) email = 'broken-email-' + i;
    const y = 1950 + (i % 60), m = 1 + (i % 12), d = 1 + (i % 28);
    const bday = i % 3 === 0 ? `${m}/${d}/${y}` : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    rows.push(`${f},${l},${phone},${email},${bday}`);
  }
  for (let i = 0; i < NAME_ONLY; i++) rows.push(`Guest${i},,,,`);
  for (let i = 0; i < DUPES; i++) { const j = i * 3; const f = first[j % first.length], l = last[(j * 7) % last.length]; rows.push(`${f},${l},+1609${2000000 + j},dup${i}@example.com,`); }
  return rows.join('\n');
}

(async () => {
  const csv = buildCsv();
  const expectCreate = UNIQUE + NAME_ONLY;
  console.log(`CSV: ${csv.split('\n').length - 1} data rows, ${(Buffer.byteLength(csv) / 1048576).toFixed(1)} MB (expect ~${expectCreate} to create, ${DUPES} duplicates)\n`);

  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: SALON, identifier: IDENT, password: PASSWORD });
  // a person with more than one branch signs in WITHOUT a branch and picks one (the POS shows the picker) — the active one
  if (r.j?.outcome === 'BRANCH_SELECTION_REQUIRED') {
    const bl = await req('GET', '/auth/branches');
    const pick = (bl.j?.branches || []).find((b) => b.isActive !== false);
    if (pick) r = await req('POST', '/auth/select-branch', { branchId: pick.id ?? pick.branchId });
    r = { ...r, j: { ...(r.j || {}), outcome: r.status < 300 ? 'SUCCESS' : 'SELECT_BRANCH_FAILED' } };
  }
  ok('owner login', r.j?.outcome === 'SUCCESS', r.j?.outcome);
  if (!cookie) { console.log('no session; abort'); process.exit(1); }

  const beforeCount = (await req('GET', '/pos/customers/kpis')).j?.totalCustomers ?? 0;

  let t = Date.now();
  r = await req('POST', '/pos/customers/import/preview', { csv });
  const pms = Date.now() - t;
  ok('PREVIEW accepts the large file (no 413)', r.status === 200 || r.status === 201, `status=${r.status}`);
  const pv = r.j || {};
  if (r.j) console.log(`  preview: totalRows=${pv.totalRows} toCreate=${pv.toCreate} duplicates=${pv.duplicates} invalidEmailsDropped=${pv.invalidEmailsDropped} (${pms}ms)`);
  ok('preview accounts for every row (create + duplicate + error = total)', (pv.toCreate + pv.duplicates + pv.errors) === pv.totalRows, `${pv.toCreate}+${pv.duplicates}+${pv.errors} vs ${pv.totalRows}`);
  ok('preview created the bulk of the file', pv.toCreate > UNIQUE * 0.9, `toCreate=${pv.toCreate}`);
  ok('dedup actually fired (duplicates detected)', pv.duplicates > 0, `duplicates=${pv.duplicates}`);

  t = Date.now();
  r = await req('POST', '/pos/customers/import/commit', { csv });
  const cms = Date.now() - t;
  ok('COMMIT succeeds', r.status === 200 || r.status === 201, `status=${r.status}`);
  const rv = r.j || {};
  if (r.j) console.log(`  commit: created=${rv.created} duplicatesSkipped=${rv.duplicatesSkipped} (${cms}ms, ${(rv.created / (cms / 1000)).toFixed(0)} rows/sec)`);
  ok('commit AGREES with the preview (same create + duplicate counts)', rv.created === pv.toCreate && rv.duplicatesSkipped === pv.duplicates, `created=${rv.created} vs toCreate=${pv.toCreate}`);

  const afterCount = (await req('GET', '/pos/customers/kpis')).j?.totalCustomers ?? 0;
  console.log(`  tenant customers: ${beforeCount} \u2192 ${afterCount} (\u0394 ${afterCount - beforeCount})`);
  ok('persisted: tenant total grew by EXACTLY the created amount', afterCount - beforeCount === rv.created, `\u0394=${afterCount - beforeCount}`);

  r = await req('POST', '/pos/customers/import/commit', { csv });
  ok('re-import is idempotent for contactable rows', (r.j?.created ?? 999) <= NAME_ONLY, `created=${r.j?.created} dupSkipped=${r.j?.duplicatesSkipped}`);

  console.log(`\n${fail === 0 ? '\u2705 BULK CUSTOMER IMPORT VERIFIED' : '\u274c FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
