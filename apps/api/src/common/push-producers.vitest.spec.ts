// push-producers.vitest.spec.ts — BUILD_PLAN Phase 13 D (Constitution 6 §60–61, audit bug 9): EVERY push producer.
//
// A push is lock-screen text on a phone the user may have lent, lost or left on a counter. So:
//   1. every `dispatchToUser(` call in the backend is on the reviewed inventory below — a NEW producer fails this spec
//      until somebody has read its copy and added it here (the list is the whole set; it can only change on purpose);
//   2. every call passes a TYPED category (the per-app targeting + the tap route depend on it);
//   3. no call interpolates a person's name / phone / email into the message, nor passes a name-like identifier;
//   4. the copy each reviewed site builds out-of-line (a `title` / `body` variable) is named with why it is safe.
// Runtime proofs sit beside the producers that once pushed a customer name (queue-assignment-push.vitest.spec.ts) and
// at the choke point (push-targeting.vitest.spec.ts drops forbidden data keys whatever a producer writes).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PUSH_CATEGORY_NAMES } from '@aipowersalon/api-contracts';

const ROOT = join(__dirname, '../../../..');
const SCAN = ['modules', 'apps/api/src'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e) && !/\.(spec|test)\.ts$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}
/** The argument text of a call starting at `(`, to its matching paren (strings and template literals respected enough). */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}
interface Call { file: string; line: number; args: string }
function calls(): Call[] {
  const out: Call[] = [];
  for (const base of SCAN) for (const f of walk(join(ROOT, base))) {
    const src = readFileSync(f, 'utf8');
    const re = /\.dispatchToUser\(/g; let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      out.push({ file: relative(ROOT, f), line: src.slice(0, m.index).split('\n').length, args: argsAt(src, m.index + '.dispatchToUser'.length) });
    }
  }
  return out;
}

/** The reviewed inventory: file → number of call sites, and why the copy each site builds is safe. */
const REVIEWED: Record<string, { n: number; why: string; categoriesFromObjects?: true }> = {
  'apps/api/src/events/consumers/push-notification.consumer.ts': { n: 5, why: 'fixed copy "A guest is waiting for you" / "A guest has a service with you" (multi-technician lines, Oct 12 2026); appointment facts; skip-the-line bill ready to customer; checkout completed sends (payment received to owner/manager, tip received to tipped techs, receipt to customer)', categoriesFromObjects: true },
  'modules/checkout/src/checkout/checkout.service.ts': { n: 1, why: 'developer merge (Oct 12 2026): "Receipt saved / Receipt <number> is in your app" to the customer themselves — a receipt number, no amount, no name' },
  'modules/queue/src/queue/queue.service.ts': { n: 3, why: 'fixed copy (check-in ready; assignment — the name was removed, bug 9; the multi-technician plan pushes the same assignment copy to every line technician, Oct 12 2026)' },
  'modules/queue/src/tech-queue/tech-queue.service.ts': { n: 1, why: 'fixed copy (reassignment — the name was removed, bug 9)' },
  'modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.notifications.ts': { n: 1, why: 'notificationText(): alert type label + BRANCH name + the engine reason (type-based text, no customer field)' },
  'modules/ai/src/ai-scheduling-optimizer/ai-scheduling-proposals.ts': { n: 1, why: 'title/body built from the decision only ("Customer approved a new appointment time")' },
  'modules/booking/src/customer-booking/customer-booking.service.ts': { n: 2, why: 'to the customer themselves: service name, date, time' },
  'modules/safety/src/tenant-safety-community/community-fanout.ts': { n: 2, why: 'composeSafeMessage / composeChangeMessage: category + severity + link only (community-notify.ts)' },
  'modules/workforce/src/payroll/payroll.service.ts': { n: 1, why: 'fixed copy, no amounts' },
  'modules/workforce/src/payroll/payroll-workflow.service.ts': { n: 1, why: 'fixed copy (period paid), no amounts' },
  'modules/workforce/src/nail-showcase/nail-showcase-ranking.service.ts': { n: 1, why: 'rank numbers only, to the customer themselves' },
  'modules/workforce/src/nail-showcase/nail-showcase-social.service.ts': { n: 1, why: 'fixed copy — the follower name was removed from the push (stays in the in-app feed)' },
  'modules/workforce/src/nail-showcase/nail-showcase.service.ts': { n: 1, why: 'notify(): fixed titles; the comment text is replaced by "Open the app to read it."' },
  'apps/api/src/observability/alert-escalation.ts': { n: 1, why: 'Phase 14 C on-call page to a platform operator: the alert subject (platform alert title, no salon customer data) + "You are step N of the on-call chain"' },
  'modules/checkout/src/mobile-checkout/mobile-checkout.service.ts': { n: 1, why: 'Send to phone (Tap to Pay §150): fixed copy + ticket number, to the bound manager only; no customer, no amount' },
  'modules/communications/src/reminders/reminders.service.ts': { n: 1, why: 'salon name + start time, to the customer themselves' },
};

