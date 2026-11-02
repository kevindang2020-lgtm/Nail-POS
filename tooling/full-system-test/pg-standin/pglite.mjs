// pglite.mjs — a stand-in for @electric-sql/pglite backed by a REAL PostgreSQL 16 server (127.0.0.1:55432, trust auth).
// Each instance is a FRESH database (created on construction, dropped on close). It speaks the Postgres wire protocol
// directly (no packages): exec = simple query protocol (multi-statement, implicit transaction like PGlite),
// query = extended protocol (Parse / Bind / Execute / Sync) with text-format parameters, rows typed by the column OIDs.
import net from 'node:net';
import { randomBytes } from 'node:crypto';

const HOST = process.env.FST_PG_HOST || '127.0.0.1', PORT = Number(process.env.FST_PG_PORT || 55432);

class Conn {
  constructor(db) { this.db = db; this.buf = Buffer.alloc(0); this.waiters = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(PORT, HOST, () => {
        const params = Buffer.from(`user\0postgres\0database\0${this.db}\0client_encoding\0UTF8\0\0`);
        const len = Buffer.alloc(8); len.writeInt32BE(8 + params.length, 0); len.writeInt32BE(196608, 4);
        this.sock.write(Buffer.concat([len, params]));
        this.collect().then((msgs) => { const e = msgs.find((m) => m.t === 'E'); e ? reject(pgError(e.body)) : resolve(); }, reject);
      });
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
      this.sock.on('error', (e) => { for (const w of this.waiters.splice(0)) w.reject(e); reject(e); });
    });
  }
  pump() {
    while (this.buf.length >= 5) {
      const t = String.fromCharCode(this.buf[0]); const n = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + n) return;
      const body = this.buf.subarray(5, 1 + n); this.buf = this.buf.subarray(1 + n);
      const w = this.waiters[0]; if (!w) continue;
      w.msgs.push({ t, body: Buffer.from(body) });
      if (t === 'Z') { this.waiters.shift(); if (!this.waiters.length) this.sock.unref(); w.resolve(w.msgs); }   // idle: never keeps the process alive
    }
  }
  collect() { this.sock?.ref(); return new Promise((resolve, reject) => this.waiters.push({ msgs: [], resolve, reject })); }   // in flight: keep it alive
  send(...parts) { this.sock.write(Buffer.concat(parts)); }
  close() { try { this.sock.write(msg('X', Buffer.alloc(0))); this.sock.end(); } catch { /* closed */ } }
}
function msg(type, body) { const h = Buffer.alloc(5); h.write(type, 0); h.writeInt32BE(4 + body.length, 1); return Buffer.concat([h, body]); }
const cstr = (s) => Buffer.from(String(s) + '\0');
function pgError(body) {
  const f = {}; let i = 0;
  while (i < body.length && body[i] !== 0) { const code = String.fromCharCode(body[i]); const end = body.indexOf(0, i + 1); f[code] = body.toString('utf8', i + 1, end); i = end + 1; }
  return Object.assign(new Error(f.M || 'postgres error'), { code: f.C, detail: f.D, hint: f.H, position: f.P, severity: f.S });
}
function parseArray(s, conv) {
  if (s === '{}') return [];
  const inner = s.slice(1, -1); const out = []; let cur = ''; let q = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) { if (ch === '\\') { cur += inner[++i]; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur === 'NULL' ? null : conv(cur)); cur = ''; } else cur += ch;
  }
  out.push(cur === 'NULL' ? null : conv(cur));
  return out;
}
function convert(oid, v) {
  if (v === null) return null;
  switch (oid) {
    case 16: return v === 't';
    case 20: case 21: case 23: case 26: case 700: case 701: return Number(v);
    case 114: case 3802: return JSON.parse(v);
    case 1114: case 1184: case 1082: return new Date(v.length === 10 ? v + 'T00:00:00Z' : v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    case 1000: return parseArray(v, (x) => x === 't');
    case 1005: case 1007: case 1016: case 1021: case 1022: return parseArray(v, Number);
    case 1009: case 1015: case 1003: case 1263: case 2951: case 1231: case 1182: case 1185: case 1115: return parseArray(v, (x) => x);
    default: return v;
  }
}
function readResults(msgs) {
  const err = msgs.find((m) => m.t === 'E'); if (err) throw pgError(err.body);
  let fields = [], rows = [], affectedRows = 0; const results = [];
  for (const m of msgs) {
    if (m.t === 'T') {
      fields = []; rows = []; const n = m.body.readInt16BE(0); let i = 2;
      for (let k = 0; k < n; k++) { const end = m.body.indexOf(0, i); const name = m.body.toString('utf8', i, end); i = end + 1; const dataTypeID = m.body.readInt32BE(i + 6); i += 18; fields.push({ name, dataTypeID }); }
    } else if (m.t === 'D') {
      const n = m.body.readInt16BE(0); let i = 2; const row = {};
      for (let k = 0; k < n; k++) { const len = m.body.readInt32BE(i); i += 4; const v = len < 0 ? null : m.body.toString('utf8', i, i + len); if (len > 0) i += len; row[fields[k].name] = convert(fields[k].dataTypeID, v); }
      rows.push(row);
    } else if (m.t === 'C') {
      const tag = m.body.toString('utf8', 0, m.body.length - 1); const num = Number(tag.split(' ').pop());
      affectedRows = /^(INSERT|UPDATE|DELETE|MERGE|COPY)/.test(tag) && Number.isFinite(num) ? num : 0;
      results.push({ rows, fields, affectedRows }); rows = []; fields = [];
    }
  }
  return results;
}
async function adminQuery(sql) {
  const c = new Conn('postgres'); await c.open(); c.send(msg('Q', cstr(sql))); const r = await c.collect(); c.close(); readResults(r);
}

export class PGlite {
  // opts.loadDataDir (a pgtest-schema cache hit) + FST_PG_TEMPLATE: the fresh database is a copy of an already-migrated
  // database (CREATE DATABASE … TEMPLATE) instead of an empty one — seconds instead of replaying every migration
  constructor(opts = {}) { this.dbname = 'fst_' + randomBytes(6).toString('hex'); this.template = opts?.loadDataDir && process.env.FST_PG_TEMPLATE ? process.env.FST_PG_TEMPLATE : null; this.ready = this.#init(); }
  static async create(opts) { const p = new PGlite(opts); await p.ready; return p; }
  // attach (tooling only): a SECOND real connection to an EXISTING database — what a `pg.Pool` needs for the
  // *.postgres-race specs (separate sessions racing for real). Never creates or drops anything.
  static attach(dbname) { const p = Object.create(PGlite.prototype); p.dbname = dbname; p.attached = true; p.conn = new Conn(dbname); p.ready = p.conn.open(); return p; }
  async #init() { await adminQuery(`CREATE DATABASE ${this.dbname}${this.template ? ` TEMPLATE ${this.template}` : ''}`); this.conn = new Conn(this.dbname); await this.conn.open(); }
  get waitReady() { return this.ready; }
  async exec(sql) { await this.ready; this.conn.send(msg('Q', cstr(sql))); return readResults(await this.conn.collect()); }
  async query(sql, params = []) {
    await this.ready;
    const arr = (a) => '{' + a.map((x) => (x === null || x === undefined ? 'NULL' : Array.isArray(x) ? arr(x) : '"' + String(x instanceof Date ? x.toISOString() : x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';   // a JS array is a PostgreSQL array (like node-postgres / PGlite)
    const pv = params.map((p) => (p === null || p === undefined ? null : Array.isArray(p) ? arr(p) : typeof p === 'object' && !(p instanceof Date) ? JSON.stringify(p) : p instanceof Date ? p.toISOString() : typeof p === 'bigint' ? p.toString() : String(p)));
    const parts = [Buffer.alloc(2), Buffer.alloc(2)]; parts[0].writeInt16BE(0); parts[1].writeInt16BE(pv.length);
    const bind = [cstr(''), cstr(''), parts[0], parts[1]];
    for (const v of pv) { const l = Buffer.alloc(4); if (v === null) { l.writeInt32BE(-1); bind.push(l); } else { const b = Buffer.from(v); l.writeInt32BE(b.length); bind.push(l, b); } }
    const rf = Buffer.alloc(2); rf.writeInt16BE(0); bind.push(rf);
    const parse = Buffer.concat([cstr(''), cstr(sql), Buffer.from([0, 0])]);
    const desc = Buffer.concat([Buffer.from('P'), cstr('')]);
    const exe = Buffer.concat([cstr(''), Buffer.alloc(4)]);
    this.conn.send(msg('P', parse), msg('B', Buffer.concat(bind)), msg('D', desc), msg('E', exe), msg('S', Buffer.alloc(0)));
    const r = readResults(await this.conn.collect());
    return r[r.length - 1] ?? { rows: [], fields: [], affectedRows: 0 };
  }
  async transaction(fn) {
    await this.exec('BEGIN');
    try { const out = await fn({ query: (s, p) => this.query(s, p), exec: (s) => this.exec(s) }); await this.exec('COMMIT'); return out; }
    catch (e) { await this.exec('ROLLBACK').catch(() => undefined); throw e; }
  }
  async dumpDataDir() { throw new Error('dumpDataDir: not supported by the real-Postgres stand-in (the cache is optional)'); }
  async close() { this.conn?.close(); if (this.attached) return; if (!process.env.FST_KEEP_DB) await adminQuery(`DROP DATABASE IF EXISTS ${this.dbname} WITH (FORCE)`).catch(() => undefined); }
}
export default { PGlite };
