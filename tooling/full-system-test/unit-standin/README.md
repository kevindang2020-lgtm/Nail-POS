# unit-standin — run spec files without node_modules (FullSystemTest.pdf, Oct 28 2026)

NOT vitest. Each spec file runs in its own Node 22 process with `--experimental-strip-types`; `hooks.mjs` maps `@aipowersalon/*`
to source, `vitest` to `vitest-shim.mjs` (describe / it / expect / vi.fn / spyOn / each / skipIf …), NestJS / reflect-metadata /
rxjs / kysely to small stubs in `stubs/` (Kysely: raw `sql` only — no query builder), and `@electric-sql/pglite` to
`../pg-standin` (a real PostgreSQL server). `pg` maps to `stubs/pg.mjs`: `new pg.Pool({ connectionString })` is one real session to that
database (int8 as strings, like node-postgres), and Kysely's `PostgresDialect` runs over it — so `*.postgres-race` specs
that use only raw `sql` race for real here (`PG_RACE_URL=postgres://postgres@127.0.0.1:55432/<db>`). A PASS means every test in the file ran and passed; read every FAIL by hand.

    bash run.sh <repo> <spec.ts>                      # one file
    OUT=<dir> PAR=3 TMO=60000 node sweep.mjs          # every *.test.ts / *.spec.ts (money / integrity modules first) → <dir>/sweep-live.tsv
    OUT=<dir> PAR=3 node rerun.mjs                    # non-passing, non-pgtest files again with NODE_ENV=test and the package as cwd → <dir>/rerun.tsv

Needs PostgreSQL on FST_PG_HOST:FST_PG_PORT (default 127.0.0.1:55432, trust auth) for PGlite-based specs.
