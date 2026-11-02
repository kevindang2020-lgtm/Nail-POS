// kysely stand-in (tooling only — an environment with no node_modules): raw `sql` templates compiled to PostgreSQL
// `$n` placeholders exactly like the real RawBuilder (nested fragments inline, sql.join / raw / ref / lit / id), executed
// through the Kysely instance's dialect driver; Kysely#transaction().execute(fn) runs BEGIN / COMMIT / ROLLBACK on the
// driver. NO query builder (selectFrom & co. throw) — code under test that needs it is not covered by this stand-in.
const RAW = Symbol('raw');
class Frag {
  constructor(strings, values) { this.strings = strings; this.values = values; this.__sql = true; }
  compile(params = []) {
    let out = '';
    this.strings.forEach((s, i) => {
      out += s;
      if (i >= this.values.length) return;
      const v = this.values[i];
      if (v instanceof Frag) out += v.compile(params).sql;
      else if (v && v[RAW] !== undefined) out += v[RAW];
      else { params.push(v); out += '$' + params.length; }
    });
    return { sql: out, parameters: params };
  }
  async execute(db) {
    const c = this.compile([]);
    const ex = db.getExecutor();
    const r = await ex.executeQuery({ sql: c.sql, parameters: c.parameters, query: { kind: 'RawNode' } });
    return { rows: r.rows ?? [], numAffectedRows: r.numAffectedRows, numChangedRows: r.numChangedRows };
  }
  as() { return this; }
  $castTo() { return this; }
  toOperationNode() { return this; }
}
const raw = (s) => ({ [RAW]: String(s) });
const quoteId = (s) => String(s).split('.').map((p) => (p === '*' ? p : '"' + p.replace(/"/g, '""') + '"')).join('.');
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
export function sql(strings, ...values) { return new Frag([...strings], values); }
sql.raw = (s) => new Frag([String(s)], []);
sql.ref = (r) => new Frag([quoteId(r)], []);
sql.id = (...ids) => new Frag([ids.map(quoteId).join('.')], []);
sql.table = (t) => new Frag([quoteId(t)], []);
sql.lit = (v) => new Frag([lit(v)], []);
sql.val = (v) => new Frag(['', ''], [v]);
sql.join = (items, sep) => {
  const s = sep ?? new Frag([', '], []);
  const strings = ['']; const values = [];
  items.forEach((it, i) => { if (i > 0) { values.push(s); strings.push(''); } values.push(it instanceof Frag ? it : it); strings.push(''); });
  return new Frag(strings, values);
};
void raw;
const NO_BUILDER = () => { throw new Error('kysely stand-in: the query builder is not available (raw sql only)'); };
export class Kysely {
  constructor(cfg = {}) { this.cfg = cfg; this.dialect = cfg.dialect; this.driver = cfg.dialect?.createDriver?.(); this.conn = null; this.inTrx = false; this.gate = { tail: Promise.resolve() }; }
  // ONE connection here (a real pool has many): transactions take turns — otherwise two concurrent requests would
  // interleave inside one BEGIN … COMMIT (a plain statement still runs on the shared connection)
  async _exclusive(fn) { const g = this.gate; const prev = g.tail; let release; g.tail = new Promise((r) => { release = r; }); await prev; try { return await fn(); } finally { release(); } }
  async _conn() { if (!this.conn) { await this.driver?.init?.(); this.conn = await this.driver.acquireConnection(); } return this.conn; }
  getExecutor() { const self = this; return { executeQuery: async (c) => (await self._conn()).executeQuery(c), adapter: {} }; }
  get isTransaction() { return this.inTrx; }
  transaction() {
    const self = this;
    const builder = {
      setIsolationLevel: () => builder,
      execute: async (fn) => {
        if (self.inTrx) return fn(self);   // nested: the same connection (savepoints are not emulated)
        return self._exclusive(async () => {
          const conn = await self._conn();
          await self.driver.beginTransaction(conn, {});
          const trx = Object.create(self); trx.inTrx = true;
          try { const out = await fn(trx); await self.driver.commitTransaction(conn); return out; }
          catch (e) { await self.driver.rollbackTransaction(conn).catch(() => undefined); throw e; }
        });
      },
    };
    return builder;
  }
  connection() { const self = this; return { execute: (fn) => fn(self) }; }
  withSchema() { return this; } withPlugin() { return this; }
  selectFrom() { NO_BUILDER(); } insertInto() { NO_BUILDER(); } updateTable() { NO_BUILDER(); } deleteFrom() { NO_BUILDER(); } with() { NO_BUILDER(); }
  async destroy() { await this.driver?.destroy?.(); }
}
export class PostgresAdapter {} export class PostgresIntrospector { constructor(d) { this.d = d; } }
export class PostgresQueryCompiler { compileQuery(n) { return n?.compile ? n.compile([]) : { sql: '', parameters: [] }; } }
// PostgresDialect over the `pg` stand-in (stubs/pg.mjs): ONE real session per Kysely instance (see Kysely above), so N
// instances are N sessions racing for real — what the *.postgres-race specs build with `new pg.Pool(...)`
export class PostgresDialect {
  constructor(c) { this.c = c; }
  createDriver() {
    const pool = this.c?.pool;
    if (!pool?.__standin) throw new Error('kysely stand-in: PostgresDialect needs the pg stand-in pool');
    const q = (s, p) => pool.query(s, p);
    return {
      async init() { await pool.__db.ready; },
      async acquireConnection() { return { async executeQuery(c) { const r = await q(c.sql, c.parameters); return { rows: r.rows, numAffectedRows: BigInt(r.rowCount ?? 0) }; }, async *streamQuery() {} }; },
      async beginTransaction() { await q('BEGIN'); }, async commitTransaction() { await q('COMMIT'); }, async rollbackTransaction() { await q('ROLLBACK'); },
      async releaseConnection() {}, async destroy() { await pool.end(); },
    };
  }
}
export class Transaction extends Kysely {}
export class CompiledQuery { static raw(s, p = []) { return { sql: s, parameters: p }; } }
export const expressionBuilder = NO_BUILDER;
