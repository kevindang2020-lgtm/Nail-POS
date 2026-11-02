import { defineConfig } from 'vitest/config';
// hookTimeout: state-machine / backfill boot a fully migrated PGlite in beforeAll (614 migrations, ~4 s idle, >10 s while
// other lanes build) — the same 60 s the modules' configs give that boot; vitest's 10 s default failed the file on Oct 22.
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'], hookTimeout: 60000 } });
