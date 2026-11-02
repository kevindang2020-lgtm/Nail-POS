// e2e-skill.mjs — technician skill-based assignment. A tech mapped to the service's category can be assigned WITHOUT a
// manager override; a tech NOT mapped is correctly rejected without override and allowed WITH override. Proves the skill
// gate is data-driven (technician_services → service categories), not a blanket "always needs override".
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 160); } catch { return String(j); } };
const mark = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
function mkClient() { let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json }; };
}
const rnd = Math.floor(1000 + Math.random() * 8999);
const api = mkClient();
// Walk a fresh check-in to a queued item assigned to NO technician yet (so assign-technician is exercised for real).
async function queuedItem(serviceId, tag) {
  let r = await api('POST', '/pos/check-in/walk-in', { customerName: `Skill ${tag} ${rnd}`, customerPhone: '+1856' + rnd + '0' + Math.floor(Math.random()*900+100), serviceIds: [serviceId], isNewCustomer: true });
  const ci = r.json?.checkInId; r = await api('POST', `/pos/check-in/${ci}/move-to-queue`); return r.json?.queueItemId;
}
(async () => {
  let r = await api('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status}`);
  r = await api('POST', '/pos/services/categories', { name: 'Skill Cat ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await api('POST', '/pos/services', { name: 'Skill Svc ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.json?.serviceId || r.json?.id;
  // skilled tech: mapped to the service (→ its category becomes a skill); unskilled tech: no mapping
  r = await api('POST', '/pos/technicians', { firstName: 'Skilled', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); const skilledTech = r.json?.technicianId || r.json?.id;
  r = await api('POST', '/pos/technicians', { firstName: 'Unskilled', lastName: 'Tech' + rnd, status: 'active' }); const unskilledTech = r.json?.technicianId || r.json?.id;
  mark('setup (service + skilled/unskilled techs)', !!(serviceId && skilledTech && unskilledTech), `svc=${!!serviceId} skilled=${!!skilledTech} unskilled=${!!unskilledTech}`);

  // skilled tech assigns with NO override
  let q = await queuedItem(serviceId, 'a');
  r = await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId: skilledTech });
  mark('skilled tech assigned WITHOUT override', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  // unskilled tech rejected without override
  q = await queuedItem(serviceId, 'b');
  r = await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId: unskilledTech });
  mark('unskilled tech REJECTED without override (expect 400)', r.status === 400, `${r.status} ${r.status === 400 ? '' : snip(r.json)}`);

  // unskilled tech allowed with override
  r = await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId: unskilledTech, managerOverride: true });
  mark('unskilled tech allowed WITH override', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
