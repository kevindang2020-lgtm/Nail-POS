import { describe, it, expect } from 'vitest';
import { processorBucket, PROCESSOR_LABEL, processingStatus, underwritingStatus, applicationStatus, isPendingUnderwriting, riskStatus, isHighRisk, bankVerification, isBankVerificationPending, fundingSchedule, FUNDING_ISSUE_LABELS, alertSeverity, isActiveAlert, maskBankAccount, merchantRef, formatRate, pct, distribution, kpiTrendSemantic } from './merchant-accounts-core';

describe('merchant-accounts core', () => {
  it('buckets only Fiserv/CardPointe/Clover; everything else is other (Stripe/Square never surfaced)', () => {
    expect(processorBucket('fiserv')).toBe('fiserv');
    expect(processorBucket('bolt')).toBe('fiserv');
    expect(processorBucket('CardPointe')).toBe('cardpointe');
    expect(processorBucket('clover')).toBe('clover');
    expect(processorBucket('stripe')).toBe('other');
    expect(processorBucket('square')).toBe('other');
    expect(processorBucket('manual')).toBe('other');
    expect(processorBucket(null)).toBe('other');
    expect(PROCESSOR_LABEL.fiserv).toBe('Fiserv');
  });

  it('maps processing status to lifecycle buckets with business semantics', () => {
    expect(processingStatus('active')).toMatchObject({ key: 'active', label: 'Active', semantic: 'good' });
    expect(processingStatus('error').semantic).toBe('bad');
    expect(processingStatus('paused').key).toBe('suspended');
    expect(processingStatus('disabled')).toMatchObject({ key: 'inactive', semantic: 'neutral' });
  });

  it('maps underwriting + application status', () => {
    expect(underwritingStatus('approved')).toMatchObject({ label: 'Approved', semantic: 'good' });
    expect(underwritingStatus('under_review').label).toBe('Review Needed');
    expect(applicationStatus('submitted').label).toBe('Submitted');
    expect(applicationStatus(null).label).toBe('Draft');
    expect(isPendingUnderwriting('submitted')).toBe(true);
    expect(isPendingUnderwriting('under_review')).toBe(true);
    expect(isPendingUnderwriting('approved')).toBe(false);
  });

  it('maps risk level with business semantics and flags high risk', () => {
    expect(riskStatus('low')).toMatchObject({ label: 'Low', semantic: 'good' });
    expect(riskStatus('medium').semantic).toBe('warn');
    expect(riskStatus('high')).toMatchObject({ label: 'High', semantic: 'bad' });
    expect(riskStatus('critical').semantic).toBe('bad');
    expect(riskStatus(null)).toMatchObject({ key: 'unknown', label: '—', semantic: 'neutral' });
    expect(isHighRisk('high')).toBe(true);
    expect(isHighRisk('critical')).toBe(true);
    expect(isHighRisk('low')).toBe(false);
  });

  it('maps bank verification + funding schedule + funding issues', () => {
    expect(bankVerification('verified')).toMatchObject({ label: 'Verified', semantic: 'good' });
    expect(bankVerification('pending').semantic).toBe('warn');
    expect(bankVerification('failed').semantic).toBe('bad');
    expect(isBankVerificationPending('pending')).toBe(true);
    expect(isBankVerificationPending('submitted')).toBe(true);
    expect(isBankVerificationPending('verified')).toBe(false);
    expect(fundingSchedule('next_day')).toMatchObject({ label: 'Next Day', available: true });
    expect(fundingSchedule('not_configured')).toMatchObject({ label: 'Not Configured', available: false });
    expect(fundingSchedule(null).available).toBe(false);
    expect(FUNDING_ISSUE_LABELS.bank_verification_pending).toBe('Bank Verification Pending');
  });

  it('maps alert severity + active status', () => {
    expect(alertSeverity('critical')).toMatchObject({ label: 'Critical', semantic: 'bad' });
    expect(alertSeverity('warning').semantic).toBe('warn');
    expect(alertSeverity('info').semantic).toBe('neutral');
    expect(isActiveAlert('open')).toBe(true);
    expect(isActiveAlert('investigating')).toBe(true);
    expect(isActiveAlert('resolved')).toBe(false);
    expect(isActiveAlert('closed')).toBe(false);
  });

  it('masks bank account to last 4 only; honest dash when absent', () => {
    expect(maskBankAccount('123456784342')).toBe('•••• 4342');
    expect(maskBankAccount('4342')).toBe('•••• 4342');
    expect(maskBankAccount(null)).toBe('—');
    expect(maskBankAccount('12')).toBe('—');
  });

  it('shows merchant ref or fallback', () => {
    expect(merchantRef('MID-1', 'x')).toBe('MID-1');
    expect(merchantRef(null, '—')).toBe('—');
  });

  it('formats rates decimal-safe from basis points + minor units', () => {
    expect(formatRate(249, 15)).toBe('2.49% + $0.15');
    expect(formatRate(260, 30)).toBe('2.60% + $0.30');
    expect(formatRate(null, null)).toBe('—');
    expect(formatRate(239, null)).toBe('2.39%');
  });

  it('computes reconciling distribution percentages', () => {
    const rows = [{ key: 'a', label: 'A', count: 72 }, { key: 'b', label: 'B', count: 28 }];
    const d = distribution(rows, 100);
    expect(d[0].pct).toBe(72);
    expect(d[1].pct).toBe(28);
    expect(pct(0, 0)).toBe(0);
  });

  it('applies business-meaning trend semantics', () => {
    expect(kpiTrendSemantic('active', 'up')).toBe('good');
    expect(kpiTrendSemantic('high_risk', 'up')).toBe('bad');
    expect(kpiTrendSemantic('funding_issues', 'down')).toBe('good');
    expect(kpiTrendSemantic('inactive', 'flat')).toBe('neutral');
  });
});
