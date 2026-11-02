// fe-contract.mts — drive the REAL pos-web api modules through the full POS money-path lifecycle against a live API,
// proving the SPA's client code speaks the backend protocol (paths, methods, bodies). Run with: npx tsx <thisfile>.
// We shim global fetch the way a browser would: rewrite root-relative URLs to the API origin and keep a session-cookie
// jar. Everything else is the unmodified frontend code. Only the React rendering layer is out of scope here.
const ORIGIN = process.env.FE_ORIGIN || 'http://127.0.0.1:3000';
let cookie = '';
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init: any = {}) => {
  let u = String(typeof input === 'string' ? input : input?.url ?? input);
  if (u.startsWith('/')) u = ORIGIN + u;
  else if (!/^https?:\/\//.test(u)) u = ORIGIN + '/' + u;
  const headers = { ...(init.headers || {}) };
  if (cookie) (headers as any)['Cookie'] = cookie;
  const res = await realFetch(u, { ...init, headers });
  const setC = (res.headers as any).getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  for (const sc of setC) { const m = String(sc).match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  return res;
}) as any;

const { authApi } = await import('../src/api/authApi.ts');
const { posServicesApi } = await import('../src/api/posServicesApi.ts');
const { posTechniciansApi } = await import('../src/api/posTechniciansApi.ts');
const { posCheckInApi } = await import('../src/api/posCheckInApi.ts');
const { posQueueApi } = await import('../src/api/posQueueApi.ts');
const { posServingApi } = await import('../src/api/posServingApi.ts');
const { posServiceDoneApi } = await import('../src/api/posServiceDoneApi.ts');
const { posCheckoutApi } = await import('../src/api/posCheckoutApi.ts');

let pass = 0, fail = 0;
const mark = (n: string, ok: boolean, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
const idOf = (o: any, ...keys: string[]) => { for (const k of keys) if (o && o[k]) return o[k]; return undefined; };
const rnd = Math.floor(1000 + Math.random() * 8999);

try {
  const login: any = await authApi.login({ portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('authApi.login → SUCCESS', login?.outcome === 'SUCCESS', login?.outcome);

  const cat: any = await posServicesApi.createCategory({ name: `FE Cat ${rnd}`, colorKey: 'gold' });
  const categoryId = idOf(cat, 'categoryId', 'id');
  mark('posServicesApi.createCategory (NEW)', !!categoryId, `categoryId=${categoryId}`);

  const svc: any = await posServicesApi.create({ name: `FE Mani ${rnd}`, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' });
  const serviceId = idOf(svc, 'serviceId', 'id');
  mark('posServicesApi.create', !!serviceId, `serviceId=${serviceId}`);

  const tech: any = await posTechniciansApi.create({ firstName: 'FE', lastName: `Tech${rnd}`, status: 'active', serviceIds: [serviceId] });
  const technicianId = idOf(tech, 'technicianId', 'id');
  mark('posTechniciansApi.create (NEW)', !!technicianId, `technicianId=${technicianId}`);

  const ci: any = await posCheckInApi.walkIn({ customerName: `FE Cust ${rnd}`, customerPhone: `+1856${rnd}007`, serviceIds: [serviceId], technicianId, isNewCustomer: true });
  const checkInId = idOf(ci, 'checkInId', 'id');
  mark('posCheckInApi.walkIn', !!checkInId, `checkInId=${checkInId}`);

  const q: any = await posCheckInApi.moveToQueue(checkInId);
  const queueItemId = idOf(q, 'queueItemId', 'id');
  mark('posCheckInApi.moveToQueue', !!queueItemId, `queueItemId=${queueItemId}`);

  await posQueueApi.assignTechnician(queueItemId, { technicianId });
  mark('posQueueApi.assignTechnician', true);

  const serving: any = await posQueueApi.startService(queueItemId);
  const ticketId = idOf(serving, 'servingTicketId', 'ticketId', 'id') || queueItemId;
  mark('posQueueApi.startService', !!ticketId, `ticketId=${ticketId}`);

  await posServingApi.markServiceDone(ticketId);
  await posServingApi.sendToServiceDone(ticketId);
  mark('posServingApi.markServiceDone + sendToServiceDone', true);

  await posServiceDoneApi.qualityCheck(ticketId, { result: 'approved' });
  await posServiceDoneApi.sendToCheckout(ticketId);
  mark('posServiceDoneApi.qualityCheck + sendToCheckout', true);

  const paid: any = await posCheckoutApi.payCash(ticketId, { amountReceivedCents: 10000 });
  const payRec = paid?.payment ?? paid; // cash returns { payment, changeDueCents }
  mark('posCheckoutApi.payCash → approved', payRec?.status === 'approved' || !!idOf(payRec, 'paymentId'), `status=${payRec?.status} change=${paid?.changeDueCents}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e: any) {
  mark('lifecycle threw', false, e?.message + (e?.status ? ` (HTTP ${e.status})` : ''));
  console.log(`\n❌ FAILURES: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
