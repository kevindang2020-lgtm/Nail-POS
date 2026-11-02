// ai-voice-transcription-entitlement.ts — Plans/Feature-Limits gate. A tenant may use transcription only if
// subscribed to the `ai_voice_transcription` AI package (already defined in ai-catalog.ts). Reuses the existing
// tenant_ai_subscriptions table — no parallel entitlement system. Fail-closed on error.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export const VOICE_TRANSCRIPTION_PACKAGE = 'ai_voice_transcription';
const ENTITLED = new Set(['active', 'trialing', 'trial', 'past_due']);

export interface VoiceEntitlementPort {
  hasVoiceTranscription(tenantId: string): Promise<boolean>;
}

export class InMemoryVoiceEntitlement implements VoiceEntitlementPort {
  constructor(private readonly entitled: (tenantId: string) => boolean = () => true) {}
  async hasVoiceTranscription(tenantId: string) { return this.entitled(tenantId); }
}

export class KyselyVoiceEntitlement implements VoiceEntitlementPort {
  constructor(private readonly db: Kysely<DB>) {}
  async hasVoiceTranscription(tenantId: string): Promise<boolean> {
    try {
      const r: any = await sql`
        select status from tenant_ai_subscriptions
        where tenant_id = ${tenantId} and package_code = ${VOICE_TRANSCRIPTION_PACKAGE} limit 1`.execute(this.db);
      return ENTITLED.has(String(r.rows?.[0]?.status ?? '').toLowerCase());
    } catch {
      return false;
    }
  }
}
