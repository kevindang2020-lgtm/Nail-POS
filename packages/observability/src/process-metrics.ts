// process-metrics.ts — BUILD_PLAN Phase 14 B (Constitution 11 §49): CPU and memory IN THE REGISTRY.
//
// Before this, RSS and heap were shown only on the System Health screen (read live from the answering process) and the
// registry had event-loop lag alone — so /metrics and the persisted process heartbeats could not say "the worker's RSS
// has climbed all day". Refreshed on collect (a scrape or a heartbeat read), never polled; a source that throws leaves
// the last values in place and never breaks a scrape (§286). Per process, by design: these are the process's own
// facts — no label but the CPU mode and heap space.
import { registry } from './metrics';

export const processRss = registry.gauge('aipowersalon_process_resident_memory_bytes', 'Resident set size', []);
export const processHeapUsed = registry.gauge('aipowersalon_process_heap_bytes', 'V8 heap by space (used / total)', ['space']);
export const processCpuSeconds = registry.gauge('aipowersalon_process_cpu_seconds_total', 'CPU time since the process started (process.cpuUsage), by mode', ['mode']);
export const processHandles = registry.gauge('aipowersalon_process_active_handles', 'Active libuv resources (sockets, timers, files)', []);
export const processUptime = registry.gauge('aipowersalon_process_uptime_seconds', 'Seconds since the process started', []);

export interface ProcessSource {
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number };
  cpuUsage(): { user: number; system: number };
  uptime(): number;
  handles(): number;
}

export const nodeProcessSource: ProcessSource = {
  memoryUsage: () => process.memoryUsage(),
  cpuUsage: () => process.cpuUsage(),
  uptime: () => process.uptime(),
  handles: () => {
    const p = process as unknown as { getActiveResourcesInfo?: () => string[] };
    return typeof p.getActiveResourcesInfo === 'function' ? p.getActiveResourcesInfo().length : 0;
  },
};

let attached: ProcessSource | null = null;
let registered = false;

/** Idempotent: the last source wins (tests inject one); one collector is registered per process. */
export function attachProcessMetrics(source: ProcessSource = nodeProcessSource): void {
  attached = source;
  if (registered) return;
  registered = true;
  registry.onCollect(() => {
    const s = attached;
    if (!s) return;
    try {
      const m = s.memoryUsage();
      processRss.set(m.rss); processHeapUsed.set(m.heapUsed, { space: 'used' }); processHeapUsed.set(m.heapTotal, { space: 'total' });
    } catch { /* §286 */ }
    try { const c = s.cpuUsage(); processCpuSeconds.set(c.user / 1e6, { mode: 'user' }); processCpuSeconds.set(c.system / 1e6, { mode: 'system' }); } catch { /* §286 */ }
    try { processUptime.set(Math.round(s.uptime())); } catch { /* §286 */ }
    try { processHandles.set(s.handles()); } catch { /* §286 */ }
  });
}
