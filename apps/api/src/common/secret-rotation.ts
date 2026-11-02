// secret-rotation.ts — Constitution 12 §45–46: which secrets are overdue for rotation, observed rather than assumed.
//
// At boot, every HIGH-ENTROPY secret in secrets-inventory.ts that is set is fingerprinted (truncated SHA-256 with a
// name-bound label — never the value). A changed fingerprint is a rotation: SECRET_ROTATED is recorded and the date
// kept. `rotationStatus()` then answers, per secret: set or not, last rotated when, overdue against its policy.
// "Never observed rotating" is reported as exactly that — the age of the value we first saw is unknown, and the
// report does not pretend otherwise.
import { Inject, Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { SECRETS, type SecretEntry } from './secrets-inventory';
import { SecurityEvents } from '@aipowersalon/security-center';
import { log as rootLog } from '@aipowersalon/observability';

const log = rootLog.withContext({ component: 'secret-rotation' });

export function fingerprint(name: string, value: string): string {
  return createHash('sha256').update(`aps-secret-fp:${name}:${value}`).digest('hex').slice(0, 16);
}

export interface RotationStatus { env: string; set: boolean; tracked: boolean; lastRotatedAt: string | null; firstSeenAt: string | null; rotateDays: number; overdue: boolean | null; note: string }

@Injectable()
export class SecretRotation implements OnApplicationBootstrap {
  env: Record<string, string | undefined> = process.env;
  now: () => number = Date.now;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly events?: SecurityEvents) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.observe().catch((e) => log.error('secret.fingerprint_failed', { error: (e as Error).message }));
  }

  /** Fingerprint every tracked secret that is set; record rotations. Returns the names observed to have rotated. */
  async observe(): Promise<string[]> {
    if (!this.db) return [];
    const rotated: string[] = [];
    for (const s of SECRETS.filter((x) => x.highEntropy)) {
      const v = this.env[s.env];
      if (!v) continue;
      const fp = fingerprint(s.env, v);
      const row = (await sql<{ fingerprint: string }>`select fingerprint from secret_fingerprints where name = ${s.env}`.execute(this.db)).rows[0];
      const at = new Date(this.now());
      if (!row) {
        await sql`insert into secret_fingerprints (name, fingerprint, first_seen_at, last_seen_at) values (${s.env}, ${fp}, ${at}, ${at}) on conflict (name) do nothing`.execute(this.db);
      } else if (row.fingerprint !== fp) {
        // Guard on the OLD fingerprint so two instances booting together record one rotation, not two.
        const n = (await sql`update secret_fingerprints set fingerprint = ${fp}, last_rotated_at = ${at}, last_seen_at = ${at} where name = ${s.env} and fingerprint = ${row.fingerprint} returning name`.execute(this.db)).rows.length;
        if (n) { rotated.push(s.env); void this.events?.record({ type: 'SECRET_ROTATED', actorType: 'service', resourceType: 'secret', resourceId: s.env, reason: `${s.kind} rotation observed at boot` }); }
      } else {
        await sql`update secret_fingerprints set last_seen_at = ${at} where name = ${s.env}`.execute(this.db);
      }
    }
    return rotated;
  }

  async rotationStatus(): Promise<RotationStatus[]> {
    const rows = this.db ? (await sql<any>`select name, first_seen_at, last_rotated_at from secret_fingerprints`.execute(this.db)).rows : [];
    const by = new Map(rows.map((r: any) => [r.name, r]));
    return SECRETS.map((s: SecretEntry) => {
      const set = !!this.env[s.env]; const r: any = by.get(s.env);
      const last = r?.last_rotated_at ? new Date(r.last_rotated_at) : null;
      const overdue = !s.highEntropy || !s.rotateDays || !set ? null : last ? this.now() - last.getTime() > s.rotateDays * 864e5 : (r?.first_seen_at ? this.now() - new Date(r.first_seen_at).getTime() > s.rotateDays * 864e5 : null);
      const note = !set ? 'not set' : !s.highEntropy ? 'provider-issued — rotation not observable here' : last ? `last rotated ${last.toISOString().slice(0, 10)}` : r ? `never observed rotating (first seen ${new Date(r.first_seen_at).toISOString().slice(0, 10)}; its real age is unknown)` : 'not yet fingerprinted';
      return { env: s.env, set, tracked: s.highEntropy, lastRotatedAt: last?.toISOString() ?? null, firstSeenAt: r?.first_seen_at ? new Date(r.first_seen_at).toISOString() : null, rotateDays: s.rotateDays, overdue, note };
    });
  }
}
