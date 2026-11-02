// dead-routes: every string route a frontend navigates to vs the routes its router declares
import { readFileSync, readdirSync, statSync } from 'node:fs'; import { join } from 'node:path';
const ROOT = process.argv[2];
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (!/node_modules|dist|__tests__/.test(e)) walk(p, out); } else if (/\.(tsx|ts)$/.test(e) && !/\.(test|spec)\./.test(e)) out.push(p); } return out; };
for (const app of readdirSync(join(ROOT, 'apps'))) {
  const src = join(ROOT, 'apps', app, 'src'); try { statSync(src); } catch { continue; }
  const files = walk(src); let declared = new Set(); let basePrefix = '';
  for (const f of files) { const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/<Route\s+[^>]*path=["'`]([^"'`]+)["'`]/g)) declared.add(m[1]);
    for (const m of t.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g)) declared.add(m[1]);
  }
  if (!declared.size) continue;
  const norm = (r) => r.replace(/^\//, '').replace(/\/$/, '');
  const decl = [...declared].map(norm);
  const matches = (target) => { const t = norm(target.split('?')[0].split('#')[0]); if (t === '' ) return true;
    return decl.some((d) => { if (d === t) return true; if (d === '*') return false; const dp = d.split('/'), tp = t.split('/'); if (dp.at(-1) === '*') { const base = dp.slice(0, -1); return base.every((x, i) => x.startsWith(':') || x === tp[i]); } if (dp.length !== tp.length) return false; return dp.every((x, i) => x.startsWith(':') || x === tp[i]); }); };
  const dead = new Map();
  for (const f of files) { const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/(?:nav|navigate|go|open)\(\s*['"`](\/[^'"`$]*)['"`]/g)) { const r = m[1]; if (/^\/(api|http)/.test(r)) continue; if (!matches(r)) dead.set(r, [...(dead.get(r) || []), f.replace(ROOT + '/', '')]); }
    for (const m of t.matchAll(/\b(?:to|route|path|href)[=:]\s*["'](\/[^"'$]*)["']/g)) { const r = m[1]; if (/^\/(api|v1|go|assets)\//.test(r) || /\.(png|svg|pdf|csv|html|js|css)$/.test(r)) continue; if (!matches(r)) dead.set(r, [...(dead.get(r) || []), f.replace(ROOT + '/', '')]); }
    for (const m of t.matchAll(/href=["'](\/[^"'$:]*)["']/g)) { const r = m[1]; if (/\.(pdf|png|html|csv|js)$|^\/api|^\/go\//.test(r)) continue; if (!matches(r)) dead.set(r, [...(dead.get(r) || []), f.replace(ROOT + '/', '')]); }
  }
  console.log(`== ${app}: ${declared.size} routes declared, ${dead.size} navigation target(s) with no route`);
  for (const [r, fs] of [...dead].sort()) console.log(`   ${r}  ← ${[...new Set(fs)].slice(0, 3).join(', ')}`);
}
