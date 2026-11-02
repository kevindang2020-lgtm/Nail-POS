// Review request language. Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans — so the request and its subject are English for a customer marked Vietnamese too.
import { describe, it, expect } from 'vitest';
import { reviewRequestBody, CommunicationsDispatchAdapter } from './ai-review-reputation.integrations';

describe('review request in the customer\'s language', () => {
  it('English for every customer, with and without a link — a customer marked Vietnamese too', () => {
    expect(reviewRequestBody('Luxe', 'https://r')).toBe("Thanks for visiting Luxe! We'd love your honest feedback. Share a review here: https://r");
    expect(reviewRequestBody('Luxe', 'https://r', 'vi')).toBe(reviewRequestBody('Luxe', 'https://r'));
    expect(reviewRequestBody('', null, 'vi')).toBe("Thanks for visiting! We'd love your honest feedback. Reply to let us know how we did.");
  });
  it('the dispatch adapter sends English whatever the stored language (and a failed read is harmless)', async () => {
    const sent: Array<{ subject?: string; body?: string }> = [];
    const comm = { async createThread(_c: unknown, r: { subject?: string }) { sent.push({ subject: r.subject }); return { id: 't' }; }, async reply(_c: unknown, _t: string, body: string) { sent[sent.length - 1].body = body; } };
    const ctx = { tenantId: 't1', branchId: null, userId: 'u', role: 'OWNER', permissions: [] } as any;
    await new CommunicationsDispatchAdapter(comm, { brandName: 'Luxe', languageOf: async () => 'vi' }).send(ctx, { customerId: 'c1', appointmentId: null, channel: 'sms' });
    await new CommunicationsDispatchAdapter(comm, { brandName: 'Luxe', languageOf: async () => { throw new Error('db down'); } }).send(ctx, { customerId: 'c1', appointmentId: null, channel: 'sms' });
    expect(sent[0]).toEqual({ subject: 'How was your visit?', body: expect.stringMatching(/^Thanks for visiting Luxe!/) });
    expect(sent[1]).toEqual({ subject: 'How was your visit?', body: expect.stringMatching(/^Thanks for visiting Luxe!/) });
  });
});
