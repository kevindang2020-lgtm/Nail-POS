// help-assistant.service.ts — the AI Support Assistant (spec §13–14). It answers ONLY from AI PowerSalon's
// approved, published, role-applicable help content: it retrieves candidate articles from the KB, grounds the
// model on exactly those sources via the shared AiGatewayService, cites them, and — crucially — never invents
// an answer. When no approved source matches (e.g. the KB is still empty) it returns an honest low-confidence
// fallback with escalation options and does NOT call the model at all. Support is free to every authenticated
// user, so this deliberately bypasses the paid AI access-gate; it reuses only the gateway.
import { AiGatewayService } from '@aipowersalon/ai';
import type { HelpCtx, HelpArticleSummary } from './help.service';

export type AssistantSource = { kind: 'article' | 'video'; id: string; title: string; categoryLabel: string | null };
export type AssistantAnswer = {
  answer: string;
  grounded: boolean;                 // true = answered from approved sources
  confidence: 'high' | 'low';
  sources: AssistantSource[];
  escalation: { liveChat: boolean; ticket: boolean };
  conversationId?: string | null;    // set once the turn is persisted, so the thread can continue / escalate
};

const ESCALATION = { liveChat: true, ticket: true };

/** Build a strictly-grounded prompt: answer only from the numbered sources, cite them, and admit when they
 * don't cover the question (so the caller can surface an honest low-confidence fallback). */
export function buildGroundingPrompt(
  question: string,
  sources: { title: string; summary: string | null; categoryLabel: string | null }[],
): { system: string; prompt: string } {
  const system = [
    'You are the AI Support Assistant for AI PowerSalon, a salon POS.',
    'Answer the user ONLY using the numbered SOURCES provided below. Do not use any outside knowledge.',
    'Cite the sources you rely on by their number, like [1] or [2].',
    "If the sources do not contain the answer, reply exactly: \"I don't have enough information in the approved help content to answer that.\" Do not guess.",
    'Never invent features, prices, or policies. Never claim to perform refunds, payroll, permission, or password actions.',
    'Be concise, and give step-by-step instructions where useful.',
  ].join(' ');
  const list = sources
    .map((s, i) => `[${i + 1}] ${s.title}${s.categoryLabel ? ` (${s.categoryLabel})` : ''}${s.summary ? `: ${s.summary}` : ''}`)
    .join('\n');
  const prompt = `QUESTION: ${question}\n\nSOURCES:\n${list}\n\nAnswer using only these sources, and cite them.`;
  return { system, prompt };
}

/** Honest fallback when no approved source matches — never fabricates an answer. */
export function noSourceFallback(): AssistantAnswer {
  return {
    answer: "I couldn't find an answer to that in AI PowerSalon's approved help content yet. You can email support — and, once available, start a live chat or open a ticket — and our team will help.",
    grounded: false, confidence: 'low', sources: [], escalation: ESCALATION,
  };
}

/** Treat an answer as ungrounded when the model signals it lacked sufficient source coverage. */
export function isGroundedAnswer(text: string): boolean {
  return !/(don'?t have enough information|couldn'?t find|not enough information|no information|cannot answer)/i.test(text || '');
}

/** Minimal retrieval surface — satisfied by HelpService; abstracted so the assistant is unit-testable with a stub. */
export interface HelpRetriever {
  articles(ctx: HelpCtx, opts: { q?: string; limit?: number }): Promise<HelpArticleSummary[]>;
}

/** Persistence port (spec §14). Stores only question/answer/grounding/sources — never secrets. Nullable so the
 * assistant runs (and tests) without a database. */
export interface AssistantConversationStore {
  saveTurn(ctx: HelpCtx, turn: { conversationId: string | null; question: string; answer: AssistantAnswer }): Promise<string | null>;
}

/** Pure: turn a low-confidence assistant exchange into a support ticket draft (used on explicit user confirmation). */
export function buildEscalationTicket(question: string, answer: string | null): { subject: string; description: string; category: string } {
  const q = (question || '').trim();
  const subject = q ? q.slice(0, 120) : 'Support request from the AI assistant';
  const reply = (answer || '').trim();
  const description = ['Escalated from the AI Support Assistant.', '', `Question: ${q || '(none)'}`, reply ? `\nAssistant reply:\n${reply}` : ''].join('\n');
  return { subject, description, category: 'general' };
}

export class HelpAssistantService {
  constructor(
    private readonly retriever: HelpRetriever,
    private readonly gateway: AiGatewayService,
    private readonly store: AssistantConversationStore | null = null,
  ) {}

  async ask(ctx: HelpCtx, question: string, conversationId: string | null = null): Promise<AssistantAnswer> {
    const q = (question || '').trim();
    const answer = await this.compute(ctx, q);
    // Persist the turn (fail-soft) — stores only the Q/A + grounding + cited sources, never the prompt or any secret.
    if (this.store && q) {
      try {
        const cid = await this.store.saveTurn(ctx, { conversationId, question: q, answer });
        if (cid) answer.conversationId = cid;
      } catch { /* persistence is best-effort; never blocks an answer */ }
    }
    return answer;
  }

  private async compute(ctx: HelpCtx, q: string): Promise<AssistantAnswer> {
    if (!q) return noSourceFallback();

    const articles = await this.retriever.articles(ctx, { q, limit: 4 });
    if (articles.length === 0) return noSourceFallback(); // no approved source → never calls the model

    const sources: AssistantSource[] = articles.map((a) => ({ kind: 'article', id: a.id, title: a.title, categoryLabel: a.categoryLabel }));
    const { system, prompt } = buildGroundingPrompt(q, articles);
    try {
      const out = await this.gateway.complete({ system, prompt, maxTokens: 600 });
      const grounded = isGroundedAnswer(out.text);
      return { answer: (out.text || '').trim(), grounded, confidence: grounded ? 'high' : 'low', sources, escalation: { liveChat: !grounded, ticket: !grounded } };
    } catch {
      return {
        answer: "I'm having trouble reaching the assistant right now. You can email support — and, once available, start a live chat or open a ticket.",
        grounded: false, confidence: 'low', sources, escalation: ESCALATION,
      };
    }
  }
}
