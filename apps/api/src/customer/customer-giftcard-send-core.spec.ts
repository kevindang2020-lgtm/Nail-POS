// customer-giftcard-send-core.spec.ts — Nest-free harness for sendGiftCard / claimGiftCard orchestration (send-to-friend
// §10). A partial fake CustomerDataPort supplies just the methods these flows touch.
import { CustomerService } from './customer.service';
import { hashClaimToken } from '@aipowersalon/gift-cards';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsInvalid(name: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(name, false); } catch { ok(name, true); }
}

const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'CUSTOMER', permissions: [] };
const fakeRepo = (over: any = {}) => ({
  resolveCustomerId: async () => 'cust-sender',
  giftCardForTransfer: async () => ({ id: 'gc1', status: 'active', balanceCents: 5000 }),
  createGiftCardClaim: async () => ({ senderName: 'Dana' }),
  recordGiftCardDelivery: async () => {},
  findGiftCardClaimByHash: async () => null,
  claimGiftCardTransfer: async () => ({ ok: true, reference: 'GC-****-1234', balanceCents: 5000, senderName: 'Dana' }),
  reportGiftCardLost: async () => ({ ok: false, reason: 'not_found' }),
  ...over,
}) as any;
const svc = (over: any = {}) => new CustomerService(fakeRepo(over));

