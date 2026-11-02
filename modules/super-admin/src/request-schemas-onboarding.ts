// request-schemas-onboarding.ts — BUILD_PLAN Phase 12 (#17): onboarding (admin-web onboardingApi.ts).
import { flag, id, num, obj, scalar, str, when, type BodySchema } from './request-schemas-fields';

export const ONB_CREATE_BODY: BodySchema = obj({ applicationId: scalar(128), applicationType: str(40), parentTenantId: id, branchCount: num, specialistUserId: id, priority: str(20), targetActivationDate: when });
export const ONB_NOTE_BODY: BodySchema = obj({ body: scalar(10000), noteType: str(40), visibility: str(40), stage: str(60), followUpDate: when });
export const ONB_REQUEST_INFO_BODY: BodySchema = obj({ message: scalar(5000), deadline: when });
export const ONB_RETURN_BODY: BodySchema = obj({ reason: scalar(2000), corrections: scalar(10000) });
export const ONB_APPROVAL_BODY: BodySchema = obj({ approvalType: str(60), stage: str(60), requiresSecondApproval: flag });
export const ONB_ACTIVATE_BODY: BodySchema = obj({ note: str(2000), activationType: str(40) });
export const ONB_REVIEW_DOCUMENT_BODY: BodySchema = obj({ status: str(40), rejectionReason: str(2000) });
export const ONB_TRANSITION_BODY: BodySchema = obj({ toState: scalar(60), reason: str(2000), allowSkip: flag, resumeStage: str(60) });
export const ONB_ASSIGN_BODY: BodySchema = obj({ specialistUserId: id });
export const ONB_DECIDE_BODY: BodySchema = obj({ status: scalar(40), reason: str(2000) });
