import { useEffect, useState } from 'react';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { centsToUsd } from '@aipowersalon/money';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// MembershipCoveragePanel — drop-in for checkout. Reads the membership coverage for a ticket (services already redeemed
// at Service Done, member discounts, dollar credits, upgrade charges). The checkout service applies the coverage itself
// (Decision 15); this panel only shows it — the checkout service stays
// the single source of truth for the total; this panel never computes money. Renders nothing when there's nothing to show.

const GOLD = '#A96F22';
const money = (c: number): string => centsToUsd(c);   // shared formatter: a negative reads −$6.75, never $-6.75 (wave 4 pilot)
// a membership status code → people.membership.status.<code> (WP-C2's labels), read at render
const statusText = (code: string) => codeLabel('people.membership.status', code);

interface CoveredLine { serviceLineId: string | null; serviceName: string | null; coveredCents: number }
interface MemberDiscount { benefitId: string; label: string; kind: string }
interface Coverage {
  membership: { membershipId: string; planName: string | null; status: string } | null;
  coveredLines?: CoveredLine[]; coveredTotalCents?: number; upgradeChargeCents?: number;
  memberDiscounts?: MemberDiscount[]; dollarCreditAvailableCents?: number;
}

export function MembershipCoveragePanel({ ticketId }: { ticketId: string | null }) {
  const [cov, setCov] = useState<Coverage | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ticketId) { setCov(null); setLoaded(true); return; }
    let alive = true;
    setLoaded(false);
    (posMembershipEnrollApi.coverage(ticketId) as Promise<any>)
      .then((r) => { if (alive) { setCov(r as Coverage); setLoaded(true); } })
      .catch(() => { if (alive) { setCov(null); setLoaded(true); } });
    return () => { alive = false; };
  }, [ticketId]);

  if (!loaded || !cov) return null;
  const coveredLines = cov.coveredLines || [];
  const memberDiscounts = cov.memberDiscounts || [];
  const hasAnything = cov.membership || coveredLines.length > 0 || memberDiscounts.length > 0 || (cov.dollarCreditAvailableCents || 0) > 0;
  if (!hasAnything) return null;

  return (
    <div style={{ background: '#FBF6EC', border: `1px solid ${GOLD}33`, borderRadius: 10, padding: 11, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span aria-hidden style={{ color: GOLD }}>★</span>
        <b style={{ fontSize: 12.5 }}>{t('pos.membership_coverage')}</b>
        {cov.membership && <span style={{ fontSize: 11.5, color: '#6A5A46' }}>{cov.membership.planName || t('pos.member')} · {statusText(cov.membership.status)}</span>}
      </div>

      {coveredLines.length > 0 ? (
        <div style={{ marginBottom: 6 }}>
          {coveredLines.map((l, i) => (
            <div key={l.serviceLineId || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
              <span style={{ color: '#5A4A36' }}>{l.serviceName || t('pos.covered_service')}</span>
              <span style={{ color: '#2E9E54', fontWeight: 700 }}>−{money(l.coveredCents)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, paddingTop: 4, marginTop: 2, borderTop: '1px solid #EADFCB', fontWeight: 700 }}>
            <span>{t('pos.covered_services')}</span><span style={{ color: '#2E9E54' }}>−{money(cov.coveredTotalCents || 0)}</span>
          </div>
        </div>
      ) : <div style={{ fontSize: 11, color: '#8A7A64', marginBottom: 6 }}>{t('pos.no_services_redeemed_against_this_ticket_rhyb')}</div>}

      {(cov.upgradeChargeCents || 0) > 0 && <div style={{ fontSize: 11, color: '#6A5A46' }}>{t('pos.upgrade_charges_on_this_ticket')}{' '}<b>+{money(cov.upgradeChargeCents || 0)}</b></div>}
      {memberDiscounts.map((d) => <div key={d.benefitId} style={{ fontSize: 10.5, color: '#8A7A64' }}>{d.label} {t('pos.applied_automatically')}</div>)}
      {(cov.dollarCreditAvailableCents || 0) > 0 && <div style={{ fontSize: 10.5, color: '#8A7A64' }}>{money(cov.dollarCreditAvailableCents || 0)} {t('pos.dollar_credit_available')}</div>}

      {/* Decision 15: the checkout service takes membership coverage off the bill itself (syncMembershipDiscounts, since
          Oct 1). The old "Apply −$X covered-services discount" button added the SAME amount again as a manual discount —
          a covered service came off twice. Removed Oct 2. */}
      {(cov.coveredTotalCents || 0) > 0 && <div style={{ marginTop: 6, fontSize: 11, color: '#2E9E54', fontWeight: 600 }}>{t('pos.already_taken_off_the_bill')}</div>}
    </div>
  );
}
