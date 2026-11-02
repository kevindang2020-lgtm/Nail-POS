// fixtures.mjs — Checkout one-screen datasets (tooling only). Shapes follow the API contracts the POS reads
// (GET /pos/checkout/state, /pos/checkout/tickets/:id, …). Money is integer cents. States (mandate §74, §79):
//   empty   no ticket, no payment            normal  8 ready tickets, a quiet day
//   busy    40 ready, 10 active attempts, 3 UNKNOWN, cash/card splits, gift redemption, Tap to Pay, discounts,
//           multi-technician tickets, receipt sends, 200 technicians
//   unknown the selected ticket has a card attempt whose answer was lost (Verify Payment)
//   split   the selected ticket is mid split tender ($50 cash + $50 card)
//   tech200 normal board with the 200-technician staff list
//   big     a selected ticket with 24 service lines (§75: overlay, not a growing page)
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao', 'Uyen', 'Vy', 'Wendy', 'Xuan', 'Yen', 'Zoe'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez', 'Brown', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas-Washington'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo'];
const SVC = [['Gel Manicure', 4500], ['Spa Pedicure', 5500], ['Acrylic Full Set', 6500], ['Dip Powder', 5000], ['Nail Art (2 nails)', 1500], ['Gel Removal', 1000], ['Deluxe Pedicure', 7500], ['French Tip Add-on', 1000]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

function ticket(n, o = {}) {
  const lines = o.lines ?? [SVC[n % SVC.length], ...(n % 3 === 0 ? [SVC[(n + 4) % SVC.length]] : [])];
  const sub = lines.reduce((a, l) => a + l[1], 0); const disc = o.discountCents ?? (n % 7 === 0 ? 500 : 0); const tip = o.tipCents ?? Math.round((sub - disc) * 0.18);
  const tax = 0; const total = sub - disc + tip + tax;
  return {
    row: { ticketId: id(1000 + n), ticketNumber: String(2040 + n), customerName: `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`, customerPhone: `(856) 555-${String(1000 + n).slice(-4)}`, isVip: n % 11 === 0, station: n % 2 ? 'Front Desk 1' : 'Front Desk 2', serviceCount: lines.length, finishedAt: iso(3 + n * 2), completedAt: iso(3 + n * 2), subtotalCents: sub - disc, tipCents: tip, discountCents: disc, totalDueCents: total, status: o.status ?? (n % 9 === 4 ? 'waiting_payment' : 'ready_for_payment'), primaryTechnicianName: TECH[n % TECH.length], servicesLabel: lines[0][0] + (lines.length > 1 ? ` +${lines.length - 1}` : '') },
    detail: {
      ticketId: id(1000 + n), ticketNumber: String(2040 + n),
      customer: { customerId: id(5000 + n), fullName: `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`, isVip: n % 11 === 0, phone: `(856) 555-${String(1000 + n).slice(-4)}`, email: n % 2 ? `guest${n}@example.com` : undefined, loyaltyPoints: 120 + n * 7, visitCount: 3 + (n % 12), preferredTechName: TECH[n % TECH.length] },
      stationLabel: 'Front Desk 1',
      completedServices: lines.map((l, k) => ({ serviceLineId: `${id(1000 + n)}-l${k}`, serviceName: l[0], category: k ? 'Add-on' : 'Nails', technicianName: o.multiTech && k ? TECH[(n + 3) % TECH.length] : TECH[n % TECH.length], priceCents: l[1], qty: 1 })),
      discounts: disc ? [{ id: 'd1', kind: 'manual', label: 'Manager discount', amountCents: disc }] : [],
      commission: null,
      totals: { subtotalCents: sub - disc, tipCents: tip, taxCents: tax, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: total, paymentMethod: o.method ?? 'card', discountCents: disc },
      status: o.status ?? 'ready_for_payment', receiptDeliveryOptions: { sms: true, email: n % 2 === 1, app: true, print: false },
      // the server's tenders (checkout.service withTenders): a split ticket has its first tender in
      ...(o.method === 'split' ? { tenders: [{ paymentId: id(8000 + n), method: 'cash', amountCents: 2000, tipCents: 0, status: 'approved', createdAt: new Date().toISOString(), last4: null }], paidCents: 2000, balanceCents: Math.max(0, total - 2000) } : { tenders: [], paidCents: 0, balanceCents: total }),
    },
  };
}

function board(name) {
  const count = { empty: 0, normal: 8, busy: 40, unknown: 8, split: 8, tech200: 8, big: 8 }[name] ?? 8;
  const ts = Array.from({ length: count }, (_, n) => ticket(n, n === 0 && name === 'split' ? { method: 'split', status: 'split' } : n === 0 && name === 'big' ? { lines: Array.from({ length: 24 }, (_, k) => SVC[k % SVC.length]), multiTech: true } : n % 5 === 2 ? { multiTech: true } : {}));
  const busy = name === 'busy';
  const nTech = busy || name === 'tech200' ? 200 : 10;
  const staffAll = Array.from({ length: nTech }, (_, k) => ({ technicianId: id(5000 + k), name: k < TECH.length ? TECH[k] : `Technician ${k + 1}`, nextAvailable: k % 4 === 0 ? 'Now' : '—', status: k % 4 === 0 ? 'Ready' : k % 4 === 3 ? 'Break' : 'Busy' }));
  const attention = [];
  if (name === 'unknown' || busy) for (let k = 0; k < (busy ? 3 : 1); k++) attention.push({ type: 'Payment Unknown', label: 'Payment Unknown', guest: ts[k].row.customerName, issue: 'Payment status uncertain (card) — do not charge again. Verify Payment.', time: '10:4' + k + ' AM', ticketId: ts[k].row.ticketId, severity: 'danger' });
  if (busy) for (let k = 3; k < 10; k++) attention.push({ type: 'Payment Processing', label: 'Payment Processing', guest: ts[k].row.customerName, issue: k % 3 ? 'Payment in progress (card) — wait for the answer' : 'Payment in progress (Tap to Pay) — wait for the answer', time: '10:5' + (k % 10) + ' AM', ticketId: ts[k].row.ticketId, severity: 'warn' });
  if (busy) attention.push({ type: 'Failed Receipt', label: 'Failed Receipt', guest: 'Rosa Garcia-Thomas-Washington', issue: 'Receipt not delivered by sms (failed) — the payment stands; resend', time: '10:31 AM', ticketId: id(1999), severity: 'warn' }, { type: 'Refund Uncertain', label: 'Refund Uncertain', guest: 'Hana Le', issue: 'Refund answer lost — verify with the processor before retrying', time: '9:58 AM', ticketId: id(1998), severity: 'danger' });
  if (name === 'split' || busy) attention.push({ type: 'Split Payment', label: 'Split Payment', guest: ts[0].row.customerName, issue: 'Awaiting next payment', time: '10:12 AM', ticketId: ts[0].row.ticketId, severity: 'info' });
  const paid = name === 'empty' ? 0 : busy ? 63 : 12;
  return {
    ts,
    state: {
      kpisFull: { ticketsReadyForPayment: count, subtotalCents: ts.reduce((a, t) => a + t.row.subtotalCents, 0), tipsTodayCents: paid * 1210, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: paid, failedPaymentsToday: busy ? 2 : 0, pendingPaymentsToday: busy ? 13 : name === 'unknown' ? 1 : 0, receiptDeliveryEligible: paid, customerDisplayActiveSessions: 1, receiptDeliveryRatePercent: paid ? (busy ? 94 : 100) : 0, averageCheckoutSeconds: paid ? 214 : 0, giftCardLoyaltyRedemptionsCents: busy ? 18500 : paid ? 2500 : 0, upsellCapturePercent: paid ? 27 : 0 },
      kpiTrends: paid ? { guestsReady: { deltaPercent: 12, direction: 'up' }, revenue: { deltaPercent: 8, direction: 'up' }, avgTime: { deltaPercent: 5, direction: 'down' } } : {},
      analytics: { paymentMix: paid ? [{ method: 'card', count: paid - 9, amountCents: (paid - 9) * 6800 }, { method: 'cash', count: 6, amountCents: 6 * 5200 }, { method: 'gift_card', count: 3, amountCents: 3 * 4000 }] : [], revenueTrend: paid ? [9, 10, 11, 12, 13, 14].map((h, k) => ({ hour: h, amountCents: (k + 2) * 21000 })) : [], upsellMix: paid ? [{ category: 'Add-on', sharePercent: 61 }, { category: 'Retail', sharePercent: 39 }] : [], conversionPercent: paid ? Math.round((paid / (paid + count)) * 1000) / 10 : null, revenueTodayCents: paid * 6400, revenueTrendDeltaPercent: paid ? 8 : null, potentialRevenue: { totalCents: ts.reduce((a, t) => a + t.row.totalDueCents, 0), servicesCents: ts.reduce((a, t) => a + t.row.subtotalCents, 0), retailCents: 0, tipsEstCents: ts.reduce((a, t) => a + t.row.tipCents, 0), ticketCount: count } },
      attention,
      // as the server answers since the staff cap (checkout.dto capStaffRows): Ready first, 8 rows + counts for everyone
      staff: [...staffAll].sort((a, b) => (a.status === 'Ready' ? 0 : 1) - (b.status === 'Ready' ? 0 : 1)).slice(0, 8),
      staffSummary: { shown: Math.min(8, staffAll.length), total: staffAll.length, ready: staffAll.filter((s) => s.status === 'Ready').length, busy: staffAll.filter((s) => s.status === 'Busy').length, onBreak: staffAll.filter((s) => s.status === 'Break').length },
      insights: [],
      tickets: { items: ts.map((t) => t.row), pagination: { page: 1, pageSize: 100, totalItems: count, totalPages: 1 } },
      paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 0, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'dedicated', fiservStatus: 'connected' },
      customerDisplay: { pairedDevices: [{ deviceId: 'disp1', label: 'Display 1', stationCode: '', paired: true }], activeSession: null },
      filters: { statuses: ['ready_for_payment', 'payment_in_progress', 'paid', 'failed', 'on_hold'], stations: ['Front Desk 1', 'Front Desk 2'], technicians: TECH, paymentMethods: ['card', 'cash', 'gift_card', 'split'] },
    },
  };
}

