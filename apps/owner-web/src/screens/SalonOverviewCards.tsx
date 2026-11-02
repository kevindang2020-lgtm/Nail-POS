import type { OwnerSalonOverview } from '../api/ownerApi';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// SalonOverviewCards — the "All My Salons" picker strip: one card per assigned salon showing today's revenue and
// appointments, with a tap target that switches the whole app to that salon. Pure/presentational so it renders the
// same per-salon snapshot the backend returns (restricted to the owner's assigned salons) and is easy to test.

const money = (cents: number) => formatCurrency(cents, { fractionDigits: 0 });

export function SalonOverviewCards({ salons, onPick }: { salons: OwnerSalonOverview[]; onPick: (branchId: string) => void }) {
  if (salons.length === 0) return null;
  return (
    <section className="owner-salongrid" aria-label="Your salons">
      <div className="owner-sechead"><div className="h">Your Salons</div><div className="d">Today · tap to open</div></div>
      <div className="owner-saloncards">
        {salons.map((s) => {
          const where = [s.city, s.state].filter(Boolean).join(', ');
          const open = s.status === 'active';
          return (
            <button key={s.branchId} className="owner-saloncard" onClick={() => onPick(s.branchId)} aria-label={`Open ${s.salonName}`}>
              <div className="top">
                <div className="nm">{s.salonName}</div>
                <span className={'dotstatus ' + (open ? 'on' : 'off')}>{open ? 'Open' : 'Closed'}</span>
              </div>
              {where ? <div className="loc">{where}</div> : null}
              <div className="mets">
                <div className="met"><div className="v">{money(s.todayRevenueCents)}</div><div className="l">Revenue</div></div>
                <div className="met"><div className="v">{s.todayBookings}</div><div className="l">Appts</div></div>
                <div className="met"><div className="v">{s.activeTechs}</div><div className="l">Techs</div></div>
                <div className="met"><div className="v">{s.waitingGuests}</div><div className="l">Waiting</div></div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
