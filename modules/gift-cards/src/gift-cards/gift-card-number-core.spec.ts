// gift-card-number-core.spec.ts — Nest-free harness (esbuild + node, ok() style) for the 16-digit card number.
import { generateCardNumber, normalizeCardNumber, isValidCardNumber, formatCardNumber, maskCardNumber, lastFour, hashCardNumber, maskFromLast4 } from './gift-card-number-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

(async () => {
  // generation
  const a = generateCardNumber(), b = generateCardNumber();
  ok('generates exactly 16 digits', /^\d{16}$/.test(a));
  ok('first digit is 1-9 (full 16-digit number)', a[0] !== '0');
  ok('two generations differ (random, non-sequential)', a !== b);
  // spread across 200 generations: all 16 digits, all unique, none sequential-looking
  const seen = new Set<string>(); let allValid = true, anySeq = false;
  for (let i = 0; i < 200; i++) {
    const n = generateCardNumber(); if (!/^\d{16}$/.test(n)) allValid = false; seen.add(n);
    if (/0123456789|1234567890/.test(n)) anySeq = true;
  }
  ok('200 generations are all valid 16-digit', allValid);
  ok('200 generations are all unique', seen.size === 200);
  ok('no obviously sequential runs', !anySeq);

  // normalize / validate
  ok('normalize strips spaces', normalizeCardNumber('4827 1936 5502 8411') === '4827193655028411');
  ok('normalize strips dashes/letters', normalizeCardNumber('4827-1936-5502-8411x') === '4827193655028411');
  ok('valid accepts a spaced 16-digit', isValidCardNumber('4827 1936 5502 8411'));
  ok('valid rejects 15 digits', !isValidCardNumber('482719365502841'));
  ok('valid rejects 17 digits', !isValidCardNumber('48271936550284110'));
  ok('valid rejects empty', !isValidCardNumber(''));

  // format / mask
  ok('format groups into fours', formatCardNumber('4827193655028411') === '4827 1936 5502 8411');
  ok('mask reveals only the last four', maskCardNumber('4827193655028411') === '•••• •••• •••• 8411');
  ok('mask handles a spaced input', maskCardNumber('4827 1936 5502 8411') === '•••• •••• •••• 8411');
  ok('lastFour returns the last four', lastFour('4827193655028411') === '8411');

  // hashing (store/lookup without keeping the number at rest) + masked display from a stored last-4
  ok('hash is 64 hex chars (sha256)', /^[0-9a-f]{64}$/.test(hashCardNumber('4827193655028411')));
  ok('hash is deterministic', hashCardNumber('4827193655028411') === hashCardNumber('4827193655028411'));
  ok('hash ignores spacing (normalizes first)', hashCardNumber('4827 1936 5502 8411') === hashCardNumber('4827193655028411'));
  ok('different numbers hash differently', hashCardNumber('4827193655028411') !== hashCardNumber('4827193655028412'));
  ok('mask-from-last4 renders the stored last four', maskFromLast4('8411') === '•••• •••• •••• 8411');
  ok('mask-from-last4 is safe for a missing last4', maskFromLast4(null) === '•••• •••• •••• ••••');

  console.log(`\ngift-card-number-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
