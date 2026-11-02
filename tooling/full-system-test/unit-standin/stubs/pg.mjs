// pg stand-in (tooling only — an environment with no node_modules): `new pg.Pool({ connectionString })` is ONE real
// PostgreSQL session to that database through the wire-protocol client in ../../pg-standin/pglite.mjs (PGlite.attach).
// Enough for the *.postgres-race specs: each Kysely instance they build is its own session, so their races are real.
import { PGlite } from '../../pg-standin/pglite.mjs';

export class Pool {
  constructor(cfg = {}) {
    const u = new URL(cfg.connectionString ?? process.env.PG_RACE_URL);
    this.__standin = true; this.__db = PGlite.attach(decodeURIComponent(u.pathname.slice(1)));
  }
  // node-postgres types: int8 (and int8[]) come back as STRINGS, unlike PGlite's numbers — match the real driver
  async query(text, params = []) {
    const r = await this.__db.query(text, params);
    const big = (r.fields ?? []).filter((f) => f.dataTypeID === 20 || f.dataTypeID === 1016).map((f) => f.name);
    if (big.length) for (const row of r.rows) for (const k of big) if (row[k] !== null && row[k] !== undefined) row[k] = Array.isArray(row[k]) ? row[k].map(String) : String(row[k]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  async end() { await this.__db.close(); }
  on() { return this; }
}
export default { Pool };
