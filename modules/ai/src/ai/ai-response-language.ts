// ai-response-language.ts — English + Vietnamese POS mandate §120 (Oct 27 2026): the language a model writes its prose in.
//
// Before: the registry declared `languageBehavior: 'tenant_locale'` on the explanation prompts but no language ever reached
// a prompt, so the POS showed the model's English under "Giải thích do AI viết (tiếng Anh):". Now the gateway carries a
// RESPONSE LANGUAGE:
//   • AiPlatform.execute — `AIRequest.responseLanguage`, or, when the caller leaves it out, the language of the person the
//     prose is for: the signed-in user's POS language (users.preferred_language), else the salon's POS default
//     (Settings → Business `defaultLanguage`), else English. A job with no user gets the salon default. Same rule as
//     apps/api LanguageService.posLocale — this is a read of the same two rows, not a second setting.
//   • AiAssistantService.run — `responseLanguage: 'en' | 'vi' | 'user'` (explicit only: the 15 assistant endpoints include
//     customer-facing drafts, so nothing changes unless the caller asks).
// The language is a fixed, static policy line added to the SYSTEM block (§27: instructions never carry variables);
// English adds nothing, so an English request renders byte-for-byte the prompt it rendered before. Prompts whose
// behaviour is 'english' (OCR, reconciliation) or 'match_input' (a reply follows the customer's own language) never get
// one, and neither does a prompt that takes its own `language` variable (marketing). The result records the language the
// prose was asked for, so a screen can label prose in the other language and a cache never serves one language for the
// other (the idempotency key and the stored scheduling explanation both carry it).
import { sql, type Kysely } from 'kysely';
import { Logger } from '@nestjs/common';
import { getContext } from '@aipowersalon/observability';

const languageLog = new Logger('AiResponseLanguage');

export const RESPONSE_LANGUAGES = ['en', 'vi'] as const;
export type ResponseLanguage = (typeof RESPONSE_LANGUAGES)[number];
export const isResponseLanguage = (v: unknown): v is ResponseLanguage => v === 'en' || v === 'vi';

/** The static policy line per language. English is the platform's default and adds nothing. */
export const RESPONSE_LANGUAGE_DIRECTIVE: Readonly<Record<ResponseLanguage, string>> = Object.freeze({
  en: '',
  vi: 'RESPONSE LANGUAGE: write every human-readable text value in Vietnamese (Tiếng Việt), in plain words a nail-salon '
    + 'front desk uses; call a technician "thợ". Keep JSON keys, codes, ids, numbers, money amounts, times, dates and people\'s '
    + 'or services\' names exactly as given. Do not translate the JSON keys.',
});

/** Does this prompt take a response language at all? */
export function promptTakesLanguage(p: { languageBehavior: 'match_input' | 'tenant_locale' | 'english'; variables: { name: string }[] }): boolean {
  return p.languageBehavior === 'tenant_locale' && !p.variables.some((v) => v.name === 'language');
}

/** The system block with the language line (or unchanged for English / a prompt that does not take one). */
export function withLanguageDirective(system: string, lang: ResponseLanguage): string {
  const d = RESPONSE_LANGUAGE_DIRECTIVE[lang];
  return d ? `${system}\n\n${d}` : system;
}

/** Who the prose is for → their language. */
export interface ResponseLanguageResolver {
  forUser(q: { tenantId: string; userId: string | null; branchId?: string | null }): Promise<ResponseLanguage>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this call made from the employee web POS? Kevin (Oct 28 + Nov 9 2026): Vietnamese ONLY in the web POS — the Owner,
 *  Technician, Customer and Tap to Pay apps, background jobs and everything a customer receives are English. The POS sends
 *  `X-Client-Type: pos` on every request (client.ts posHttp); no request context (a job, an event) → not the POS. */
export function isFrontDeskPosRequest(ctx: { clientApp?: string } | undefined = getContext()): boolean {
  return ctx?.clientApp === 'pos';
}

/** The POS rule over the database: the user's own choice → the salon's default → English. Never throws (English).
 *  Outside the web POS the answer is always English (isFrontDeskPosRequest). */
export class KyselyResponseLanguageResolver implements ResponseLanguageResolver {
  constructor(private readonly db: Kysely<any>, private readonly isPos: () => boolean = () => isFrontDeskPosRequest()) {}
  async forUser(q: { tenantId: string; userId: string | null; branchId?: string | null }): Promise<ResponseLanguage> {
    if (!this.isPos()) return 'en';
    try {
      if (q.userId && UUID.test(q.userId)) {
        const r = await sql<{ l: string | null }>`select preferred_language as l from users where id = ${q.userId}::uuid and (tenant_id = ${q.tenantId}::uuid or tenant_id is null)`.execute(this.db);
        const mine = r.rows[0]?.l ?? null;
        if (isResponseLanguage(mine)) return mine;
      }
      if (q.tenantId && UUID.test(q.tenantId)) {
        const r = await sql<{ l: string | null }>`select settings_json->>'defaultLanguage' as l from tenant_settings
          where tenant_id = ${q.tenantId}::uuid and category = 'business-branch' and (branch_id is null or branch_id::text = ${q.branchId ?? ''})
            and settings_json->>'defaultLanguage' in ('en', 'vi')
          order by (branch_id is null) desc limit 1`.execute(this.db);
        const salon = r.rows[0]?.l ?? null;
        if (isResponseLanguage(salon)) return salon;
      }
    } catch (e) { languageLog.warn(`response language lookup failed, answering in English: ${String((e as Error)?.message ?? e).slice(0, 200)}`); /* a language lookup never fails an AI call */ }
    return 'en';
  }
}

/** Fixed language (tests, no database). */
export const fixedResponseLanguage = (lang: ResponseLanguage): ResponseLanguageResolver => ({ forUser: async () => lang });
