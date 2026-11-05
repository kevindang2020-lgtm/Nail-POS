// noshow-risk.core.ts — transparent, fair no-show / cancellation risk scoring. Operational signals ONLY. This model
// deliberately has NO field for race, ethnicity, religion, disability, sexual orientation, immigration status, political
// affiliation, or any protected/sensitive attribute — it is structurally impossible to score on them. The score is a
// bounded weighted sum of explainable contributions; every nonzero contribution emits a plain-language reason code.
// Accuracy is NOT asserted here — calibration/backtesting against verified outcomes is a separate step, and the output is
// decision-support that only ever recommends PERMITTED, non-punitive actions (remind / request confirmation / review
// deposit / manager follow-up). It never cancels, blocks, penalizes, or raises a deposit.

export type RiskLevel = 'low' | 'moderate' | 'high' | 'very_high' | 'insufficient_data';
export type RiskConfidence = 'high' | 'moderate' | 'low' | 'insufficient_data';

export interface RiskFeatures {
  totalPriorAppointments: number;   // completed history depth (drives confidence)
  priorNoShows: number;
  priorLateCancellations: number;
  bookingLeadTimeDays: number;      // start_time − created_at
  confirmationRequired: boolean;
  confirmed: boolean;
  depositOnFile: boolean | null;    // null = unknown (not penalized as strongly)
  reminderRecentlyDelivered: boolean | null;
  groupSize: number | null;
}

export interface RiskReason { code: string; label: string; direction: 'raises' | 'lowers' }
export interface RiskResult {
  score: number;            // 0..1
  level: RiskLevel;
  confidence: RiskConfidence;
  reasons: RiskReason[];
  permittedActions: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Permitted, non-punitive actions by level (§ cancellation/no-show). NEVER cancel/block/penalize/raise deposit.
function actionsFor(level: RiskLevel): string[] {
  switch (level) {
    case 'very_high': return ['Request customer confirmation', 'Review deposit status per tenant policy', 'Add to manager follow-up list'];
    case 'high': return ['Request customer confirmation', 'Review deposit status per tenant policy'];
    case 'moderate': return ['Send the normal appointment reminder', 'Request customer confirmation'];
    case 'insufficient_data': return ['Send the normal appointment reminder'];
    default: return ['Send the normal appointment reminder'];
  }
}

export function scoreNoShowRisk(f: RiskFeatures): RiskResult {
  const reasons: RiskReason[] = [];
  let score = 0.12; // base rate prior

  // Strongest signal: the customer's own prior no-show rate (only when there's history).
  if (f.totalPriorAppointments >= 2) {
    const noShowRate = f.priorNoShows / f.totalPriorAppointments;
    if (noShowRate > 0) {
      const add = Math.min(0.45, noShowRate * 0.6);
      score += add;
      reasons.push({ code: 'prior_no_shows', label: `${f.priorNoShows} prior no-show(s) in ${f.totalPriorAppointments} visits`, direction: 'raises' });
    } else {
      score -= 0.06;
      reasons.push({ code: 'reliable_history', label: 'No prior no-shows on record', direction: 'lowers' });
    }
    if (f.priorLateCancellations > 0) {
      score += Math.min(0.15, f.priorLateCancellations * 0.05);
      reasons.push({ code: 'prior_late_cancellations', label: `${f.priorLateCancellations} prior late cancellation(s)`, direction: 'raises' });
    }
  }

  // Confirmation state.
  if (f.confirmationRequired && !f.confirmed) {
    score += 0.12;
    reasons.push({ code: 'not_confirmed', label: 'Confirmation required but not yet confirmed', direction: 'raises' });
  } else if (f.confirmed) {
    score -= 0.05;
    reasons.push({ code: 'confirmed', label: 'Appointment confirmed', direction: 'lowers' });
  }

  // Deposit (only when known).
  if (f.depositOnFile === false) {
    score += 0.06;
    reasons.push({ code: 'no_deposit', label: 'No deposit on file', direction: 'raises' });
  } else if (f.depositOnFile === true) {
    score -= 0.08;
    reasons.push({ code: 'deposit_on_file', label: 'Deposit on file', direction: 'lowers' });
  }

  // Long booking lead time increases no-show likelihood; a reminder lowers it.
  if (f.bookingLeadTimeDays >= 21) {
    score += 0.08;
    reasons.push({ code: 'long_lead_time', label: `Booked ${Math.round(f.bookingLeadTimeDays)} days ahead`, direction: 'raises' });
  }
  if (f.reminderRecentlyDelivered === true) {
    score -= 0.05;
    reasons.push({ code: 'reminder_delivered', label: 'Reminder recently delivered', direction: 'lowers' });
  }
  if (f.groupSize != null && f.groupSize >= 3) {
    score += 0.04;
    reasons.push({ code: 'group_booking', label: `Group of ${f.groupSize}`, direction: 'raises' });
  }

  score = clamp01(score);

  // Confidence from history depth; insufficient when there's neither history nor an operational signal.
  const hasOperationalSignal = (f.confirmationRequired && !f.confirmed) || f.depositOnFile === false || f.bookingLeadTimeDays >= 21;
  let confidence: RiskConfidence;
  if (f.totalPriorAppointments >= 8) confidence = 'high';
  else if (f.totalPriorAppointments >= 3) confidence = 'moderate';
  else if (f.totalPriorAppointments >= 1 || hasOperationalSignal) confidence = 'low';
  else confidence = 'insufficient_data';

  let level: RiskLevel;
  if (confidence === 'insufficient_data') level = 'insufficient_data';
  else if (score >= 0.6) level = 'very_high';
  else if (score >= 0.38) level = 'high';
  else if (score >= 0.2) level = 'moderate';
  else level = 'low';

  return { score: round3(score), level, confidence, reasons, permittedActions: actionsFor(level) };
}
