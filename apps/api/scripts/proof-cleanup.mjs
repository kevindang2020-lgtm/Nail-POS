// proof-cleanup.mjs — removes a live proof's own branch and EVERYTHING in it (rows in any table with a branch_id), so a
// proof leaves nothing in the salon's POS. A soft-deleted branch is not enough: the POS branch switcher lists every
// branch row. Tables are found from the catalog; foreign keys between them are handled by repeating the pass until
// nothing more can go. Append-only tables (the audit trail) refuse deletes by design — their rows stay, and are counted.
// Never point it at production; it deletes by branch id only, and only a branch the proof itself created.
export async function removeProofBranch(client, tenantId, branchId) {
  const tables = (await client.query(
    `select c.table_name from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
      where c.table_schema = 'public' and c.column_name = 'branch_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'branches'`)).rows.map((r) => r.table_name);
  // rows in tables WITHOUT a branch column that point at this branch's rows (a customer's global-identity link, say):
  // deleted first, so the branch's own rows can go
  for (const t of tables) {
    const refs = (await client.query(
      `select c.conrelid::regclass::text as ref, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1`, [t])).rows;
    for (const r of refs) {
      if (tables.includes(r.ref.replace(/"/g, ''))) continue;
      try {
        await client.query(`savepoint p`);
        const gone = await client.query(`delete from ${r.ref} where "${r.col}" in (select id from "${t}" where branch_id = $1) returning *`, [branchId]);
        await client.query(`release savepoint p`);
        // a link to a cross-salon identity made for a proof customer: the identity goes too when nothing else uses it
        if (r.ref === 'customer_global_links') {
          for (const g of new Set(gone.rows.map((x) => x.global_customer_id).filter(Boolean))) {
            await client.query(`savepoint p`);
            await client.query(`delete from global_customers g where g.id = $1 and not exists (select 1 from customer_global_links l where l.global_customer_id = g.id)`, [g]).then(() => client.query(`release savepoint p`), () => client.query(`rollback to savepoint p`));
          }
        }
      } catch { await client.query(`rollback to savepoint p`).catch(() => undefined); }
    }
  }
  let pending = new Set(tables);
  for (let pass = 0; pass < 8 && pending.size; pass++) {
    const next = new Set();
    for (const t of pending) {
      try { await client.query(`savepoint p`); await client.query(`delete from "${t}" where branch_id = $1`, [branchId]); await client.query(`release savepoint p`); }
      catch { await client.query(`rollback to savepoint p`).catch(() => undefined); next.add(t); }
    }
    if (next.size === pending.size) { pending = next; break; }
    pending = next;
  }
  let removed = false;
  try { await client.query(`savepoint p`); await client.query(`delete from branches where tenant_id = $1 and id = $2`, [tenantId, branchId]); await client.query(`release savepoint p`); removed = true; }
  catch { await client.query(`rollback to savepoint p`).catch(() => undefined); }
  if (!removed) await client.query(`update branches set deleted_at = coalesce(deleted_at, now()), status = 'inactive' where id = $1`, [branchId]).catch(() => undefined);
  return { removed, kept: [...pending] };
}
/** Runs removeProofBranch inside one transaction (savepoints need one). */
export async function removeProofBranchTx(client, tenantId, branchId) {
  await client.query('begin');
  try { const r = await removeProofBranch(client, tenantId, branchId); await client.query('commit'); return r; }
  catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}