(async () => {
  // send: mints a token, stores only its hash
  {
    let saved: any = null;
    const s = svc({ createGiftCardClaim: async (_c: any, a: any) => { saved = a; return { senderName: 'Sam' }; } });
    const res = await s.sendGiftCard(ctx, 'gc1', { name: 'Sam', phone: '+15551234567', message: 'Happy birthday!' });
    ok('send returns a claim token', typeof res.claimToken === 'string' && res.claimToken.length > 10);
    ok('send returns an expiry', typeof res.expiresAt === 'string' && !Number.isNaN(Date.parse(res.expiresAt)));
    ok('send stores a hash, never the raw token', !!saved && saved.tokenHash !== res.claimToken);
    ok('stored hash matches the issued token', saved.tokenHash === hashClaimToken(res.claimToken));
    ok('send records the sender id for provenance', saved.senderCustomerId === 'cust-sender');
  }

  await throwsInvalid('send rejects a card the sender doesn\u2019t own', () => svc({ giftCardForTransfer: async () => null }).sendGiftCard(ctx, 'gcX', { phone: '+15551234567' }));
  await throwsInvalid('send rejects a zero-balance card', () => svc({ giftCardForTransfer: async () => ({ id: 'gc1', status: 'active', balanceCents: 0 }) }).sendGiftCard(ctx, 'gc1', { phone: '+15551234567' }));
  await throwsInvalid('send rejects a voided card', () => svc({ giftCardForTransfer: async () => ({ id: 'gc1', status: 'void', balanceCents: 5000 }) }).sendGiftCard(ctx, 'gc1', { phone: '+15551234567' }));
  await throwsInvalid('send requires a recipient phone or email', () => svc().sendGiftCard(ctx, 'gc1', { message: 'hi' }));
  await throwsInvalid('send rejects a malformed email', () => svc().sendGiftCard(ctx, 'gc1', { email: 'not-an-email' }));

  // delivery: with a base URL + an SMS provider, the claim link is texted to the recipient (§10)
  {
    const prev = process.env.PUBLIC_CUSTOMER_BASE_URL;
    process.env.PUBLIC_CUSTOMER_BASE_URL = 'https://app.example.com';
    const sent: any[] = []; const deliveries: any[] = [];
    const repo = fakeRepo({ createGiftCardClaim: async () => ({ senderName: 'Dana' }), recordGiftCardDelivery: async (_c: any, d: any) => { deliveries.push(d); } });
    const mockSms = { send: async (to: string, b: string) => { sent.push({ to, body: b }); return { sid: 'SM-1' }; } };
    const res = await new CustomerService(repo, mockSms as any).sendGiftCard(ctx, 'gc1', { phone: '+15551234567' });
    ok('delivery: returns the claim url', res.claimUrl === 'https://app.example.com/gift-cards/claim?token=' + encodeURIComponent(res.claimToken));
    ok('delivery: texts the recipient once', sent.length === 1 && sent[0].to === '+15551234567');
    ok('delivery: the SMS carries the claim link', sent.length === 1 && res.claimUrl !== null && sent[0].body.includes(res.claimUrl));
    ok('delivery: the SMS never leaks a raw 16-digit number', !/\d{16}/.test(sent[0]?.body || ''));
    ok('delivery: reports sms sent', !!res.delivery && res.delivery.channel === 'sms' && res.delivery.status === 'sent');
    ok('delivery: records a sent delivery', deliveries.length === 1 && deliveries[0].status === 'sent' && deliveries[0].channel === 'sms');

    // a failed SMS is best-effort: it's recorded as failed but the send still succeeds and returns the shareable link
    const deliveries2: any[] = [];
    const failingSms = { send: async () => { throw new Error('boom'); } };
    const res2 = await new CustomerService(fakeRepo({ createGiftCardClaim: async () => ({ senderName: null }), recordGiftCardDelivery: async (_c: any, d: any) => { deliveries2.push(d); } }), failingSms as any).sendGiftCard(ctx, 'gc1', { phone: '+15551234567' });
    ok('delivery: a failed SMS still returns the link', typeof res2.claimToken === 'string' && res2.claimUrl !== null);
    ok('delivery: a failed SMS is recorded failed', deliveries2.length === 1 && deliveries2[0].status === 'failed');
    ok('delivery: reports sms failed', !!res2.delivery && res2.delivery.status === 'failed');

    // email delivery: with a base URL + an email provider, the claim link is emailed to the recipient
    const emails: any[] = []; const deliveries3: any[] = [];
    const mockEmail = { send: async (to: string, subject: string, b: string) => { emails.push({ to, subject, body: b }); return { id: 'EM-1' }; } };
    const res3 = await new CustomerService(fakeRepo({ createGiftCardClaim: async () => ({ senderName: 'Dana' }), recordGiftCardDelivery: async (_c: any, d: any) => { deliveries3.push(d); } }), undefined, undefined, mockEmail as any).sendGiftCard(ctx, 'gc1', { email: 'friend@example.com' });
    ok('delivery: emails the recipient once', emails.length === 1 && emails[0].to === 'friend@example.com');
    ok('delivery: the email carries the claim link', emails.length === 1 && res3.claimUrl !== null && emails[0].body.includes(res3.claimUrl));
    ok('delivery: the email never leaks a raw 16-digit number', !/\d{16}/.test(emails[0]?.body || ''));
    ok('delivery: reports email sent', !!res3.delivery && res3.delivery.channel === 'email' && res3.delivery.status === 'sent');
    ok('delivery: records a sent email delivery', deliveries3.length === 1 && deliveries3[0].channel === 'email' && deliveries3[0].status === 'sent');

    // a failed email is best-effort: recorded failed, send still succeeds
    const deliveries3b: any[] = [];
    const res3b = await new CustomerService(fakeRepo({ recordGiftCardDelivery: async (_c: any, d: any) => { deliveries3b.push(d); } }), undefined, undefined, { send: async () => { throw new Error('smtp down'); } } as any).sendGiftCard(ctx, 'gc1', { email: 'friend@example.com' });
    ok('delivery: a failed email still returns the link', typeof res3b.claimToken === 'string' && res3b.claimUrl !== null);
    ok('delivery: a failed email is recorded failed', deliveries3b.length === 1 && deliveries3b[0].channel === 'email' && deliveries3b[0].status === 'failed');

    // email with no base URL configured: nothing to link, recorded pending for manual sharing
    process.env.PUBLIC_CUSTOMER_BASE_URL = '';
    const deliveries4: any[] = [];
    const res4 = await new CustomerService(fakeRepo({ recordGiftCardDelivery: async (_c: any, d: any) => { deliveries4.push(d); } })).sendGiftCard(ctx, 'gc1', { email: 'friend@example.com' });
    ok('delivery: email with no base url is pending', deliveries4.length === 1 && deliveries4[0].status === 'pending' && res4.claimUrl === null);
    process.env.PUBLIC_CUSTOMER_BASE_URL = 'https://app.example.com';
    process.env.PUBLIC_CUSTOMER_BASE_URL = prev;
  }

  // audit: send and claim each record a gift_card event (best-effort, never blocks the operation)
  {
    const noopSms = { send: async () => ({ sid: 'noop' }) };
    const sentEvents: any[] = [];
    const auditSent = { record: (_c: any, e: any) => { sentEvents.push(e); return Promise.resolve(null); } };
    await new CustomerService(fakeRepo({ createGiftCardClaim: async () => ({ senderName: 'Dana' }) }), noopSms as any, auditSent as any).sendGiftCard(ctx, 'gc1', { phone: '+15551234567' });
    ok('send records a gift_card.sent audit event', sentEvents.some((e) => e.module === 'gift_card' && e.action === 'sent' && e.resourceId === 'gc1'));

    const claimEvents: any[] = [];
    const auditClaim = { record: (_c: any, e: any) => { claimEvents.push(e); return Promise.resolve(null); } };
    const liveClaim2 = { id: 'clm1', giftCardId: 'gcX', claimedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await new CustomerService(fakeRepo({ findGiftCardClaimByHash: async () => liveClaim2 }), noopSms as any, auditClaim as any).claimGiftCard(ctx, 'tok');
    ok('claim records a gift_card.claimed audit event', claimEvents.some((e) => e.module === 'gift_card' && e.action === 'claimed' && e.resourceId === 'gcX'));

    // a failed/invalid claim records nothing
    const noEvents: any[] = [];
    const auditNone = { record: (_c: any, e: any) => { noEvents.push(e); return Promise.resolve(null); } };
    await new CustomerService(fakeRepo({ findGiftCardClaimByHash: async () => null }), noopSms as any, auditNone as any).claimGiftCard(ctx, 'tok');
    ok('an unclaimable link records no audit event', noEvents.length === 0);
  }

  // claim: transfers the card and returns a safe summary
  const liveClaim = { id: 'clm1', giftCardId: 'gc1', claimedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  {
    const res = await svc({ findGiftCardClaimByHash: async () => liveClaim }).claimGiftCard(ctx, 'sometoken');
    ok('claim succeeds and returns the card', res.ok === true && res.reference === 'GC-****-1234' && res.balanceCents === 5000);
    ok('claim surfaces who sent it', res.senderName === 'Dana');
  }
  ok('claim of an unknown token is not_found', (await svc().claimGiftCard(ctx, 'x')).reason === 'not_found');
  ok('claim of an expired token is rejected', (await svc({ findGiftCardClaimByHash: async () => ({ ...liveClaim, expiresAt: new Date(Date.now() - 60_000).toISOString() }) }).claimGiftCard(ctx, 'x')).reason === 'expired');
  ok('claim of an already-claimed token is rejected', (await svc({ findGiftCardClaimByHash: async () => ({ ...liveClaim, claimedAt: new Date().toISOString() }) }).claimGiftCard(ctx, 'x')).reason === 'claimed');
  ok('a lost single-use race returns unavailable', (await svc({ findGiftCardClaimByHash: async () => liveClaim, claimGiftCardTransfer: async () => ({ ok: false }) }).claimGiftCard(ctx, 'x')).reason === 'unavailable');

  // report lost/stolen (§22): freezes an owned card via the repo; rejections surface faithfully
  ok('report-lost succeeds for an owned card', (await svc({ reportGiftCardLost: async () => ({ ok: true }) }).reportLostGiftCard(ctx, 'gc1')).ok === true);
  ok('report-lost surfaces a not-owned rejection', (await svc({ reportGiftCardLost: async () => ({ ok: false, reason: 'not_found' }) }).reportLostGiftCard(ctx, 'gcX')).reason === 'not_found');
  ok('report-lost surfaces an already-frozen rejection', (await svc({ reportGiftCardLost: async () => ({ ok: false, reason: 'not_freezable' }) }).reportLostGiftCard(ctx, 'gc1')).reason === 'not_freezable');

  console.log(`\ncustomer-giftcard-send-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