// a PERSON's name (a service or salon name is fine), a phone, an email, card digits
const PII_INTERPOLATION = /\$\{[^}]*(?:(?:customer|client|guest|full|first|last|display|technician|tech|follower|user|commenter|who)\??\.?[nN]ame|\b[pP]hone|\b[eE]mail|last4|cardNumber)[^}]*\}/;
const PII_IDENT = /\b(?:customerName|customer_name|fullName|full_name|firstName|lastName|displayName|followTitle|normalizedPhone|phoneNumber)\b/;

describe('every push producer (bug 9 / §61)', () => {
  const all = calls();

  it('finds the producers (the scan works)', () => { expect(all.length).toBeGreaterThanOrEqual(14); });

  it('every call site is on the reviewed inventory — a new producer is read before it ships', () => {
    const byFile: Record<string, number> = {};
    for (const c of all) byFile[c.file] = (byFile[c.file] ?? 0) + 1;
    const unreviewed = Object.entries(byFile).filter(([f, n]) => REVIEWED[f]?.n !== n).map(([f, n]) => `${f}: ${n} call(s) (reviewed: ${REVIEWED[f]?.n ?? 0})`);
    expect(unreviewed, 'review the new push copy for personal data, then add it to REVIEWED').toEqual([]);
    const gone = Object.keys(REVIEWED).filter((f) => !byFile[f]);
    expect(gone, 'a reviewed producer no longer exists — drop it from REVIEWED').toEqual([]);
  });

  it('every call passes a typed category (per-app targeting + the tap route)', () => {
    const bad: string[] = [];
    for (const c of all) {
      const m = /category:\s*'([A-Z_]+)'/.exec(c.args);
      if (m) { if (!(PUSH_CATEGORY_NAMES as string[]).includes(m[1])) bad.push(`${c.file}:${c.line}`); continue; }
      // A reviewed file may build its messages first and send them in a loop: then EVERY category literal in that file must
      // be a known category, and there must be at least one (the call itself passes the typed message through).
      if (REVIEWED[c.file]?.categoriesFromObjects) {
        const lits = [...readFileSync(join(ROOT, c.file), 'utf8').matchAll(/category:\s*'([A-Z_]+)'/g)].map((x) => x[1]);
        if (!lits.length || lits.some((l) => !(PUSH_CATEGORY_NAMES as string[]).includes(l))) bad.push(`${c.file}:${c.line}`);
        continue;
      }
      bad.push(`${c.file}:${c.line}`);
    }
    expect(bad).toEqual([]);
  });

  it('no call interpolates or passes a person’s name, phone or email', () => {
    const bad = all.filter((c) => PII_INTERPOLATION.test(c.args) || PII_IDENT.test(c.args)).map((c) => `${c.file}:${c.line}: ${c.args.replace(/\s+/g, ' ').slice(0, 160)}`);
    expect(bad).toEqual([]);
  });
});
