/* frontend-calls.js — ONE extractor. Both route audits use it.
 *
 * == WHY THIS FILE EXISTS ==================================================================================
 *
 * `audit-crosswire.js` (does every frontend call hit a real route?) and `audit-unreached-routes.js` (does every
 * route have a caller?) are the same question asked from both ends. They had TWO COPIES of the extraction — and
 * the copies drifted, which is exactly what "reuse, never duplicate" exists to prevent.
 *
 * They drifted badly. Building the second audit turned up FIVE bugs in the extraction, every one of them also
 * present in the first:
 *
 *   1. A BASE-PATH CONSTANT collapsed into one wildcard.
 *          const CO = '/pos/checkout';   api.post(`${CO}/tickets/${id}/pay`)
 *      `${CO}` became a single `${}` segment, so a 3-segment route never matched its "2-segment" call.
 *
 *   2. AN ENTIRE CALL STYLE WAS INVISIBLE.
 *          http<any>(`${CO}/kpis`)                            → GET
 *          http<any>(`${CO}/tickets/${id}/pay`, { method:'POST' })
 *      A bare generic function with the verb in an options object. SIXTEEN api files use it — checkout, queue,
 *      serving, check-in, booking, tech-queue, tech-appointments, service-done, cash-drawer, skip-line,
 *      cash-handoff, live-technician-schedule, ai-queue-assignment, and three authApis. None of their calls has
 *      ever been checked by anything.
 *
 *   3. A BASE PATH HIDDEN INSIDE THE HELPER.
 *          const BASE = API_ORIGIN + '/pos/queue';
 *          async function http(path, init) { fetch(BASE + path, …) }
 *          kpis: () => http('/kpis')        ← the call site knows nothing about /pos/queue
 *
 *   4. THE GENERIC MATCHER SWALLOWED REAL CALLS. `<[\s\S]*?>` spans newlines, so from a function DEFINITION
 *      (`function http<T>(path: string…`) it would expand across the file to some later `>` and eat the next
 *      real call site whole.
 *
 *   5. And the naive fix for (4) — forbidding newlines — broke multi-line generics. A generic may span lines; it
 *      may never contain a paren, because the call's own `(` is the boundary. Hence `<[^()]*?>`.
 *
 * Plus: crosswire never scanned go-check-in-admin or go-check-in-kiosk at all.
 *
 * The lesson is the one audit-crosswire's own header already stated and then fell to: a checker is only as
 * trustworthy as its extractor, and a checker that cries wolf will not be believed on the day it is right.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');   // scripts/ -> apps/api -> apps

// Every app that talks to this API. go-check-in-* were missing from crosswire, so their calls looked like no
// calls at all and the routes they hit looked dead.
const APPS = [
  'admin-web', 'customer-web', 'manager-pay-web', 'owner-web', 'pos-web', 'tech-web', 'customer-display',
  'go-check-in-kiosk',   // go-check-in-admin removed in Phase 15 (Oct 10 2026) — admin-web /check-in-devices calls the same six routes
];

// `upload` is the client's multipart helper (client.ts: `fetch(path, { method: 'POST', body: form })`) — it is a POST
// call the extractor must SEE, or every avatar/cover/photo upload route looks unreached. See check:unreached's cover FP.
const M = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', del: 'DELETE', upload: 'POST' };

// A path that already names an API surface must not be prefixed again with the file's base.
const SURFACES = /^\/(pos|tech|owner|customer|super-admin|auth|account|public|jobs|webhooks|health|ai|messaging|tenant)\b/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'dist') continue; walk(p, out); }
    // .html too (Jul 28, 2026). go-check-in-admin and go-check-in-kiosk are SHIPPED single-file HTML apps whose
    // fetch() calls are as real as any client's — and they were listed in APPS while this line silently dropped
    // every one of their files, so the audit's "0 orphaned" was computed over a set that excluded them entirely.
    // A listed-but-unscanned app is worse than an unlisted one: it looks covered.
    else if (/\.(ts|tsx|html)$/.test(p) && !/\.(spec|test)\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Read a quoted/templated path literal starting at `i`, resolving `${IDENT}` against the file's constants. */
