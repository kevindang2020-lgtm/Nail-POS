# Skills, eligibility, skill requests & certifications (Technician Profile mandate §35–§42)

**Model.** `technician_services` (tenant_id, technician_id, service_id, is_primary, proficiency — 583 unique per pair) is the
AUTHORITATIVE eligibility list: booking, queue, Fair Turn / AI queue assignment, AI scheduling and customer "Book with" all ask
`modules/workforce/src/eligibility/technician-eligibility.ts`. `technician_skills` is the taxonomy (skill groups shown on the roster);
services derive from the tenant/service catalog — a salon only has the skills its catalog offers (§36). Proficiency levels
(BASIC/INTERMEDIATE/ADVANCED/EXPERT) are stored when set; nothing in booking depends on them yet (§37 "only if meaning is clear").

**Eligibility checks (one function, in order):** technician exists in THIS tenant (TECHNICIAN_NOT_FOUND) → employment active
(TECHNICIAN_NOT_ACTIVE) → branch grant (TECHNICIAN_BRANCH_ACCESS_DENIED) → service mapped, else category fallback
(TECHNICIAN_NOT_SKILLED) → a service with `required_certification` needs a VERIFIED, unexpired, unrevoked certification
(TECHNICIAN_NOT_SKILLED; AI cannot override, §42) → schedule / conflicts when a time is given (TECHNICIAN_NOT_AVAILABLE /
SCHEDULE_CONFLICT) → not already serving (TECHNICIAN_ALREADY_SERVING). Codes are in `packages/api-contracts/src/errors.ts` (§155).

**Skill requests (§38–§40).** `technician_skill_change_requests` status: draft → submitted → under_review → more_info → approved |
rejected (583 CHECK). Technician: POST /tech/skills/change-requests (requested skill, category, proficiency, experience, notes,
portfolio evidence, document — documents are private media, signed URLs). Manager: POS Technicians → Skill requests
(`pos.technicians.skills.edit`): approve writes eligibility through the ONE writer `technician-skills.ts grantEligibility` and
the technician is notified; a technician can never approve her own request (route permission + branch scope).

**Certifications (§41–§42, §119).** `technician_certifications` (584/599): name, issuer, issued/expires, document (private),
verification_status UNVERIFIED → VERIFIED | REVOKED (terminal) | EXPIRED. POS verify/revoke with reason (`/pos/technician-certifications`),
tech app Certifications screen. Expiry reminders at 30/14/7 days by the certifications scheduler (modules/queue tech/technician-certifications.ts).

**Where it shows.** POS Technician Profile page → Skills & services (View all → Skill requests); roster "missing service mapping"
filter; tech app Skills; customer booking only lists eligible technicians (server validates again on create — §86).
