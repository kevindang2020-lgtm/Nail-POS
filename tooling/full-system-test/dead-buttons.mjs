import { readFileSync, readdirSync, statSync } from 'node:fs'; import { join } from 'node:path';
const ROOT = process.argv[2];
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (!/node_modules|dist/.test(e)) walk(p, out); } else if (/\.tsx$/.test(e) && !/\.(test|spec)\./.test(e)) out.push(p); } return out; };
const tagEnd = (t, i) => { let depth = 0, q = null; for (let j = i; j < t.length; j++) { const c = t[j]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; continue; } if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) return j; } return -1; };
const out = [];
for (const f of walk(join(ROOT, 'apps'))) { const t = readFileSync(f, 'utf8'); let i = 0;
  while ((i = t.indexOf('<button', i)) >= 0) { const e = tagEnd(t, i); if (e < 0) break; const a = t.slice(i + 7, e); i = e;
    if (/onClick|onPointerDown|onMouseDown|onTouch|type=["']submit["']|\{\.\.\.|form=|onKeyDown|disabled/.test(a)) continue;
    const line = t.slice(0, i).split('\n').length; out.push(`${f.replace(ROOT + '/', '')}:${line}: <button${a.replace(/\s+/g, ' ').slice(0, 120)}>`); } }
console.log(out.length + ' enabled button(s) without a handler'); for (const l of out) console.log(l);
