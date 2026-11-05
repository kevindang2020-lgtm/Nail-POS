import { useCallback, useEffect, useState } from 'react';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { centsToUsd } from '@aipowersalon/money';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// MembershipRedeemPanel — drop-in for Service Done (and later checkout). Given a ticket's customer and its service lines,
// it surfaces the customer's active membership and lets staff redeem an included-service credit against a specific line.
// Redemption is server-side double-spend-safe (a held/available credit is consumed and an immutable redemption recorded;
// a line can redeem at most once). Member discounts / dollar credits are shown as informational — they apply at checkout.
// Renders nothing for non-members, so it's safe to always mount.

const GOLD = '#A96F22';
const money = (c: number): string => centsToUsd(c);   // shared formatter: a negative reads −$6.75, never $-6.75 (wave 4 pilot)
// a membership status code → people.membership.status.<code> (WP-C2's labels), read at render
const statusText = (code: string) => codeLabel('people.membership.status', code);
const REDEEMABLE = new Set(['service_credit', 'addon']);

interface ServiceLine { serviceLineId: string; serviceName: string; priceCents: number; isAddOn?: boolean }
interface Benefit { benefitId: string; label: string; benefitType: string; serviceId: string | null; serviceCreditsAvailable: number; dollarCreditsAvailableCents: number }
interface ActiveMembership { membershipId: string; planName: string | null; status: string }

const ACTIVE = new Set(['active', 'trial', 'grace', 'comped']);

export function MembershipRedeemPanel({ customerId, ticketId, technicianId, services, onRedeemed }: {
  customerId: string; ticketId: string; technicianId: string | null; services: ServiceLine[]; onRedeemed: (msg: string) => void;
}) {
  const [membership, setMembership] = useState<ActiveMembership | null>(null);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [lineFor, setLineFor] = useState<Record<string, string>>({});
  const [redeemed, setRedeemed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadBenefits = useCallback((membershipId: string) => {
    (posMembershipEnrollApi.memberBenefits(membershipId) as Promise<any>)
      .then((r) => setBenefits((r?.benefits || []) as Benefit[]))
      .catch(() => setBenefits([]));
  }, []);

  useEffect(() => {
    if (!customerId) { setMembership(null); setLoaded(true); return; }
    let alive = true;
    setLoaded(false);
    (posMembershipEnrollApi.customerMemberships(customerId) as Promise<any>)
      .then((r) => {
        if (!alive) return;
        const list: any[] = r?.memberships || [];
        const active = list.find((m) => ACTIVE.has(m.status)) || null;
        setMembership(active ? { membershipId: active.membershipId, planName: active.planName, status: active.status } : null);
        if (active) loadBenefits(active.membershipId);
        setLoaded(true);
      })
      .catch(() => { if (alive) { setMembership(null); setLoaded(true); } });
    return () => { alive = false; };
  }, [customerId, loadBenefits]);

  if (!loaded || !membership) return null;

  const openLines = services.filter((l) => !redeemed.has(l.serviceLineId));
  const creditBenefits = benefits.filter((b) => REDEEMABLE.has(b.benefitType) && b.serviceCreditsAvailable > 0);
  const infoBenefits = benefits.filter((b) => !REDEEMABLE.has(b.benefitType) && (b.benefitType === 'percent_discount' || b.benefitType === 'fixed_discount' || b.dollarCreditsAvailableCents > 0));

  const redeem = async (b: Benefit) => {
    const lineId = lineFor[b.benefitId] || openLines[0]?.serviceLineId;
    if (!lineId) { setNote(t('pos.pick_a_service_to_apply_this_1ltr')); return; }
    setBusy(b.benefitId); setNote(null);
    try {
      await posMembershipEnrollApi.redeem({ membershipId: membership.membershipId, benefitId: b.benefitId, ticketId, serviceLineId: lineId, technicianId });
      setRedeemed((s) => new Set(s).add(lineId));
      loadBenefits(membership.membershipId);
      onRedeemed(t('admin.membership.applied', { label: b.label }));
    } catch (e: any) { setNote(e?.message || t('pos.could_not_apply_this_benefit')); } finally { setBusy(null); }
  };

  return (
    <div style={{ background: '#FBF6EC', border: `1px solid ${GOLD}33`, borderRadius: 9, padding: 9, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span aria-hidden style={{ color: GOLD }}>★</span>
        <b style={{ fontSize: 12 }}>{t('pos.membership_2')}</b>
        <span style={{ fontSize: 11.5, color: '#6A5A46' }}>{membership.planName || t('pos.member')} · {statusText(membership.status)}</span>
      </div>

      {creditBenefits.length === 0 && infoBenefits.length === 0 && <div style={{ fontSize: 11, color: '#8A7A64' }}>{t('pos.no_remaining_benefits_for_this_cycle')}</div>}

      {creditBenefits.map((b) => (
        <div key={b.benefitId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 120 }}>{b.label}</span>
          <span style={{ fontSize: 10.5, color: '#8A7A64' }}>{b.serviceCreditsAvailable} {t('pos.left')}</span>
          <select value={lineFor[b.benefitId] || openLines[0]?.serviceLineId || ''} onChange={(e) => setLineFor((m) => ({ ...m, [b.benefitId]: e.target.value }))} style={{ flex: 1, minWidth: 120, padding: '4px 6px', border: '1px solid var(--line,#E2D6C2)', borderRadius: 6, fontSize: 11.5 }}>
            {openLines.length === 0 ? <option value="">{t('pos.no_eligible_lines')}</option> : openLines.map((l) => <option key={l.serviceLineId} value={l.serviceLineId}>{l.serviceName} · {money(l.priceCents)}</option>)}
          </select>
          <button onClick={() => redeem(b)} disabled={busy === b.benefitId || openLines.length === 0} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: openLines.length === 0 ? 'not-allowed' : 'pointer', opacity: openLines.length === 0 ? 0.6 : 1 }}>{busy === b.benefitId ? t('pos.applying') : t('pos.apply_2')}</button>
        </div>
      ))}

      {infoBenefits.map((b) => (
        <div key={b.benefitId} style={{ fontSize: 10.5, color: '#8A7A64' }}>{b.label}{b.dollarCreditsAvailableCents > 0 ? t('pos.dollarcreditsavailablecents_credit', { dollarCreditsAvailableCents: String(money(b.dollarCreditsAvailableCents)) }) : ''} {t('pos.applies_at_checkout')}</div>
      ))}

      {redeemed.size > 0 && <div style={{ fontSize: 10.5, color: '#2E7D55', marginTop: 4 }}>{redeemed.size} {t('pos.service')}{enPlural(redeemed.size > 1 ? 's' : '')} {t('pos.covered_by_membership_on_this_ticket')}</div>}
      {note && <div style={{ fontSize: 10.5, color: '#A33B3B', marginTop: 4 }}>{note}</div>}
    </div>
  );
}