export function dataset(name) {
  const b = board(name);
  const byId = new Map(b.ts.map((t) => [t.row.ticketId, t]));
  return {
    route(method, path, q, _body, env = {}) {
      if (method === 'GET' && path === '/pos/checkout/state') return b.state;
      // the POS shell (sidebar, top bar) — the same shapes the repo's own shell tests use
      if (path === '/tenant/navigation') return { role: 'MANAGER', permissions: env.perms ?? [], features: [], aiPackages: [], subscriptionStatus: 'active', salonName: 'Pilot Nail Salon' };
      if (path === '/tenant/navigation/badges') return {};
      if (path === '/tenant/system-status') return { status: 'operational', components: [] };
      if (path === '/auth/branches') return [{ id: env.branchId, name: 'Main', isActive: true, city: 'Cherry Hill' }];
      if (path === '/auth/lock-status') return { locked: false };
      if (path === '/pos/platform-announcements/active' || path === '/tech/manager-messages' || path === '/community/alerts/active' || path === '/tenant/ai/packages') return [];
      if (path === '/community/settings') return {};
      if (path === '/client-telemetry/events') return { ok: true };
      if (/^\/pos\/checkout\/tickets\/[^/]+\/offers$/.test(path)) return { offers: [], applied: [] };
      let m;
      if ((m = /^\/pos\/checkout\/tickets\/([^/]+)$/.exec(path)) && method === 'GET') { const t = byId.get(m[1]); return t ? t.detail : { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND' } } }; }
      if ((m = /^\/pos\/checkout\/tickets\/([^/]+)\/unsettled-tenders$/.exec(path))) {
        const first = b.ts[0]?.row.ticketId;
        if (name === 'unknown' && m[1] === first) return [{ kind: 'payment', id: id(9001), method: 'card', status: 'processing', amountCents: b.ts[0].row.totalDueCents, createdAt: new Date(Date.now() - 180000).toISOString() }];
        if (name === 'split' && m[1] === first) return [];
        return [];
      }
      if ((m = /^\/pos\/checkout\/tickets\/([^/]+)\/apply-deal$/.exec(path))) return { applied: false, reason: 'No deal reserved' };
      if ((m = /^\/pos\/checkout\/tickets\/([^/]+)\/recalculate$/.exec(path)) && method === 'POST') { const t = byId.get(m[1]); return t ? { ...t.detail.totals, paymentMethod: _body?.paymentMethod ?? 'card' } : { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND' } } }; }
      if (/^\/pos\/checkout\/tickets\/[^/]+\/membership-coverage/.test(path) || /membership/.test(path)) return { eligible: false, covered: [], items: [] };
      if (path.startsWith('/pos/customer-display')) return path.endsWith('/state') || path.endsWith('/displays') ? { stations: [{ id: 'reg1', name: 'Front Desk 1' }], displays: [{ deviceId: 'disp1', label: 'Display 1', online: true, maintenance: false, stationId: null, state: 'idle' }], register: 'reg1' } : {};
      if (path.startsWith('/pos/mobile-checkout') || path.startsWith('/mobile-checkout')) return { claim: null, devices: [], attempts: [], items: [] };
      if (path.startsWith('/pos/ai-checkout-upsell')) return { suggestions: [], items: [], enabled: false };
      if (path.startsWith('/pos/shell') || path.startsWith('/pos/nav') || path.startsWith('/pos/me')) return {};
      return undefined;
    },
  };
}
