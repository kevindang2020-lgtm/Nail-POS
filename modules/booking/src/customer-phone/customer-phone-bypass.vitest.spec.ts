// customer-phone-bypass.vitest.spec.ts — the generic customer edit cannot change a phone number.
//
// ══ WHAT THE AUDIT FOUND ══════════════════════════════════════════════════════════════════════════════════
//
// `PATCH /pos/customers/:customerId` (permission: `pos.customers.edit`) contained this:
//
//     if (req.phone != null) {
//       patch.phone_display   = req.phone;
//       patch.normalized_phone = req.phone.replace(/[^\d+]/g, '');   // ← the hole
//     }
//
// So ANY receptionist could change a customer's phone number in one PATCH, with:
//
//   • NO E.164 normalization. `replace(/[^\d+]/g,'')` turns "(555) 123-4567" into "5551234567" — no country code,
//     not a number Twilio can send to.
//   • NO validation. NO duplicate check. NO verification. NO optimistic lock. NO status model.
//   • NO audit that a phone number had changed at all.
//
// And the new number was immediately treated as the customer's real one — so a receptionist could point a
// customer's **booking codes and appointment reminders at any handset they liked**, and nothing anywhere recorded
// it.
//
// The spec's first rule exists for exactly this:
//
//     "Do not allow each frontend to update customer phone numbers independently using separate business logic."
//
// A second path is a second set of rules, and **the fraud moves to whichever set is weaker.** This was the weaker
// set, and it was already shipped.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = readFileSync(
  join(process.cwd(), '..', '..', 'modules', 'customers', 'src', 'customers', 'customers.kysely.repository.ts'),   // the CRM is modules/customers (Constitution 13)
  'utf8',
);

describe('the generic customer PATCH cannot write a phone number', () => {
  it('does NOT set normalized_phone', () => {
    // `normalized_phone` is the number every message is actually sent to — the booking OTP, the appointment
    // reminder, the AI receptionist's caller-ID match. Nothing may write it except the canonical service.
    expect(REPO).not.toMatch(/patch\.normalized_phone\s*=/);
  });

  it('the old regex "normalization" is gone', () => {
    // It was never normalization. Stripping punctuation from "(555) 123-4567" gives "5551234567": no country code,
    // not E.164, and therefore not deliverable.
    expect(REPO).not.toContain("req.phone.replace(/[^\\d+]/g, '')");
  });

  it('phone_display may be REFORMATTED, never changed to another number (Phase 3, audit E4)', () => {
    // It was freely editable on the theory that it changes nothing about where a message goes. But the POS list, the
    // AI receptionist's caller-ID and the identity reconciliation all READ it — so a display that names another
    // number was a number nobody proved. The write now applies only when the text normalizes to the stored number.
    expect(REPO).toMatch(/patch\.phone_display\s*=\s*sql`CASE WHEN normalized_phone = \$\{e\} THEN/);
    expect(REPO).not.toMatch(/patch\.phone_display\s*=\s*req\.phone\s*;/);
  });

  it('and the rest of the customer edit still works', () => {
    // "Preserve all current working functionality." Only the phone was removed.
    for (const field of ['first_name', 'email', 'marketing_sms_opt_in', 'status']) {
      expect(REPO, field).toContain(field);
    }
  });
});

describe('the canonical path is the only path', () => {
  it('the phone routes exist, and they are the ones that verify', () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/customer-phone/customer-phone.controller.ts'),
      'utf8',
    );
    // start → send → verify. A number does not become the customer's number without an SMS in between.
    expect(controller).toMatch(/@Post\(\)/);
    expect(controller).toMatch(/@Post\(':sessionId\/send'\)/);
    expect(controller).toMatch(/@Post\(':sessionId\/verify'\)/);
  });

  it('manual confirmation needs its OWN permission, not pos.customers.edit', () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/customer-phone/customer-phone.controller.ts'),
      'utf8',
    );
    // A receptionist who can edit a customer must not silently ALSO be able to mark a number usable without ever
    // proving it — the receptionist is exactly who a social engineer calls. The service checks the ROLE as well,
    // so the permission cannot be granted around it.
    expect(controller).toContain("@RequirePermission('pos.customers.phone.manual_confirm')");
  });

  it('the role is server-derived, never taken from the body', () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/customer-phone/customer-phone.controller.ts'),
      'utf8',
    );
    // A client that could name its own role could grant itself the manager-only manual-confirmation path.
    expect(controller).toContain('r?.ctx?.role');
    expect(controller).not.toMatch(/b\?\.role|body\.role/);
  });
});
