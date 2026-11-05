import { signSession } from '../dist/auth/auth-session-token.js';
const SECRET='e2esecret', BASE='http://127.0.0.1:4599';
const A={ tenantId:'aaaaaaaa-0000-0000-0000-000000000001', branchId:'aaaaaaaa-0000-0000-0000-0000000000b1', userId:'aaaaaaaa-0000-0000-0000-0000000000c1' };
const PERMS=['global_search.use','pos.overview.view','pos.queue.view','pos.checkout.view','pos.technicians.view'];
const cookie='aps_session='+signSession({ userId:A.userId, tenantId:A.tenantId, branchId:A.branchId, role:'OWNER', permissions:PERMS, subscriptionStatus:'active' }, { secret: SECRET });
const get=async(p)=>{ const r=await fetch(BASE+p,{headers:{Cookie:cookie}}); let b=null; try{b=await r.json();}catch{} return {status:r.status,b}; };
const keys=(o)=>o&&typeof o==='object'?Object.keys(o):typeof o;
const arrLen=(x)=>Array.isArray(x)?x.length:(x&&typeof x==='object'?`{${Object.keys(x).length} keys}`:x);

for (const p of ['/pos/search?q=ZephyrBody','/pos/overview/state','/pos/overview/board','/pos/queue/state','/pos/checkout/state','/pos/technicians/live-schedule/state']) {
  const {status,b}=await get(p);
  console.log(`\n### ${p}  [${status}]`);
  console.log('top keys:', keys(b));
  if (b && typeof b==='object') for (const k of Object.keys(b)) {
    const v=b[k]; console.log(`  ${k}: ${Array.isArray(v)?`[array len ${v.length}]`:(v&&typeof v==='object'?`{${Object.keys(v).slice(0,8).join(',')}}`:JSON.stringify(v)?.slice(0,60))}`);
  }
}
