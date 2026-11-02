import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerMembershipApi, type CustomerMembershipView, type MemberBenefit, type AvailableMembershipPlan } from '../api/customerMembershipApi';
import { fmtDate as fmtBranchDate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { centsToUsd } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Membership (member-facing) — the signed-in customer's own plan, status, member number, next billing date, and benefits
// with remaining credits. Also displays available salon membership plans so non-members and members can explore and join.

const fmtDate = (iso: string | null) => (iso ? fmtBranchDate(iso) : '');
const money = (c: number) => centsToUsd(c);

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', trial: 'Trial', active: 'Active', grace: 'Grace period', past_due: 'Past due', paused: 'Paused',
  canceling: 'Canceling', canceled: 'Canceled', expired: 'Expired', suspended: 'Suspended', comped: 'Complimentary', completed: 'Completed',
};
const GOOD = new Set(['active', 'trial', 'comped']);

function benefitRemaining(b: MemberBenefit): string | null {
  if (b.benefitType === 'service_credit') return b.serviceCreditsAvailable > 0 ? `${b.serviceCreditsAvailable} left` : 'None left';
  if (b.benefitType === 'dollar_credit') return `${money(b.dollarCreditsAvailableCents)} left`;
  return null;
}

export function MembershipScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<CustomerMembershipView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningPlanId, setJoiningPlanId] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const loadMembership = (isMounted = true) => {
    customerMembershipApi.membership()
      .then((d) => { if (isMounted) setData(d); })
      .catch((e: any) => { if (isMounted) setError(e?.message || 'Could not load your membership.'); });
  };

  useEffect(() => {
    let live = true;
    loadMembership(live);
    return () => { live = false; };
  }, []);

  const handleJoin = async (plan: AvailableMembershipPlan) => {
    if (joiningPlanId) return;
    setJoiningPlanId(plan.planId);
    setError(null);
    try {
      await customerMembershipApi.join(plan.planId, plan.planVersionId);
      setJoinSuccess(`Congratulations! You are now enrolled in ${plan.name}.`);
      loadMembership(true);
    } catch (err: any) {
      setError(err?.message || 'Could not join membership plan.');
    } finally {
      setJoiningPlanId(null);
    }
  };

  const m = data?.membership;
  const good = m ? GOOD.has(m.status) : false;
  const availablePlans = data?.availablePlans || [];

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="customer-back"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Membership</h1>
      </div>

      {joinSuccess && (
        <div className="cust-card" style={{ padding: 14, color: '#065F46', background: '#D1FAE5', border: '1px solid #A7F3D0', fontWeight: 600 }}>
          ✓ {joinSuccess}
        </div>
      )}

      {error && (
        <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>
          {error}
        </div>
      )}

      {!data ? (
        <div className="cust-skel" style={{ height: 160, borderRadius: 16 }} />
      ) : (
        <>
          {/* Active Membership Section */}
          {data.hasMembership && m ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="cust-card" style={{ padding: 20, background: 'linear-gradient(135deg, #C9971B, #A96F22 60%, #84561A)', color: '#fff', border: 0, borderRadius: 18, boxShadow: '0 10px 25px -5px rgba(201, 151, 27, 0.4)' }}>
                <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.95 }}>★ VIP Member</span>
                <div style={{ fontWeight: 800, fontSize: 22, marginTop: 6 }}>{m.planName || 'Membership'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 12, background: good ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)', padding: '4px 12px', borderRadius: 999 }}>
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                  {m.memberNumber && <span style={{ fontSize: 12, opacity: 0.95 }}>Member #{m.memberNumber}</span>}
                </div>
                {m.nextBillingAt && <div style={{ fontSize: 12.5, opacity: 0.95, marginTop: 12 }}>Next billing: {fmtDate(m.nextBillingAt)}</div>}
              </div>

              <div>
                <h2 className="cust-h2" style={{ fontSize: 16, marginBottom: 10 }}>Your Plan Benefits</h2>
                {data.benefits.length === 0 ? (
                  <div className="cust-card" style={{ padding: 16 }}><div className="cust-sub">This plan has no itemized benefits.</div></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.benefits.map((b) => {
                      const remaining = benefitRemaining(b);
                      return (
                        <div key={b.benefitId} className="cust-card" style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderLeft: '4px solid var(--customer-primary)' }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{b.label}</span>
                          {remaining && <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--customer-primary)', background: 'var(--customer-purple-100)', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{remaining}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : availablePlans.length === 0 ? (
            <div className="cust-card" style={{ padding: 24, textAlign: 'center', borderRadius: 16 }}>
              <div aria-hidden style={{ fontSize: 32 }}>★</div>
              <h2 className="cust-h2" style={{ marginTop: 8 }}>You're not a member yet</h2>
              <div className="cust-sub" style={{ marginTop: 4 }}>
                Ask the front desk about membership perks on your next visit.
              </div>
            </div>
          ) : null}

          {/* Available Membership Plans Section */}
          {availablePlans.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h2 className="cust-h2" style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 6 }}>
                  ✨ VIP Membership Plans
                </h2>
                <div className="cust-sub" style={{ fontSize: 12.5 }}>
                  Select a plan to subscribe and enjoy instant salon benefits.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {availablePlans.map((p) => {
                  const isCurrent = m?.planName === p.name && good;
                  const isJoining = joiningPlanId === p.planId;
                  const priceStr = money(p.priceCents);
                  const intervalStr = p.billingInterval === 'month' ? '/ mo' : p.billingInterval === 'year' ? '/ yr' : '';

                  return (
                    <div
                      key={p.planId}
                      className="cust-card"
                      style={{
                        padding: 18,
                        borderRadius: 18,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        border: p.isPopular ? '2px solid #D97706' : '1px solid #E5E7EB',
                        background: p.isPopular ? '#FFFDF9' : '#FFFFFF',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
                        position: 'relative',
                      }}
                    >
                      {/* Top Badge */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, fontSize: 18, color: '#1F2937' }}>
                          {p.name}
                        </span>
                        {(p.badge || p.isPopular) && (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '3px 10px',
                            borderRadius: 999,
                            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                            color: '#FFFFFF',
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}>
                            {p.badge || '★ Popular'}
                          </span>
                        )}
                      </div>

                      {/* Pricing */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ fontSize: 26, fontWeight: 900, color: '#92400E' }}>
                          {priceStr}
                        </span>
                        <span style={{ fontSize: 13, color: '#6B7280', fontWeight: 600 }}>
                          {intervalStr}
                        </span>
                        {p.enrollmentFeeCents > 0 && (
                          <span style={{ fontSize: 11.5, color: '#9CA3AF', marginLeft: 6 }}>
                            (+{money(p.enrollmentFeeCents)} setup fee)
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {p.description && (
                        <div style={{ fontSize: 13.5, color: '#4B5563', lineHeight: 1.45 }}>
                          {p.description}
                        </div>
                      )}

                      {/* Benefits */}
                      {p.benefits && p.benefits.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #F1F5F9' }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Included Perks:
                          </span>
                          {p.benefits.map((b) => (
                            <div key={b.benefitId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', fontWeight: 500 }}>
                              <span style={{ color: '#10B981', fontWeight: 900 }}>✓</span>
                              <span>{b.label}</span>
                              {b.creditsPerCycle > 0 && (
                                <span style={{ fontSize: 11, background: '#E0E7FF', color: '#3730A3', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>
                                  {b.creditsPerCycle} / cycle
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action Button */}
                      <div style={{ marginTop: 4 }}>
                        {isCurrent ? (
                          <button
                            type="button"
                            disabled
                            style={{
                              width: '100%',
                              padding: '12px',
                              borderRadius: 12,
                              background: '#E5E7EB',
                              color: '#6B7280',
                              fontWeight: 700,
                              fontSize: 14,
                              border: 'none',
                              cursor: 'default',
                            }}
                          >
                            ✓ Your Current Plan
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleJoin(p)}
                            disabled={isJoining}
                            style={{
                              width: '100%',
                              padding: '13px',
                              borderRadius: 12,
                              background: 'linear-gradient(135deg, #D97706, #B45309)',
                              color: '#FFFFFF',
                              fontWeight: 800,
                              fontSize: 14.5,
                              border: 'none',
                              cursor: isJoining ? 'not-allowed' : 'pointer',
                              boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            {isJoining ? 'Joining…' : `Join ${p.name}`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
