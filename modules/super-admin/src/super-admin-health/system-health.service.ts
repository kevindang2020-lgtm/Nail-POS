// system-health.service.ts — gathers real process metrics + a DB probe (over the HealthDb port) into one payload.
// `ok` reflects database connectivity. Pure aside from process.* + the injected port, so it is unit-testable.
import type { HealthDb, HealthDbResult } from './system-health.data';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { SystemHealth } from '@aipowersalon/api-contracts/platform';
import type { SystemHealth } from '@aipowersalon/api-contracts/platform';


export class SystemHealthService {
  constructor(private readonly dbPort: HealthDb) {}
  async getHealth(): Promise<SystemHealth> {
    const mem = process.memoryUsage();
    const database = await this.dbPort.probe();
    return {
      ok: database.ok,
      generatedAt: new Date().toISOString(),
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        pid: process.pid,
        memoryRssMb: +(mem.rss / 1048576).toFixed(1),
        memoryHeapUsedMb: +(mem.heapUsed / 1048576).toFixed(1),
        env: process.env.NODE_ENV || 'development',
      },
      database,
      gateway: database.gateway ?? null,
    };
  }
}
