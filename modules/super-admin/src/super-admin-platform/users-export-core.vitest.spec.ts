// users-export-core.vitest.spec.ts — the export shaping must render honestly (gaps → —/Never) and must neutralize
// CSV formula injection (a name like "=cmd()" cannot execute when the file is opened in a spreadsheet).
import { describe, it, expect } from 'vitest';
import { USERS_EXPORT_HEADERS, userExportRow, usersExportCsv, usersExportFilename } from './users-export-core';

describe('userExportRow', () => {
  it('renders a complete user across the reference columns', () => {
    const row = userExportRow({ fullName: 'Mia Nguyen', email: 'mia@salon.com', role: 'MANAGER', tenantName: 'Glamour Studio', branchName: 'Cherry Hill', status: 'active', permissionLevel: 'Branch Admin', mfaEnabled: true, lastLoginAt: '2026-06-01T12:00:00Z', assignedDevices: 2 });
    expect(row).toEqual(['Mia Nguyen', 'mia@salon.com', 'MANAGER', 'Glamour Studio', 'Cherry Hill', 'active', 'Branch Admin', 'Enabled', '2026-06-01T12:00:00.000Z', 2]);
  });
  it('renders gaps honestly (— / Never / Disabled), never fabricated', () => {
    const row = userExportRow({ role: 'TECHNICIAN', status: 'invited' });
    expect(row[0]).toBe('—');           // no name
    expect(row[3]).toBe('—');           // no tenant
    expect(row[7]).toBe('Disabled');    // mfa off
    expect(row[8]).toBe('Never');       // never logged in
    expect(row[9]).toBe(0);             // no devices
  });
});

describe('usersExportCsv', () => {
  it('emits the header row then one line per user', () => {
    const csv = usersExportCsv([{ fullName: 'A', email: 'a@x.com', role: 'OWNER' }, { fullName: 'B', email: 'b@x.com', role: 'TECHNICIAN' }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(USERS_EXPORT_HEADERS.join(','));
    expect(lines).toHaveLength(3);
  });
  it('neutralizes formula injection in a malicious display name', () => {
    const csv = usersExportCsv([{ fullName: '=2+5+cmd|calc', email: 'x@x.com', role: 'OWNER' }]);
    expect(csv).toContain("'=2+5+cmd|calc");   // leading apostrophe defuses the formula
    expect(csv).not.toMatch(/\n=2\+5/);
  });
});

describe('usersExportFilename', () => {
  it('is date-stamped and .csv', () => {
    expect(usersExportFilename(new Date('2026-06-30T09:00:00Z'))).toBe('users-export-2026-06-30.csv');
  });
});
