// employment-history-import.vitest.spec.ts — pure pins for Technician Profile §128 (history mapping) and §112/§113
// (import parsing: never matched by name, one person per row).
import { describe, it, expect } from 'vitest';
import { lifecycleEventType, branchDiff, employmentEventLabel } from './employment-history';
import { parseTechnicianCsv, validateImportRows, splitCsvLine, IMPORT_MAX_ROWS } from './technician-import-core';

describe('§128 lifecycle → employment history type', () => {
  it('maps real changes and ignores no-ops', () => {
    expect(lifecycleEventType('active', 'suspended')).toBe('suspended');
    expect(lifecycleEventType('suspended', 'suspended')).toBeNull();
    expect(lifecycleEventType('active', 'archived')).toBe('terminated');
    expect(lifecycleEventType('active', 'inactive')).toBe('terminated');
    expect(lifecycleEventType('archived', 'inactive')).toBeNull();
    expect(lifecycleEventType('suspended', 'active')).toBe('reactivated');
    expect(lifecycleEventType('active', 'active')).toBeNull();
    expect(lifecycleEventType(null, 'active')).toBeNull();
  });
  it('branch diff is a set difference', () => {
    expect(branchDiff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(branchDiff([], [])).toEqual({ added: [], removed: [] });
  });
  it('labels', () => { expect(employmentEventLabel('transferred')).toBe('Transferred out'); expect(employmentEventLabel('leave')).toBe('Leave'); });
});

describe('§112 import parsing', () => {
  it('splits quoted CSV', () => { expect(splitCsvLine('"Pham, Mia",x,"a ""q"""')).toEqual(['Pham, Mia', 'x', 'a "q"']); });
  it('requires name columns and an identity-key column', () => {
    expect(parseTechnicianCsv('').error).toMatch(/empty/);
    expect(parseTechnicianCsv('First Name,Last Name\nA,B').error).toMatch(/Phone or an Email/);
    expect(parseTechnicianCsv('Phone,Email\n1,2').error).toMatch(/First Name and Last Name/);
    const ok = parseTechnicianCsv('First Name,Last Name,Phone,Email,Role\nMia,Pham,856-555-0101,,Manager\n');
    expect(ok.error).toBeUndefined();
    expect(ok.rows[0]).toMatchObject({ firstName: 'Mia', lastName: 'Pham', phone: '856-555-0101', roleLabel: 'Manager', __line: '2' });
  });
  it('refuses a row with no phone/email — never matched by name (§113)', () => {
    const v = validateImportRows([{ __line: '2', firstName: 'Mia', lastName: 'Pham' }]);
    expect(v.valid).toHaveLength(0);
    expect(v.invalid[0].error).toMatch(/never matched by name/);
  });
  it('refuses the same person twice in one file (phone normalised, email case-insensitive)', () => {
    const v = validateImportRows([
      { __line: '2', firstName: 'Mia', lastName: 'Pham', phone: '(856) 555-0101' },
      { __line: '3', firstName: 'Mia', lastName: 'P', phone: '+1 856 555 0101' },
      { __line: '4', firstName: 'Ann', lastName: 'Le', email: 'Ann@X.com' },
      { __line: '5', firstName: 'Ann', lastName: 'Le', email: 'ann@x.com' },
      { __line: '6', firstName: 'Mia', lastName: 'Pham', email: 'other@x.com' },   // same NAME, different key → a different person
    ]);
    expect(v.valid.map((r) => r.line)).toEqual([2, 4, 6]);
    expect(v.invalid.map((r) => r.line)).toEqual([3, 5]);
  });
  it('rejects malformed keys and caps the file', () => {
    expect(validateImportRows([{ __line: '2', firstName: 'A', lastName: 'B', email: 'nope' }]).invalid[0].error).toMatch(/Email/);
    expect(validateImportRows([{ __line: '2', firstName: 'A', lastName: 'B', phone: '12345' }]).invalid[0].error).toMatch(/Phone/);
    const many = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `A${i},B,856555${String(i).padStart(4, '0')},`).join('\n');
    expect(parseTechnicianCsv(`First Name,Last Name,Phone,Email\n${many}`).error).toMatch(/At most/);
  });
});
