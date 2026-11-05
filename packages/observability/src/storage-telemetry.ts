// storage-telemetry.ts — BUILD_PLAN Phase 14 B (Constitution 11 §49, §152): storage metrics.
//
// The media store (public uploads) and the private store (exports, support attachments) had no instrumentation: an S3
// outage or a full disk showed up only as upload errors in the logs. instrumentStore() wraps any store object's
// put / get / remove / sweepAbandoned (the MediaStorage and PrivateObjectStore ports both have that shape) and counts:
//   aipowersalon_storage_operations_total{store, op, outcome}   outcome: ok | error | miss (a get that found nothing)
//   aipowersalon_storage_bytes_total{store, direction}          written (put body) / read (get result)
//   aipowersalon_storage_operation_duration_seconds{store, op}
//   aipowersalon_storage_lifecycle_runs_total{store, outcome} + _lifecycle_removed_total{store}   (recorded by the
//     media.lifecycle job itself — partial uploads swept + objects of long-deleted rows; the wrapper does not count them)
// Labels are the STORE name (media, private, support_attachments) and the op — never a key, a tenant or a file name
// (§38). Errors are re-thrown unchanged: the caller keeps its own policy. Everything else on the store passes through.
import { performance } from 'node:perf_hooks';
import { registry } from './metrics';

export const STORAGE_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export const storageOps = registry.counter('aipowersalon_storage_operations_total', 'Object-store operations by store, op and outcome', ['store', 'op', 'outcome']);
export const storageBytes = registry.counter('aipowersalon_storage_bytes_total', 'Bytes written to / read from an object store', ['store', 'direction']);
export const storageDuration = registry.histogram('aipowersalon_storage_operation_duration_seconds', 'Object-store operation latency', ['store', 'op'], STORAGE_BUCKETS);
export const storageLifecycle = registry.counter('aipowersalon_storage_lifecycle_runs_total', 'Storage lifecycle job runs by store and outcome', ['store', 'outcome']);
export const storageLifecycleRemoved = registry.counter('aipowersalon_storage_lifecycle_removed_total', 'Objects / partial uploads removed by the lifecycle job', ['store']);

const WRAPPED = Symbol.for('aipowersalon.storage.instrumented');
const OPS = new Set(['put', 'get', 'remove', 'sweepAbandoned']);

export function isInstrumentedStore(store: unknown): boolean { return !!store && (store as any)[WRAPPED] === true; }

function bytesOf(v: unknown): number {
  if (!v) return 0;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v.byteLength;
  return 0;
}

/** Wrap a store. Idempotent (a store wrapped twice is counted once). The returned object IS the store for every other member. */
export function instrumentStore<T extends object>(store: T, storeName: string): T {
  if (isInstrumentedStore(store)) return store;
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === WRAPPED) return true;
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !OPS.has(prop) || typeof v !== 'function') return typeof v === 'function' ? v.bind(target) : v;
      return async (...args: unknown[]) => {
        const start = performance.now();
        const op = prop;
        try {
          const out = await (v as (...a: unknown[]) => unknown).apply(target, args);
          const miss = op === 'get' && (out === null || out === undefined);
          try {
            storageOps.inc({ store: storeName, op, outcome: miss ? 'miss' : 'ok' });
            if (op === 'put') storageBytes.inc({ store: storeName, direction: 'written' }, bytesOf(args[1]));
            if (op === 'get' && !miss) storageBytes.inc({ store: storeName, direction: 'read' }, bytesOf(out));
          } catch { /* §286 */ }
          return out;
        } catch (e) {
          try { storageOps.inc({ store: storeName, op, outcome: 'error' }); } catch { /* §286 */ }
          throw e;
        } finally {
          try { storageDuration.observe((performance.now() - start) / 1000, { store: storeName, op }); } catch { /* §286 */ }
        }
      };
    },
  }) as T;
}

/** One lifecycle run (media.lifecycle) for a store: ok / error, with how many objects it removed. */
export function recordStorageLifecycle(storeName: string, outcome: 'ok' | 'error', removed = 0): void {
  try {
    storageLifecycle.inc({ store: storeName, outcome });
    if (removed > 0) storageLifecycleRemoved.inc({ store: storeName }, removed);
  } catch { /* §286 */ }
}
