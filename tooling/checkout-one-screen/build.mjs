// build.mjs — bundle the REAL Front Desk POS (apps/pos-web/src/main.tsx) for the Checkout one-screen harness, in an
// environment without the repo's node_modules (Checkout One-Screen mandate, Oct 28 2026). Uses esbuild + React 19 +
// Tailwind 4 from /opt/npm-tools (TOOLS env to override). Stand-ins (tooling only, never shipped): react-router-dom
// (shim/react-router-dom.js), leaflet and native Capacitor modules (shim/*). The product code is bundled unchanged.
//   node tooling/checkout-one-screen/build.mjs  →  tooling/checkout-one-screen/out/{index.html,app.js,app.css}
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..', '..');
const TOOLS = process.env.TOOLS || '/opt/npm-tools/node_modules';
const req = createRequire(join(TOOLS, 'x.js'));
const esbuild = req('esbuild');
// APP=admin-web bundles the Super Admin app instead (Loyalty Network control centre harness, Oct 30 2026) → out-admin/
const APP = process.env.APP || 'pos-web';
const OUT = join(HERE, APP === 'pos-web' ? 'out' : 'out-' + APP.replace(/-web$/, '')); mkdirSync(OUT, { recursive: true });

const tryFile = (p) => { for (const c of [p, p + '.ts', p + '.tsx', p + '/index.ts', p + '/index.tsx', p + '.js']) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
const FIXED = {
  'react-router-dom': join(HERE, 'shim/react-router-dom.js'),
  leaflet: join(HERE, 'shim/leaflet.js'), 'lucide-react': join(HERE, 'shim/lucide-react.js'),
  'firebase/app': join(HERE, 'shim/native.js'), 'firebase/messaging': join(HERE, 'shim/native.js'),
  '@capacitor/core': join(HERE, 'shim/native.js'), 'capacitor-secure-storage-plugin': join(HERE, 'shim/native.js'), '@capgo/capacitor-native-biometric': join(HERE, 'shim/native.js'), '@tanstack/react-query': join(HERE, 'shim/native.js'),
};
const plugin = {
  name: 'aps',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-skip' }));   // Tailwind is compiled below
    b.onLoad({ filter: /.*/, namespace: 'css-skip' }, () => ({ contents: '', loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, (a) => {
      if (FIXED[a.path]) return { path: FIXED[a.path] };
      if (a.path.startsWith('@aipowersalon/')) {
        const [, pkg, ...rest] = a.path.split('/');
        const f = tryFile(join(ROOT, 'packages', pkg, 'src', ...rest)) ?? tryFile(join(ROOT, 'modules', pkg, 'src', ...rest));
        if (f) return { path: f };
      }
      if (/^@capacitor(-community)?\//.test(a.path)) return { path: join(HERE, 'shim/native.js') };   // owner / customer apps' native plugins (tooling stand-in)
      if (/^(react|react-dom|scheduler|react-icons|@tanstack|qrcode-generator)(\/|$)/.test(a.path)) { try { return { path: req.resolve(a.path) }; } catch { return { path: join(HERE, 'shim/native.js') }; } }
      return undefined;
    });
  },
};
const t0 = Date.now();
const r = await esbuild.build({
  entryPoints: [join(ROOT, `apps/${APP}/src/main.tsx`)], bundle: true, format: 'esm', outfile: join(OUT, 'app.js'), jsx: 'automatic',
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' }, plugins: [plugin], logLevel: 'error', minify: false, sourcemap: false,
  define: { 'import.meta.env.VITE_APP_VERSION': '"harness"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'process.env.NODE_ENV': '"production"' },
  nodePaths: [TOOLS], metafile: true,
}).catch((e) => { console.error(e.errors?.map((x) => x.text + ' @ ' + (x.location?.file ?? '')).join('\n') || e); process.exit(1); });

// Tailwind 4: compile apps/pos-web/src/styles.css with the candidates found in the POS + ui sources (no oxide scanner here)
const tw = req('tailwindcss');
const css = readFileSync(join(ROOT, `apps/${APP}/src/styles.css`), 'utf8');
const files = []; const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) { if (!/node_modules|dist|test/.test(e)) walk(p); } else if (/\.(tsx?|jsx?|html)$/.test(e)) files.push(p); } };
walk(join(ROOT, `apps/${APP}/src`)); walk(join(ROOT, 'packages/ui/src'));
const cand = new Set(); for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/[A-Za-z0-9_\-:/.[\]#%(),!>=*&@~'"+]+/g)) for (const t of m[0].split(/["'`]/)) if (t && t.length < 120) cand.add(t);
const compiler = await tw.compile(css, { base: join(ROOT, `apps/${APP}/src`), loadStylesheet: async (id, base) => { const p = id === 'tailwindcss' ? join(TOOLS, 'tailwindcss/index.css') : resolvePath(base, id); return { path: p, base: dirname(p), content: readFileSync(p, 'utf8') }; } });
const outCss = compiler.build([...cand]);
const FONTS = `@font-face{font-family:'Hanken Grotesk';src:local('Inter');font-weight:100 900}@font-face{font-family:'Playfair Display';src:local('DejaVu Serif');font-weight:100 900}\n`;
writeFileSync(join(OUT, 'app.css'), FONTS + outCss);
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>AI PowerSalon — POS</title><script>window.APS_API_BASE='';</script><link rel="stylesheet" href="/app.css"/></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
const kb = (n) => Math.round(n / 1024);
console.log(`built in ${Date.now() - t0} ms: app.js ${kb(statSync(join(OUT, 'app.js')).size)} KB, app.css ${kb(outCss.length)} KB, ${Object.keys(r.metafile.inputs).length} inputs`);
