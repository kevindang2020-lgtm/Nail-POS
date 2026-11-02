const HERE = new URL('./', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === '@electric-sql/pglite') return { url: HERE + 'pglite.mjs', shortCircuit: true };
  if (spec.startsWith('@electric-sql/pglite/')) return { url: HERE + 'contrib.mjs', shortCircuit: true };
  if (spec === 'kysely') { try { return await next(spec, ctx); } catch { return { url: HERE + 'kysely-sql.mjs', shortCircuit: true }; } }
  return next(spec, ctx);
}
