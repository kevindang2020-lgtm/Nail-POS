// instance-id.ts — a name for THIS process, unique across the fleet (Phase 2: scheduler leases name their holder).
// Railway sets RAILWAY_REPLICA_ID per replica; elsewhere host + pid + a random suffix (a restarted process is a new owner).
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';

let id: string | null = null;
export function processInstanceId(env: NodeJS.ProcessEnv = process.env): string {
  if (!id) {
    const base = env.RAILWAY_REPLICA_ID || env.HOSTNAME || hostname();
    id = `${String(base).slice(0, 60)}:${process.pid}:${randomBytes(3).toString('hex')}`;
  }
  return id;
}
