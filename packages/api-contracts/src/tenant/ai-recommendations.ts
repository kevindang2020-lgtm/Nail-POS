// ai-recommendations.ts — AI Receptionist Settings 07 (extras, Nov 13 2026): the salon-side approval screen for the voice learning
// loop's configuration recommendations (tenant/ai/receptionist/learning/*). Approving never changes anything live: a prompt
// recommendation becomes a DRAFT prompt version that platform support activates separately; operational targets are refused.
export type AiRecommendationStatus = 'open' | 'approved' | 'rejected' | 'applied';

export interface AiRecommendation {
  id: string;
  sourceCallId: string | null;
  category: string;
  targetType: string;
  detail: string;
  status: AiRecommendationStatus;
  reviewedBy: string | null;
  resultingVersionId: string | null;
  createdMs: number;
}

export interface AiRecommendationList { items: AiRecommendation[]; openCount: number; }

export interface AiRecommendationDecision {
  recommendation: AiRecommendation;
  /** The DRAFT prompt version an approval created (prompt recommendations only). It is never live. */
  draftVersionId: string | null;
  draftVersionLabel: string | null;
}
