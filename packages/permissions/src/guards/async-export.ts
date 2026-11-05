// async-export.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the route marker for an export that may run
// asynchronously. It lives beside @RequirePermission because the export handlers live in the modules, which never import
// apps/api; the interceptor, the worker and the operations routes that act on it are apps/api/src/common/async-export/.
//
//   @Get('export') @RequirePermission('pos.customers.export')
//   @AsyncExport({ kind: 'pos.customers.export', maxSyncRows: 20_000, estimate: { table: 'customers' } })
//
// A decorated GET answers exactly as before unless the client asks for the asynchronous answer (`Prefer: respond-async`
// or `?async=1`) — or the route's own row estimate exceeds `maxSyncRows` — in which case it answers 202 + a status URL
// and the SAME handler runs later in a worker, as the same person, re-authorized from their CURRENT grants.
import { SetMetadata } from '@nestjs/common';

export const ASYNC_EXPORT_META = 'async_export';

export interface AsyncExportOptions {
  /** Stable dotted name of what is produced, e.g. 'pos.customers.export' (api_operations.kind). */
  kind: string;
  /** Above this many rows the server answers 202 on its own (needs `estimate`). Omitted: only on request. */
  maxSyncRows?: number;
  /** How to estimate the rows before running: a count of the route's main table, scoped to the caller's salon unless
   *  `platform` (a Super Admin export over every salon). The table name is an identifier, never caller input. */
  estimate?: { table: string; platform?: boolean };
}

const KIND = /^[a-z][a-z0-9_.-]*$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;

export function AsyncExport(opts: AsyncExportOptions): MethodDecorator {
  if (!KIND.test(opts.kind) || opts.kind.length > 120) throw new Error(`AsyncExport: kind must be a dotted lower-case name (got "${opts.kind}")`);
  if (opts.estimate && !IDENT.test(opts.estimate.table)) throw new Error(`AsyncExport: estimate.table must be a table name (got "${opts.estimate.table}")`);
  if (opts.maxSyncRows !== undefined && (!Number.isInteger(opts.maxSyncRows) || opts.maxSyncRows < 1)) throw new Error('AsyncExport: maxSyncRows must be a positive integer');
  return SetMetadata(ASYNC_EXPORT_META, Object.freeze({ ...opts })) as MethodDecorator;
}
