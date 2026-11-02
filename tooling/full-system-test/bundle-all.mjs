// bundle every frontend app's entry with esbuild (resolve errors, syntax, missing modules) — tooling only
import { createRequire } from 'node:module'; import { existsSync, statSync, readdirSync } from 'node:fs'; import { join } from 'node:path';
const ROOT = process.argv[2]; const HERE = join(ROOT, 'tooling/checkout-one-screen'); const TOOLS = '/opt/npm-tools/node_modules';
const req = createRequire(join(TOOLS, 'x.js')); const esbuild = req('esbuild');
const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', p + '/index.ts', p + '/index.tsx', p + '.js']) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
const FIXED = { 'react-router-dom': join(HERE, 'shim/react-router-dom.js'), leaflet: join(HERE, 'shim/leaflet.js'), 'lucide-react': join(HERE, 'shim/lucide-react.js') };
const plugin = { name: 'aps', setup(b) {
  b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-skip' })); b.onLoad({ filter: /.*/, namespace: 'css-skip' }, () => ({ contents: '', loader: 'js' }));
  b.onResolve({ filter: /^[^./]/ }, (a) => { if (FIXED[a.path]) return { path: FIXED[a.path] };
    if (a.path.startsWith('@aipowersalon/')) { const [, pkg, ...rest] = a.path.split('/'); const f = tryFile(join(ROOT, 'packages', pkg, 'src', ...rest)) ?? tryFile(join(ROOT, 'modules', pkg, 'src', ...rest)); if (f) return { path: f }; return { errors: [{ text: 'unresolved workspace import ' + a.path }] }; }
    if (/^(react|react-dom|scheduler|react-icons|qrcode-generator)(\/|$)/.test(a.path)) { try { return { path: req.resolve(a.path) }; } catch { return { path: join(HERE, 'shim/native.js') }; } }
    return { path: join(ROOT, 'tooling/full-system-test/stub.cjs') };   // any other third-party module: a stand-in (we only want OUR code's errors)
  }); } };
for (const app of readdirSync(join(ROOT, 'apps'))) { const entry = tryFile(join(ROOT, 'apps', app, 'src/main')); if (!entry) { console.log(`-- ${app}: no src/main entry`); continue; }
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.json': 'json' }, plugins: [plugin], logLevel: 'silent', define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'process.env.NODE_ENV': '"production"' }, nodePaths: [TOOLS] }).catch((e) => e);
  const errs = r.errors || []; const warns = (r.warnings || []).filter((w) => !/Unused|ignored/.test(w.text));
  console.log(`== ${app}: ${errs.length} error(s), ${warns.length} warning(s)${r.outputFiles ? ', ' + Math.round(r.outputFiles[0].contents.length / 1024) + ' KB' : ''}`);
  for (const x of errs.slice(0, 12)) console.log('   ERR ' + x.text + ' @ ' + (x.location?.file ?? '') + ':' + (x.location?.line ?? ''));
  for (const x of warns.slice(0, 8)) console.log('   WARN ' + x.text + ' @ ' + (x.location?.file ?? '') + ':' + (x.location?.line ?? ''));
}
