import { describe, it, expect } from 'vitest';
import { buildCampaignCsv } from './SuperAdminCampaignsExport';
import type { McRow } from '../api/superAdminApi';

const row = (o: Partial<McRow> & { id: string; reference: string; name: string }): McRow => ({
  ownerType: 'tenant', tenantId: 't1', tenant: 'Glamour Studio', branch: 'Downtown', channel: 'email', audienceSize: 12841,
  deliveryRate: null, deliveryRateAvailable: false, openRate: 34.2, clickRate: 8.5, bookingConversions: 112, revenueCents: 248000,
  scheduledAt: null, status: 'completed', complianceStatus: null, complianceAvailable: false, ...o,
});

describe('buildCampaignCsv', () => {
  it('emits a header row and one line per campaign', () => {
    const csv = buildCampaignCsv([
      row({ id: 'p1', reference: 'CAMP-PLT-0001', name: "Mother's Day", ownerType: 'platform', tenant: 'All Tenants', branch: 'All Branches', revenueCents: 2845000 }),
      row({ id: 't1', reference: 'CAMP-TNT-10231', name: 'May Renewal' }),
    ], { generatedAt: '2026-05-06T00:00:00Z' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('AI PowerSalon — Campaign Report');
    expect(lines.some((l) => l.startsWith('Campaign ID,'))).toBe(true);
    expect(csv).toContain('CAMP-PLT-0001');
    expect(csv).toContain('28450.00'); // revenue in dollars
    expect(csv).toContain('NotConnected'); // delivery rate not available
  });

  it('neutralizes formula-injection attempts', () => {
    const csv = buildCampaignCsv([row({ id: 'x', reference: 'CAMP-TNT-1', name: '=HYPERLINK("http://evil")' })]);
    expect(csv).toContain("'=HYPERLINK"); // leading = neutralized with a quote
  });

  it('quotes cells containing commas', () => {
    const csv = buildCampaignCsv([row({ id: 'x', reference: 'CAMP-TNT-1', name: 'Spring, Summer & Fall' })]);
    expect(csv).toContain('"Spring, Summer & Fall"');
  });
});
