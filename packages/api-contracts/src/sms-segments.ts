// sms-segments.ts — Payments/Twilio mandate §77 / §81 (wave 3): how many SMS SEGMENTS a text costs — the billable unit.
// Pure, provider-agnostic (the GSM-7 / UCS-2 rules every carrier bills by): a message that fits the single-segment
// limit is one segment; longer messages are split into concatenated segments with a smaller per-segment budget.
// The provider's own count (Twilio num_segments) is authoritative when it arrives; this is the ESTIMATE for previews.
const GSM7 = /^[\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€\n\r]*$/;
const GSM7_EXT = /[\^{}\\\[~\]|€]/g;   // these cost two GSM-7 septets each

export interface SmsSegmentEstimate { segments: number; encoding: 'GSM-7' | 'UCS-2'; units: number; perSegment: number }

export function estimateSmsSegments(text: string): SmsSegmentEstimate {
  const t = String(text ?? '');
  if (!t.length) return { segments: 0, encoding: 'GSM-7', units: 0, perSegment: 160 };
  if (GSM7.test(t)) {
    const units = t.length + (t.match(GSM7_EXT)?.length ?? 0);
    return units <= 160 ? { segments: 1, encoding: 'GSM-7', units, perSegment: 160 } : { segments: Math.ceil(units / 153), encoding: 'GSM-7', units, perSegment: 153 };
  }
  const units = [...t].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);   // UTF-16 code units
  return units <= 70 ? { segments: 1, encoding: 'UCS-2', units, perSegment: 70 } : { segments: Math.ceil(units / 67), encoding: 'UCS-2', units, perSegment: 67 };
}

/** §81: what a salon sees before a large campaign goes out. Money in integer cents; null = the platform has not priced
 *  marketing segments (the preview then says so instead of inventing a number). */
export interface CampaignCostPreview {
  campaignId: string; channel: string;
  recipients: number; optedOut: number; deliverable: number;
  segmentsPerMessage: number; encoding: 'GSM-7' | 'UCS-2'; estimatedSegments: number;
  includedRemaining: number | null; estimatedOverageSegments: number | null;
  unitPriceCents: number | null; estimatedCostCents: number | null;
  /** The send needs an explicit, authorized confirmation (large campaign) — the activate call must carry confirmEstimate: true. */
  requiresConfirmation: boolean; confirmationThreshold: number;
}
/** A campaign at or above this many deliverable recipients needs an explicit confirmation before it is activated. */
export const LARGE_CAMPAIGN_RECIPIENTS = 50;