function readPath(text, i, quote, consts) {
  let lit = '';
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === quote) break;
    if (quote === '`' && c === '$' && text[i + 1] === '{') {
      let k = i + 2, d = 1, expr = '';
      for (; k < text.length && d > 0; k++) {
        if (text[k] === '{') d++;
        else if (text[k] === '}') { d--; if (!d) break; }
        expr += text[k];
      }
      const name = expr.trim();
      lit += Object.prototype.hasOwnProperty.call(consts, name) ? consts[name] : '${}';
      i = k;
      continue;
    }
    lit += c;
  }
  return { lit, end: i };
}

/** Keep reading `'a' + expr + 'b'` past the closing quote, turning each expression into a wildcard. */
function followConcat(text, j, lit) {
  for (;;) {
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== '+') break;
    j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === '"' || text[j] === "'" || text[j] === '`') {
      const q = text[j++];
      for (; j < text.length && text[j] !== q; j++) lit += text[j];
      j++;
    } else {
      // ── (7) AN EXPRESSION ENDS AT THE NEXT `+`, AND I DROPPED THAT ──────────────────────────────────────
      //
      //     const post = (qid, action, body) => http('/items/' + id(qid) + '/' + action, { method: 'POST' })
      //
      // Without a `+` terminator this consumer runs from `id(qid)` all the way to the comma, swallowing
      // `+ '/' + action` whole — so a 4-segment path came out as `/pos/queue/items/${}` with ONE wildcard, and
      // was reported as an orphan that would 404. It does not. `/pos/queue/items/:queueItemId/:action` exists.
      //
      // ALL FIFTEEN "orphans" this audit found on its first corrected run were this one bug. Fifteen findings
      // that were really one — which is the shape every false alarm takes, and the reason each one has to be
      // opened by hand before it is believed.
      let d = 0;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '(') d++;
        else if (c === ')') { if (d === 0) break; d--; }
        else if (d === 0 && (c === ',' || c === ';' || c === '+' || c === '\n')) break;
      }
      lit += '${}';
    }
  }
  return lit;
}

