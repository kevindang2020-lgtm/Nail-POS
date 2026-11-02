// pos-social.kysely.repository.ts — Kysely/Postgres adapter. Tenant/branch scoping is server-derived from ctx.
// Raw sql is used for social_posts so we don't depend on generated table types.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SocialContext, SocialPost, CreateSocialPostInput, SocialStatus } from './pos-social.dto';
import type { SocialRepositoryPort } from './pos-social.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { SOCIAL_POST } from './pos-social.dto';

function toDomain(r: any): SocialPost {
  return {
    id: String(r.id),
    platform: String(r.platform) as any,
    caption: String(r.caption),
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    status: String(r.status) as any,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  };
}

export class KyselySocialRepository implements SocialRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async list(ctx: SocialContext): Promise<SocialPost[]> {
    const res: any = await sql`
      SELECT id, platform, caption, scheduled_at, status, posted_at, created_at
      FROM social_posts WHERE tenant_id = ${ctx.tenantId}
      ORDER BY created_at DESC
    `.execute(this.db).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toDomain);
  }

  async create(ctx: SocialContext, input: CreateSocialPostInput): Promise<SocialPost> {
    const status: SocialStatus = input.scheduledAt ? 'scheduled' : 'draft';
    const res: any = await sql`
      INSERT INTO social_posts (tenant_id, branch_id, platform, caption, scheduled_at, status)
      VALUES (${ctx.tenantId}, ${ctx.branchId || null}, ${input.platform}, ${input.caption}, ${input.scheduledAt ?? null}, ${status})
      RETURNING id, platform, caption, scheduled_at, status, posted_at, created_at
    `.execute(this.db);
    return toDomain(res.rows[0]);
  }

  async find(ctx: SocialContext, id: string): Promise<SocialPost | null> {
    const res: any = await sql`SELECT id, platform, caption, scheduled_at, status, posted_at, created_at FROM social_posts WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }

  async setStatus(ctx: SocialContext, id: string, status: SocialStatus, from?: SocialStatus): Promise<SocialPost | null> {
    const res: any = await sql`
      UPDATE social_posts
      SET status = ${status}, posted_at = ${status === 'posted' ? sql`now()` : sql`posted_at`}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id} AND ${canMoveToSql(SOCIAL_POST, status)} ${from ? sql`AND status = ${from}` : sql``}
      RETURNING id, platform, caption, scheduled_at, status, posted_at, created_at
    `.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }
}
