// ai-faq.service.ts — customer-facing FAQs the AI receptionist may answer. Tenant-scoped (server-derived in the
// controller), permission-gated for writes ('ai.manage'). New data only — services, hours, and policies are read
// from their existing sources, never copied here. Staff toggle is_active to control exactly what the AI can say.
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface FaqCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export interface FaqRow { id: string; tenantId: string; branchId: string | null; question: string; answer: string; category: string | null; language: string; isActive: boolean; createdAtMs: number; updatedAtMs: number }
export interface FaqInput { question?: string; answer?: string; category?: string | null; language?: string; isActive?: boolean }

export class FaqForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'FaqForbiddenError'; } }
export class FaqNotFoundError extends Error { constructor(msg = 'FAQ not found') { super(msg); this.name = 'FaqNotFoundError'; } }
export class FaqValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'FaqValidationError'; } }

export interface FaqRepo {
  list(tenantId: string): Promise<FaqRow[]>;
  get(tenantId: string, id: string): Promise<FaqRow | null>;
  insert(tenantId: string, branchId: string | null, v: Required<Pick<FaqInput, 'question' | 'answer'>> & FaqInput, userId: string): Promise<FaqRow>;
  update(tenantId: string, id: string, v: FaqInput, userId: string): Promise<FaqRow | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
}

function validate(question?: string, answer?: string) {
  if (!question || !question.trim()) throw withCode(new FaqValidationError('A question is required.'), 'FAQ_QUESTION_REQUIRED');
  if (!answer || !answer.trim()) throw withCode(new FaqValidationError('An answer is required.'), 'FAQ_ANSWER_REQUIRED');
  if (question.length > 300) throw withCode(new FaqValidationError('Question is too long.'), 'FAQ_QUESTION_TOO_LONG');
  if (answer.length > 2000) throw withCode(new FaqValidationError('Answer is too long.'), 'FAQ_ANSWER_TOO_LONG');
}

@Injectable()
export class AiFaqService {
  constructor(@Inject('FaqRepo') private readonly repo: FaqRepo) {}
  private canManage(ctx: FaqCtx) { if (!hasPermission(ctx as any, 'ai.manage')) throw new FaqForbiddenError('Missing ai.manage'); }

  async list(ctx: FaqCtx): Promise<FaqRow[]> { return this.repo.list(ctx.tenantId); }

  async create(ctx: FaqCtx, v: FaqInput): Promise<FaqRow> {
    this.canManage(ctx); validate(v.question, v.answer);
    return this.repo.insert(ctx.tenantId, ctx.branchId, { question: v.question!.trim(), answer: v.answer!.trim(), category: v.category ?? null, language: v.language ?? 'en', isActive: v.isActive ?? true }, ctx.userId);
  }

  async update(ctx: FaqCtx, id: string, v: FaqInput): Promise<FaqRow> {
    this.canManage(ctx);
    const cur = await this.repo.get(ctx.tenantId, id); if (!cur) throw new FaqNotFoundError();
    if (v.question !== undefined || v.answer !== undefined) validate(v.question ?? cur.question, v.answer ?? cur.answer);
    const row = await this.repo.update(ctx.tenantId, id, v, ctx.userId); if (!row) throw new FaqNotFoundError(); return row;
  }

  async remove(ctx: FaqCtx, id: string): Promise<{ deleted: boolean }> {
    this.canManage(ctx);
    const ok = await this.repo.remove(ctx.tenantId, id); if (!ok) throw new FaqNotFoundError(); return { deleted: true };
  }
}

// ---- repos ----
const nowMs = () => Date.now();
export class InMemoryFaqRepo implements FaqRepo {
  private rows: FaqRow[] = []; private seq = 0;
  async list(tenantId: string) { return this.rows.filter((r) => r.tenantId === tenantId).sort((a, b) => b.createdAtMs - a.createdAtMs); }
  async get(tenantId: string, id: string) { return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null; }
  async insert(tenantId: string, branchId: string | null, v: FaqInput, _userId: string) {
    const r: FaqRow = { id: 'faq_' + (++this.seq), tenantId, branchId, question: v.question!, answer: v.answer!, category: v.category ?? null, language: v.language ?? 'en', isActive: v.isActive ?? true, createdAtMs: nowMs(), updatedAtMs: nowMs() };
    this.rows.push(r); return r;
  }
  async update(tenantId: string, id: string, v: FaqInput, _userId: string) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id); if (!r) return null;
    if (v.question !== undefined) r.question = v.question.trim();
    if (v.answer !== undefined) r.answer = v.answer.trim();
    if (v.category !== undefined) r.category = v.category;
    if (v.language !== undefined) r.language = v.language;
    if (v.isActive !== undefined) r.isActive = v.isActive;
    r.updatedAtMs = nowMs(); return r;
  }
  async remove(tenantId: string, id: string) { const n = this.rows.length; this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.id === id)); return this.rows.length < n; }
}

export class KyselyFaqRepo implements FaqRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): FaqRow => ({ id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, question: r.question, answer: r.answer, category: r.category ?? null, language: r.language, isActive: r.is_active, createdAtMs: new Date(r.created_at).getTime(), updatedAtMs: new Date(r.updated_at).getTime() });
  async list(tenantId: string) { return (await sql`SELECT * FROM ai_receptionist_faqs WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 500`.execute(this.db)).rows.map(this.map); }
  async get(tenantId: string, id: string) { const r: any = (await sql`SELECT * FROM ai_receptionist_faqs WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.db)).rows[0]; return r ? this.map(r) : null; }
  async insert(tenantId: string, branchId: string | null, v: FaqInput, userId: string) {
    const r: any = (await sql`INSERT INTO ai_receptionist_faqs (tenant_id, branch_id, question, answer, category, language, is_active, created_by_user_id, updated_by_user_id)
      VALUES (${tenantId}, ${branchId}, ${v.question}, ${v.answer}, ${v.category ?? null}, ${v.language ?? 'en'}, ${v.isActive ?? true}, ${userId}, ${userId}) RETURNING *`.execute(this.db)).rows[0];
    return this.map(r);
  }
  async update(tenantId: string, id: string, v: FaqInput, userId: string) {
    const r: any = (await sql`UPDATE ai_receptionist_faqs SET
        question = COALESCE(${v.question ?? null}, question),
        answer = COALESCE(${v.answer ?? null}, answer),
        category = ${'category' in v ? (v.category ?? null) : sql`category`},
        language = COALESCE(${v.language ?? null}, language),
        is_active = COALESCE(${v.isActive ?? null}, is_active),
        updated_by_user_id = ${userId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id} RETURNING *`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }
  async remove(tenantId: string, id: string) { const res: any = await sql`DELETE FROM ai_receptionist_faqs WHERE tenant_id = ${tenantId} AND id = ${id}`.execute(this.db); return Number(res.numAffectedRows ?? 0) > 0; }
}
