// community-moderation.providers.ts — BUILD_PLAN Phase 8 (agent B owns this file): the moderation half's providers, spread
// into TenantSafetyCommunityModule. Provides CommunityModerationService (the Super Admin moderation center) and
// COMMUNITY_RESTRICTIONS (CommunityRestrictions over community_restrictions — its own provider, so core ⇄ moderation is no DI cycle). It consumes the core's
// COMMUNITY_CORE (author labels — optional so the module still boots while the core is being wired), interactions'
// COMMUNITY_FANOUT + COMMUNITY_EVIDENCE_MODERATION, the lead's COMMUNITY_EVENTS (the outbox) and the platform's
// NotificationsService (the moderator's nudge to a salon's owner / approvers).
import type { Provider } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { NotificationsService } from '@aipowersalon/communications';
import {
  COMMUNITY_CORE, COMMUNITY_EVENTS, COMMUNITY_EVIDENCE_MODERATION, COMMUNITY_FANOUT, COMMUNITY_RESTRICTIONS,
  type CommunityCorePort, type CommunityEventsPort, type CommunityEvidenceModerationPort, type CommunityFanoutPort,
} from './community.ports';
import { CommunityModerationRepo } from './community-moderation.repository';
import { CommunityModerationService, CommunityModerationError, CommunityRestrictions, type CommunityTenantNotifier } from './community-moderation.service';
import { defaultLinkBase } from './community-notify';
import { workerPrincipal } from '@aipowersalon/permissions';

/** Emails the salon's owner + approvers through the platform's NotificationsService (opt-outs, credits and the delivery log
 *  already enforced there). The message never carries incident detail — it asks them to sign in. Never throws. */
export class PlatformModerationNotifier implements CommunityTenantNotifier {
  constructor(private readonly repo: CommunityModerationRepo, private readonly notifications: Pick<NotificationsService, 'send'>, private readonly linkBase = defaultLinkBase()) {}
  async notify(tenantId: string, msg: { subject: string; body: string }): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    const link = `${(this.linkBase || '').replace(/\/$/, '')}/community/drafts`;
    for (const c of await this.repo.tenantContacts(tenantId).catch(() => [])) {
      try {
        const r: any = await this.notifications.send(workerPrincipal('community-moderation', { tenantId }), { channel: 'email', to: c.email, subject: msg.subject, body: `${msg.body}\n\n${link}` });
        if (r?.sent === false) failed++; else sent++;
      } catch { failed++; }
    }
    return { sent, failed };
  }
}

/** No database (dev / some unit harnesses): every moderation call is an honest 503, never a fabricated answer. */
const noDatabaseRepo = (): CommunityModerationRepo => new Proxy({} as CommunityModerationRepo, {
  get: () => () => Promise.reject(new CommunityModerationError('database_not_configured', 503)),
});

export const COMMUNITY_MODERATION_PROVIDERS: Provider[] = [
  {
    provide: CommunityModerationService,
    useFactory: (db: AppDatabase | null, events: CommunityEventsPort, fanout: CommunityFanoutPort | null, evidence: CommunityEvidenceModerationPort | null,
                 core: CommunityCorePort | null, notifications: NotificationsService | null) => {
      const repo = db ? new CommunityModerationRepo(db) : noDatabaseRepo();
      return new CommunityModerationService(repo, events, fanout ?? null, evidence ?? null, core ?? null,
        db && notifications ? new PlatformModerationNotifier(repo, notifications) : null);
    },
    inject: [
      { token: DATABASE, optional: true }, COMMUNITY_EVENTS, { token: COMMUNITY_FANOUT, optional: true }, { token: COMMUNITY_EVIDENCE_MODERATION, optional: true },
      { token: COMMUNITY_CORE, optional: true }, { token: NotificationsService, optional: true },
    ],
  },
  {
    provide: COMMUNITY_RESTRICTIONS,
    useFactory: (db: AppDatabase | null) => (db ? new CommunityRestrictions(new CommunityModerationRepo(db))
      : { async active() { return { suspended: false, postingRestricted: false, commentingRestricted: false }; } }),
    inject: [{ token: DATABASE, optional: true }],
  },
];
export const COMMUNITY_MODERATION_IMPORTS: any[] = [];
