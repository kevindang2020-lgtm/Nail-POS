// customer-registration-core.spec.ts — Nest-free harness for CustomerRegistrationService.register(): the field validation
// (salon code, name, email shape, password length), input normalization (trim + lowercased email), validation precedence,
// and delegation of a valid request to the repo. A fake repo records the cleaned input it receives. esbuild + node.
import { CustomerRegistrationService } from './customer-registration.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

function makeRepo(result: any = { ok: true }) {
  const seen: any[] = [];
  return { seen, async register(input: any) { seen.push(input); return result; } };
}
const VALID = { salonCode: 'ABC123', firstName: 'Jane', lastName: 'Doe', email: 'jane@salon.com', phone: '5551234', password: 'longenough' };

(async () => {
  // ---- field validation (each returns ok:false with a specific message) ----
  // Oct 3 2026: the customer CHOOSES a salon (from the list / nearby → salonId) or enters a code — one of the two is required
  ok('a salon (picked or by code) is required', (await new CustomerRegistrationService(makeRepo() as any).register({ ...VALID, salonCode: '  ' })).message === 'Choose your salon.');
  { const repo = makeRepo(); await new CustomerRegistrationService(repo as any).register({ ...VALID, salonCode: undefined, salonId: 'b7600000-0000-4000-8000-0000000000b1' } as any);
    ok('a picked salon (salonId) is passed to the repository', repo.seen[0]?.salonId === 'b7600000-0000-4000-8000-0000000000b1' && repo.seen[0]?.salonCode === undefined); }
  ok('first and last name are required', (await new CustomerRegistrationService(makeRepo() as any).register({ ...VALID, firstName: '' })).message === 'Enter your first and last name.' && (await new CustomerRegistrationService(makeRepo() as any).register({ ...VALID, lastName: '' })).message === 'Enter your first and last name.');
  ok('a malformed email is rejected', (await new CustomerRegistrationService(makeRepo() as any).register({ ...VALID, email: 'not-an-email' })).ok === false);
  ok('a too-short password is rejected', (await new CustomerRegistrationService(makeRepo() as any).register({ ...VALID, password: 'short' })).message === 'Password must be at least 8 characters.');

  // ---- precedence: with everything blank, the salon-code error surfaces first ----
  ok('validation precedence checks the salon first', (await new CustomerRegistrationService(makeRepo() as any).register({} as any)).message === 'Choose your salon.');

  // ---- valid request: delegated to the repo, result passed through ----
  {
    const repo = makeRepo({ ok: true });
    const r = await new CustomerRegistrationService(repo as any).register({ ...VALID });
    ok('a valid registration is delegated to the repo', r.ok === true && repo.seen.length === 1);
  }
  {
    const repo = makeRepo({ ok: false, message: 'Salon code not found.' });
    const r = await new CustomerRegistrationService(repo as any).register({ ...VALID });
    ok('the repo result is passed straight through', r.ok === false && r.message === 'Salon code not found.');
  }

  // ---- normalization: fields trimmed, email lowercased; phone is optional ----
  {
    const repo = makeRepo();
    await new CustomerRegistrationService(repo as any).register({ salonCode: '  ABC  ', firstName: '  Jane  ', lastName: '  Doe  ', email: '  JANE@Salon.COM  ', phone: '  555  ', password: 'longenough' });
    const inp = repo.seen[0];
    ok('inputs are trimmed and the email is lowercased', inp.salonCode === 'ABC' && inp.firstName === 'Jane' && inp.lastName === 'Doe' && inp.email === 'jane@salon.com' && inp.phone === '555');
  }
  {
    const repo = makeRepo();
    const r = await new CustomerRegistrationService(repo as any).register({ ...VALID, phone: '' });
    ok('phone is optional (empty phone still registers)', r.ok === true && repo.seen[0].phone === '');
  }

  console.log(`\ncustomer-registration-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
