/**
 * support-tickets-core.spec.ts — pure, DB-free rules for the support ticket system: input validation
 * (subject required, category/priority normalized), the §20 critical-priority clamp for non-privileged
 * roles, role-based visibility scoping (§21/§38), and ticket-number formatting. The SQL writes/reads are
 * exercised against live Postgres.
 */
import { sanitizeTicketInput, clampPriorityForRole, canSeeAllTenantTickets, canTriageTickets, isValidTransition, nextStatuses, buildTicketNotification, slaTargetForPriority, computeSla, summarizeTicketRows, ticketsToCsv, formatTicketNumber, isValidPriority, isValidCategory } from './support-tickets.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== input validation ==');
  check('subject required', sanitizeTicketInput({ subject: '   ' }).ok === false);
  const s = sanitizeTicketInput({ subject: 'Card terminal offline', category: 'nonsense', priority: 'bogus' });
  check('valid input ok', s.ok === true);
  check('unknown category → general', s.value?.category === 'general');
  check('unknown priority → normal', s.value?.priority === 'normal');
  check('valid category kept', sanitizeTicketInput({ subject: 'x', category: 'payment' }).value?.category === 'payment');

  console.log('\n== §20 critical-priority clamp ==');
  // BUILD_PLAN Phase 9: principals carry their permissions; the salon's ticket administrators hold help.triage
  const P = (role: string, permissions: string[] = []) => ({ role, permissions });
  const OWNER_P = P('OWNER', ['help.triage', 'settings.edit']), MANAGER_P = P('MANAGER', ['help.triage', 'settings.view']);
  const TECH_P = P('TECHNICIAN', ['tech.dashboard.view']), DESK_P = P('RECEPTION', ['checkin.view']);
  const tech = clampPriorityForRole('critical', TECH_P);
  check('non-privileged critical → urgent + review', tech.priority === 'urgent' && tech.needsReview === true);
  const owner = clampPriorityForRole('critical', OWNER_P);
  check('owner may file critical', owner.priority === 'critical' && owner.needsReview === false);
  check('normal priority untouched', clampPriorityForRole('high', TECH_P).priority === 'high');

  console.log('\n== visibility scoping ==');
  check('owner sees all tenant tickets', canSeeAllTenantTickets(OWNER_P) === true);
  check('manager sees all tenant tickets', canSeeAllTenantTickets(MANAGER_P) === true);
  check('technician does not', canSeeAllTenantTickets(TECH_P) === false);
  check('receptionist does not', canSeeAllTenantTickets(DESK_P) === false);
  check('Phase 9: an OWNER-role session without help.triage (DENIED) does not — no role shortcut', canSeeAllTenantTickets(P('OWNER', [])) === false && canTriageTickets(P('OWNER', [])) === false);
  check('Phase 9: platform support (Super Admin) still triages', canTriageTickets(P('SUPER_ADMIN', [])) === true);

  console.log('\n== misc ==');
  check('ticket number formatted', /^SUP-[A-Z0-9]{6}$/.test(formatTicketNumber('abc123xyz')));
  check('priority validator', isValidPriority('urgent') && !isValidPriority('whenever'));
  check('category validator', isValidCategory('refund') && !isValidCategory('refundz'));

  console.log('\n== triage permissions + transitions ==');
  check('owner can triage', canTriageTickets(OWNER_P) === true);
  check('technician cannot triage', canTriageTickets(TECH_P) === false);
  check('open → in_progress allowed', isValidTransition('open', 'in_progress') === true);
  check('open → closed not allowed', isValidTransition('open', 'closed') === false);
  check('resolved → closed allowed', isValidTransition('resolved', 'closed') === true);
  check('closed → reopened allowed', isValidTransition('closed', 'reopened') === true);
  check('no-op transition rejected', isValidTransition('open', 'open') === false);
  check('invalid target rejected', isValidTransition('open', 'bogus') === false);
  check('nextStatuses from resolved', nextStatuses('resolved').includes('closed') && nextStatuses('resolved').includes('reopened'));

  console.log('\n== triager notification compose ==');
  const n1 = buildTicketNotification('SUP-ABC123', 'resolved');
  check('defaults to email', n1.channel === 'email');
  check('default body mentions status + ticket', /resolved/.test(n1.body) && /SUP-ABC123/.test(n1.body));
  check('subject carries ticket number', n1.subject.includes('SUP-ABC123'));
  const n2 = buildTicketNotification('SUP-1', 'open', 'sms', 'Custom message');
  check('sms channel honored', n2.channel === 'sms');
  check('custom body honored', n2.body === 'Custom message');
  check('invalid channel → email', buildTicketNotification('SUP-2', 'open', 'carrier_pigeon').channel === 'email');

  console.log('\n== SLA first-response ==');
  check('urgent target 60m', slaTargetForPriority('urgent') === 60);
  check('unknown priority → normal target', slaTargetForPriority('zzz') === slaTargetForPriority('normal'));
  const base = Date.parse('2026-06-26T00:00:00Z');
  const onTrack = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: null, status: 'open', now: base + 10 * 60000 });
  check('within target → on_track', onTrack.state === 'on_track' && onTrack.breached === false);
  const dueSoon = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: null, status: 'open', now: base + 50 * 60000 });
  check('near target → due_soon', dueSoon.state === 'due_soon');
  const breached = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: null, status: 'open', now: base + 90 * 60000 });
  check('past target, no reply → breached', breached.state === 'breached' && breached.breached === true);
  const respondedOnTime = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: '2026-06-26T00:30:00Z', status: 'in_progress', now: base + 200 * 60000 });
  check('agent replied on time → responded, not breached', respondedOnTime.state === 'responded' && respondedOnTime.breached === false);
  const respondedLate = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: '2026-06-26T02:00:00Z', status: 'in_progress', now: base + 200 * 60000 });
  check('agent replied late → responded + breached', respondedLate.responded === true && respondedLate.breached === true);
  const paused = computeSla({ createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: null, status: 'closed', now: base + 999 * 60000 });
  check('terminal, no reply → paused (no breach)', paused.state === 'paused' && paused.breached === false);

  console.log('\n== queue summary ==');
  const now = Date.parse('2026-06-26T03:00:00Z');
  const stats = summarizeTicketRows([
    { status: 'open', priority: 'urgent', assignedAgent: null, createdAt: '2026-06-26T00:00:00Z', targetMinutes: 60, firstAgentResponseAt: null }, // open, unassigned, awaiting, breached
    { status: 'in_progress', priority: 'normal', assignedAgent: 'Mia', createdAt: '2026-06-26T02:55:00Z', targetMinutes: 480, firstAgentResponseAt: '2026-06-26T02:58:00Z' }, // open, assigned, responded
    { status: 'resolved', priority: 'low', assignedAgent: 'Mia', createdAt: '2026-06-25T00:00:00Z', targetMinutes: 1440, firstAgentResponseAt: '2026-06-25T01:00:00Z' }, // terminal
  ], now);
  check('total counts all', stats.total === 3);
  check('open excludes terminal', stats.open === 2);
  check('unassigned counts only open + no agent', stats.unassigned === 1);
  check('awaiting first response = open + no agent reply', stats.awaitingFirstResponse === 1);
  check('breached matches SLA state', stats.breached === 1);
  check('byStatus tallies', stats.byStatus.open === 1 && stats.byStatus.in_progress === 1 && stats.byStatus.resolved === 1);
  check('byPriority tallies', stats.byPriority.urgent === 1 && stats.byPriority.normal === 1);

  console.log('\n== CSV export ==');
  const sla = { targetMinutes: 60, dueAt: null, firstResponseAt: null, responded: false, breached: true, minutesRemaining: -10, state: 'breached' as const };
  const csv = ticketsToCsv([
    { id: '1', ticketNumber: 'SUP-1', subject: 'Plain subject', category: 'payment', priority: 'high', status: 'open', needsReview: false, createdAt: '2026-06-26T00:00:00Z', updatedAt: '2026-06-26T00:00:00Z', sla },
    { id: '2', ticketNumber: 'SUP-2', subject: 'Has, comma and "quote"', category: 'bug', priority: 'low', status: 'resolved', needsReview: false, createdAt: null, updatedAt: null, sla },
  ]);
  const rows = csv.split('\r\n');
  check('header present', rows[0] === 'Ticket,Subject,Category,Priority,Status,SLA,Created,Updated');
  check('plain row unquoted', rows[1].includes('SUP-1,Plain subject,payment,high,open,breached,'));
  check('comma+quote field escaped', rows[2].includes('"Has, comma and ""quote"""'));
  check('row per ticket + header', rows.length === 3);

  console.log('\nsupport-tickets-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
