// product-usage-core.spec.ts — Nest-free assertions for the technician product-usage math: quantities in hundredths, what
// a bottle still holds, the order bottles are used in, shortfalls, and how a correction gives stock back.
import { parseQuantity, formatQuantity, allowsFraction, remainingOf, stockHundredths, consumptionOrder, allocate, planRestore, restoredStatus, type BottleRow } from './product-usage-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const B = (id: string, status: BottleRow['status'], remainingPercent: number | null, createdAt: string): BottleRow => ({ id, status, remainingPercent, createdAt });

// ---- quantities ----
ok('0.5 → 50', parseQuantity('0.5') === 50);
ok('1 → 100', parseQuantity(1) === 100);
ok('0.25 → 25', parseQuantity('0.25') === 25);
ok('2.75 → 275', parseQuantity('2.75') === 275);
ok('0 refused', parseQuantity('0') === null);
ok('negative refused', parseQuantity('-1') === null);
ok('three decimals refused', parseQuantity('0.125') === null);
ok('text refused', parseQuantity('abc') === null && parseQuantity('') === null && parseQuantity(null) === null);
ok('format 50 → 0.5', formatQuantity(50) === '0.5');
ok('format 125 → 1.25', formatQuantity(125) === '1.25');
ok('format 200 → 2', formatQuantity(200) === '2');
ok('format -50 → -0.5', formatQuantity(-50) === '-0.5');
ok('pieces are whole only', !allowsFraction('piece') && !allowsFraction('Pairs') && allowsFraction('bottle') && allowsFraction('ml') && allowsFraction(null));

// ---- what a bottle holds ----
ok('sealed = 100', remainingOf({ status: 'unopened', remainingPercent: null }) === 100);
ok('opened, no estimate = 100', remainingOf({ status: 'opened', remainingPercent: null }) === 100);
ok('opened at 40 % = 40', remainingOf({ status: 'opened', remainingPercent: 40 }) === 40);
ok('low, no estimate = 25', remainingOf({ status: 'low', remainingPercent: null }) === 25);
ok('empty = 0', remainingOf({ status: 'empty', remainingPercent: 80 }) === 0);
ok('sold = 0', remainingOf({ status: 'sold', remainingPercent: null }) === 0);

const shelf = [B('s1', 'unopened', null, '2026-10-01'), B('s2', 'unopened', null, '2026-09-01'), B('o1', 'opened', 60, '2026-10-02'), B('o2', 'opened', 30, '2026-10-03'), B('l1', 'low', null, '2026-10-04'), B('e1', 'empty', null, '2026-08-01')];
ok('stock = 100+100+60+30+25', stockHundredths(shelf) === 315);

// ---- order ----
ok('low → opened (least first) → sealed (oldest first); empty skipped', consumptionOrder(shelf).map((b) => b.id).join() === 'l1,o2,o1,s2,s1');
ok('a named bottle goes first', consumptionOrder(shelf, 's1').map((b) => b.id).join() === 's1,l1,o2,o1,s2');

// ---- allocation ----
const half = allocate(shelf, 50);
ok('0.5 takes the low bottle (25) and 25 of the 30 % bottle', half.takes.length === 2 && half.takes[0].unitId === 'l1' && half.takes[0].takenHundredths === 25 && half.takes[0].toStatus === 'empty' && half.takes[1].unitId === 'o2' && half.takes[1].takenHundredths === 25 && half.takes[1].remainingAfter === 5 && half.short === 0);
const sealedOnly = allocate([B('s1', 'unopened', null, '2026-10-01')], 50);
ok('using half of a sealed bottle opens it at 50', sealedOnly.takes[0].toStatus === 'opened' && sealedOnly.takes[0].remainingAfter === 50);
const whole = allocate([B('s1', 'unopened', null, '2026-10-01')], 100);
ok('using all of a sealed bottle empties it', whole.takes[0].toStatus === 'empty' && whole.short === 0);
const over = allocate(shelf, 400);
ok('more than the shelf holds → short 85, every usable bottle emptied', over.short === 85 && over.takes.length === 5 && over.takes.every((t) => t.toStatus === 'empty'));
ok('nothing on the shelf → all short', allocate([], 50).short === 50);

// ---- corrections ----
const r1 = planRestore(half.takes, 0, {}, 30);
ok('giving back 0.3 restores the latest take first (o2: 25) then l1: 5', r1.fromShort === 0 && r1.restores.length === 2 && r1.restores[0].unitId === 'o2' && r1.restores[0].hundredths === 25 && r1.restores[1].unitId === 'l1' && r1.restores[1].hundredths === 5 && r1.uncovered === 0);
const r2 = planRestore(half.takes, 0, { o2: 25, l1: 5 }, 30);
ok('a second correction only gives what is still owed (l1: 20), the rest is uncovered', r2.restores.length === 1 && r2.restores[0].unitId === 'l1' && r2.restores[0].hundredths === 20 && r2.uncovered === 10);
const r3 = planRestore(over.takes, 85, {}, 100);
ok('a shortfall is given back first, never as stock', r3.fromShort === 85 && r3.restores[0].hundredths === 15);
ok('an emptied bottle becomes usable again', restoredStatus('empty', 0, 25, false)?.status === 'opened' && restoredStatus('empty', 0, 25, false)?.remaining === 25);
ok('a sealed bottle made whole again is sealed again', restoredStatus('opened', 50, 50, true)?.status === 'unopened');
ok('an opened bottle made whole stays opened if it was not sealed before', restoredStatus('opened', 50, 50, false)?.status === 'opened');
ok('a sold bottle cannot take stock back', restoredStatus('sold', 0, 50, false) === null);

console.log(`product-usage-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
