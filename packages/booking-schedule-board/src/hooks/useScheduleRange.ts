import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { BookingDataAdapter } from '../adapters/BookingDataAdapter';
import type { ID, ISODate } from '../domain/scheduleTypes';
import type { RealtimeClient } from '../realtime/events';
import { applyEvent, emptyStore, storeReducer, type LocalPatch, type ScheduleStoreState } from '../state/scheduleStore';

export interface UseScheduleRangeArgs {
  adapter: BookingDataAdapter;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  enabled?: boolean;
  /** Host realtime transport; defaults to `adapter.subscribeSchedule`. */
  realtime?: RealtimeClient;
  /** Server paging request (0-based page index); adapters without server paging ignore it. */
  pageIndex?: number;
  pageSize?: number;
  workingOnly?: boolean;
}

export interface UseScheduleRangeResult {
  store: ScheduleStoreState;
  reload: () => Promise<void>;
  /** Apply a local mutation result immediately (the realtime echo is then a no-op by version). */
  applyPatch: (patch: LocalPatch) => void;
}

/**
 * Loads a branch/date range through the adapter, subscribes to realtime events
 * and reconciles incrementally. One request per date — never one per technician.
 */
export function useScheduleRange({ adapter, tenantId, branchId, date, enabled = true, realtime, pageIndex, pageSize, workingOnly }: UseScheduleRangeArgs): UseScheduleRangeResult {
  const [store, dispatch] = useReducer(storeReducer, emptyStore);
  const storeRef = useRef(store);
  storeRef.current = store;
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const seq = ++requestSeq.current;
    dispatch({ type: 'loading' });
    try {
      const range = await adapter.getScheduleRange({ tenantId, branchId, fromDate: date, toDate: date,
        ...(pageIndex != null ? { page: pageIndex + 1 } : {}), ...(pageSize != null ? { pageSize } : {}), ...(workingOnly != null ? { workingOnly } : {}) });
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      dispatch({ type: 'loaded', range });
    } catch (e) {
      if (seq !== requestSeq.current) return;
      dispatch({ type: 'failed', error: e instanceof Error ? e : new Error(String(e)) });
    }
  }, [adapter, tenantId, branchId, date, enabled, pageIndex, pageSize, workingOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (envelope: Parameters<Parameters<BookingDataAdapter['subscribeSchedule']>[1]>[0]) => {
      const outcome = applyEvent(storeRef.current, envelope);
      dispatch({ type: 'event', envelope });
      if (outcome.needsReload) void reload();
    };
    const sub = { tenantId, branchId, date };
    return realtime ? realtime.subscribe(sub, handler) : adapter.subscribeSchedule(sub, handler);
  }, [adapter, realtime, tenantId, branchId, date, enabled, reload]);

  const applyPatch = useCallback((patch: LocalPatch) => dispatch({ type: 'patch', patch }), []);

  return { store, reload, applyPatch };
}