/** Every HTTP call every frontend makes: [{ method, path, file, app }]. */
function extractFrontendCalls() {
  const calls = [];

  for (const app of APPS) {
    // A listed app that is not on disk would silently contribute zero calls (and every route only it reached would look
    // dead, or worse, the audit would look like it covered it) — fail loudly instead.
    if (!fs.existsSync(path.join(ROOT, app))) throw new Error(`frontend-calls: listed app apps/${app} does not exist — update APPS`);
    // Roots per app. The single-file HTML apps (go-check-in-admin, go-check-in-kiosk) have NO src/ directory —
    // their whole app is index.html at the app root or under www/ — so walking only <app>/src returned zero files
    // for them and the audit silently covered nothing. Dedupe because <app> also contains src/.
    const roots = [path.join(ROOT, app, 'src'), path.join(ROOT, app), path.join(ROOT, app, 'www')];
    const files = [...new Set(roots.flatMap((r) => walk(r)))];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);

      // ── (1) base-path constants: const CO = '/pos/checkout';
      const consts = {};
      const cre = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`${}]*)\2\s*;/g;
      let cm;
      while ((cm = cre.exec(text))) consts[cm[1]] = cm[3];

      // ── (3) the base hidden inside a local http() helper: const BASE = ORIGIN + '/pos/queue';
      let base = '';
      if (/\b(?:function|const)\s+http\b/.test(text)) {
        const bre = /\bconst\s+[A-Za-z_$][\w$]*\s*=[^;\n]*?(['"])(\/[a-z0-9\-/]+)\1\s*\)?\s*;/gi;   // also `= apiUrl('/pos/queue');` (Phase 12)
        let bm, last = '';
        while ((bm = bre.exec(text))) last = bm[2];
        base = last;
      }
      // ── (8) the HTML apps' base helper: const url = (p) => `${API}/go-check-in${p}`;
      if (!base) {
        const ure = /\bconst\s+url\s*=\s*\([^)]*\)\s*=>\s*`\$\{[A-Za-z_$][\w$]*\}(\/[a-z0-9\-/]+)\$\{/i.exec(text);
        if (ure) base = ure[1];
      }
      // Nov 5 2026: '/health…' under a based helper is the module's own health check (POST /pos/ai-queue-assignment/health/run),
      // never the API's root /health — root probes are not called through a module's helper
      const isSurface = (p) => SURFACES.test(p) && !(base && /^\/health\b/.test(p));
      const withBase = (p) => (base && !isSurface(p) ? base.replace(/\/$/, '') + (p.startsWith('/') ? p : '/' + p) : p);

      // ── api.get(…) / http.post(…) / client.patch(…).  (4)(5): a generic may span lines, never a paren.
      const re = /\b(?:api|http|client)\s*\.\s*(get|post|put|patch|delete|del|upload)\s*(?:<[^()]*?>)?\s*\(\s*([`'"])/g;
      let m;
      while ((m = re.exec(text))) {
        const method = M[m[1]];
        const { lit, end } = readPath(text, m.index + m[0].length, m[2], consts);
        const full = followConcat(text, end + 1, lit);
        calls.push({ method, path: withBase(full.split('?')[0]), file: rel, app });
      }

      // ── (2b) a server-sent-event stream: createRealtimeClient({ streamPath: '/tech/stream' }) — an EventSource, so a
      // GET. Added with Constitution 5 Step 6, when the route table first included @Sse routes and /owner/stream and
      // /tech/stream were reported "dead" while three apps held them open.
      const sre = /\bstreamPath\s*:\s*(?:apiUrl\s*\(\s*)?([`'"])/g;   // Phase 12: streamPath: apiUrl('/tech/stream')
      let sm;
      while ((sm = sre.exec(text))) {
        const { lit } = readPath(text, sm.index + sm[0].length, sm[1], consts);
        // A leading ${…} is the API ORIGIN (owner-web: `${BASE}/owner/stream`, BASE = window.APS_API_BASE), not a path.
        calls.push({ method: 'GET', path: withBase(lit.replace(/^\$\{\}/, '').split('?')[0]), file: rel, app });
      }

      // ── (2) the bare style: http<T>(`path`, { method: 'POST' })  — verb in the options object, default GET.
      const hre = /\bhttp\s*(?:<[^()]*?>)?\s*\(\s*([`'"])/g;
      let hm;
      while ((hm = hre.exec(text))) {
        const { lit, end } = readPath(text, hm.index + hm[0].length, hm[1], consts);
        const full = followConcat(text, end + 1, lit);

        // ── (6) THE VERB MUST COME FROM *THIS* CALL, NOT THE NEXT ONE ────────────────────────────────────
        //
        // The first version scanned a fixed 260-character window for `method: '…'`. That window spills past the
        // end of the call and into whatever follows — so a plain GET like
        //
        //     me: () => http('/me'),
        //     signIn: (b) => http('/sign-in', { method: 'POST', body: … }),
        //
        // picked up the NEXT line's POST and reported `POST /auth/me`, a route that does not exist. A checker
        // that invents an orphan is a checker nobody will believe about a real one.
        //
        // So the window is the CALL: walk from the path literal to the matching close-paren, and look only there.
        let k = end + 1, depth = 1;
        for (; k < text.length && depth > 0; k++) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') depth--;
        }
        const inThisCall = text.slice(end, k);
        const mm = /method\s*:\s*['"](get|post|put|patch|delete)['"]/i.exec(inThisCall);
        calls.push({ method: mm ? mm[1].toUpperCase() : 'GET', path: withBase(full.split('?')[0]), file: rel, app });
      }

      // ── (9) the verb-first style used by the single-file HTML apps: api('POST', `/session/${id}/complete`)
      // and its no-helper sibling fetch('/x', { method }). Without this, every call those shipped apps make was
      // invisible to the cross-wire audit even once their files were being read.
      const are = /\bapi\s*\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*([`'"])/gi;
      let am;
      while ((am = are.exec(text))) {
        const { lit, end } = readPath(text, am.index + am[0].length, am[2], consts);
        const full = followConcat(text, end + 1, lit);
        const cleaned = full.split('?')[0];
        if (!cleaned.startsWith('/')) continue;
        calls.push({ method: am[1].toUpperCase(), path: withBase(cleaned), file: rel, app });
      }

      // ── (10) BUILD_PLAN Phase 12: a fetch the app builds with its /api/v1 helper — fetch(apiUrl('/x'), { method })
      const fre = /\bfetch\s*\(\s*apiUrl\s*\(\s*([`'"])/g;
      let fm;
      while ((fm = fre.exec(text))) {
        const { lit, end } = readPath(text, fm.index + fm[0].length, fm[1], consts);
        let k = end + 1, depth = 2;
        for (; k < text.length && depth > 0; k++) { if (text[k] === '(') depth++; else if (text[k] === ')') depth--; }
        const mm = /method\s*:\s*['"](get|post|put|patch|delete)['"]/i.exec(text.slice(end, k));
        calls.push({ method: mm ? mm[1].toUpperCase() : 'GET', path: withBase(lit.split('?')[0]), file: rel, app });
      }

      // ── (11) BUILD_PLAN Phase 12 (Constitution 5 §32–33): an export through the ONE async operation contract —
      // api.exportAsync<T>('/x/export', …) or runAsyncExport<T>(transport, '/x/export', …). A GET of the export, and the
      // helper then GETs that realm's status and download routes (the URLs the 202 hands back: /<realm>/operations/:id[/download]).
      const xre = /\b(?:api\s*\.\s*exportAsync|runAsyncExport)\s*(?:<[^()]*?>)?\s*\(\s*(?:\([^)]*\)\s*=>[^,]*?,\s*|[A-Za-z_$][\w$]*\s*,\s*)?([`'"])/g;
      let xm;
      while ((xm = xre.exec(text))) {
        const { lit } = readPath(text, xm.index + xm[0].length, xm[1], consts);
        const p = withBase(lit.split('?')[0]);
        calls.push({ method: 'GET', path: p, file: rel, app });
        const seg = p.replace(/^\/api\/v1/, '').split('/')[1];
        const realm = seg === 'tenant' ? 'pos' : seg;
        if (['pos', 'owner', 'tech', 'super-admin', 'customer'].includes(realm)) for (const s of ['/${}', '/${}/download']) calls.push({ method: 'GET', path: `/${realm}/operations${s}`, file: rel, app });
      }
    }
  }

  // BUILD_PLAN Phase 12: the apps call /api/v1/<path> — the server's alias of <path> (common/api-version.ts) — so a call
  // is matched against the route it reaches, not its spelling.
  return calls.map((c) => ({ ...c, path: c.path.replace(/^\/api\/v1(?=\/|$)/, '') }));
}

/**
 * Every spelling of a call path worth trying against a route.
 *
 * ── (8) A TRAILING `${}` GLUED TO A SEGMENT IS USUALLY A QUERY STRING ─────────────────────────────────────
 *
 *     searchCustomers: (q) => http('/customers/search' + qs({ query: q }))
 *
 * That yields `/pos/check-in/customers/search${}` — the wildcard welded onto `search`, which then matches no
 * route and gets reported dead. It is not dead: `qs()` returns `?query=…`, and the route is `/customers/search`.
 *
 * audit-crosswire already knew this and tried the de-glued spellings. When the two extractors were merged, that
 * knowledge lived only in crosswire's matcher and the unreached audit inherited none of it — so it reported live
 * search endpoints as unreachable. Now both share it, which is the entire point of there being one file.
 */
function callPathCandidates(p) {
  const clean = p.split('?')[0].replace(/\/+$/, '');
  const out = [clean];
  let q = clean;
  while (/[^/]\$\{\}$/.test(q)) {          // a `${}` welded to the end of a segment, not its own segment
    q = q.replace(/\$\{\}$/, '').replace(/\/+$/, '');
    out.push(q);
  }
  return out;
}

/** Does this call reach this route? `:param` on the route and `${}` on the call are both wildcards. */
function callMatchesRoute(call, route) {
  if (call.method !== route.method) return false;
  const rs = route.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  for (const cand of callPathCandidates(call.path)) {
    const cs = cand.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (cs.length !== rs.length) continue;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].startsWith(':')) continue;
      if (cs[i] === '${}') continue;
      if (cs[i].toLowerCase() !== rs[i].toLowerCase()) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

module.exports = { extractFrontendCalls, callMatchesRoute, callPathCandidates, APPS };
