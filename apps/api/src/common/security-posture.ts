// security-posture.ts — Constitution 12 §270–271: the Security Center's "Encryption & Backup Health" panel, with data.
//
// That panel has always read "No encryption-health schema" — an honest placeholder. Constitution 12 now produces the
// facts it was waiting for, so this assembles them, read-only, from what already exists:
//   keys       — each key-ring purpose: configured, or running on a derived/constant fallback (non-production only;
//                production refuses to boot), from key-ring.ts;
//   rotation   — each tracked high-entropy secret overdue against its policy, from secret-rotation.ts;
//   posture    — boot-time network/storage warnings (public DB without TLS, photos on container disk), network-posture.ts;
//   events24h  — security events in the last 24 h by severity, and the top types, from security_events.
// NO SECRET, fingerprint or key material ever leaves this function — names, states and counts only.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { KEY_SOURCES, type KeyPurpose } from './key-ring';
import { SecretRotation } from './secret-rotation';
import { networkPosture } from './network-posture';

export interface SecurityPostureSnapshot {
  available: true;
  keys: Array<{ purpose: string; env: string; state: 'configured' | 'fallback' | 'optional_unset' }>;
  rotationOverdue: string[];
  posture: Array<{ variable: string; problem: string }>;
  events24h: { total: number; bySeverity: Record<string, number>; topTypes: Array<{ type: string; count: number }> };
}

@Injectable()
export class SecurityPosture {
  env: NodeJS.ProcessEnv = process.env;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly rotation?: SecretRotation) {}

  async snapshot(): Promise<SecurityPostureSnapshot> {
    const keys = (Object.keys(KEY_SOURCES) as KeyPurpose[]).map((p) => {
      const src = KEY_SOURCES[p]; const set = !!String(this.env[src.env] ?? '').trim();
      return { purpose: p, env: src.env, state: (set ? 'configured' : src.required ? 'fallback' : 'optional_unset') as 'configured' | 'fallback' | 'optional_unset' };
    });
    const rotationOverdue = this.rotation ? (await this.rotation.rotationStatus().catch(() => [])).filter((r) => r.overdue === true).map((r) => r.env) : [];
    let events24h: SecurityPostureSnapshot['events24h'] = { total: 0, bySeverity: {}, topTypes: [] };
    if (this.db) {
      const since = new Date(Date.now() - 86_400_000);
      const sev = (await sql<any>`select severity, count(*)::int n from security_events where occurred_at >= ${since} group by severity`.execute(this.db).catch(() => ({ rows: [] }))).rows;
      const top = (await sql<any>`select event_type, count(*)::int n from security_events where occurred_at >= ${since} group by event_type order by n desc limit 5`.execute(this.db).catch(() => ({ rows: [] }))).rows;
      events24h = { total: sev.reduce((a: number, r: any) => a + r.n, 0), bySeverity: Object.fromEntries(sev.map((r: any) => [r.severity, r.n])), topTypes: top.map((r: any) => ({ type: r.event_type, count: r.n })) };
    }
    return { available: true, keys, rotationOverdue, posture: networkPosture({ ...this.env, NODE_ENV: 'production' }), events24h };
  }
}
