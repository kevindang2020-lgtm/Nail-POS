// request-schemas-leads.ts — BUILD_PLAN Phase 12 (#17): the technician-membership admin action, voice keys and
// prompts, and website leads. Clients: admin-web superAdminTechniciansApi.ts, superAdminVoiceApi.ts,
// superAdminWebsiteLeadsApi.ts; fields from the handlers and website-leads.service.ts.
import { id, num, numish, obj, scalar, str, type BodySchema } from './request-schemas-fields';

// ── technician membership admin action ─────────────────────────────────────────────────────────────────────────────
export const TECH_MEMBERSHIP_BODY: BodySchema = obj({ action: str(30), reason: str(2000) });
// ── voice (the issued key is returned once; the body only names it) ────────────────────────────────────────────────
export const VOICE_KEY_BODY: BodySchema = obj({ tenantId: id, branchId: id, label: str(200), provider: str(40), environment: str(10) });
export const VOICE_APPROVE_BODY: BodySchema = obj({ newPromptBody: str(50000), scope: str(40) });
export const VOICE_SCOPE_BODY: BodySchema = obj({ scope: str(40) });
// ── website leads ──────────────────────────────────────────────────────────────────────────────────────────────────
const lead = { salonName: str(200), contactName: str(200), phone: str(40), email: str(254), city: str(120), state: str(60), source: str(60), message: str(5000), currentPos: str(120), technicianCount: numish, monthlyCardVolumeCents: numish, leadScore: num };
export const WL_CREATE_BODY: BodySchema = obj({ ...lead, assignedToUserId: id, nextFollowUpAt: str(40) });
export const WL_UPDATE_BODY: BodySchema = obj(lead);
export const WL_NOTE_BODY: BodySchema = obj({ text: scalar(5000) });
export const WL_FOLLOW_UP_BODY: BodySchema = obj({ assignedToUserId: id, dueAt: str(40), notes: str(2000) });
export const WL_STATUS_BODY: BodySchema = obj({ status: scalar(30) });
export const WL_ASSIGN_BODY: BodySchema = obj({ assignedToUserId: id });
