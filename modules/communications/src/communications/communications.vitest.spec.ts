import { AuditService, InMemoryAuditRepository } from '@aipowersalon/audit';
import { describe, it, expect } from 'vitest';
import { InMemoryCommunicationsRepository } from './communications.repository';
import { CommunicationsService, ValidationError, ForbiddenError, NotFoundError } from './communications.service';
import { normalizeThreadStatus, normalizeCommChannel, preview, deriveCommKpis, applyThreadFilters, type ThreadRow } from './communications.dto';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'MANAGER', userName: 'Jess', permissions: ['pos.communications.view', 'pos.communications.send', 'pos.communications.manage'] };
const ctxB = { tenantId: 't_B', branchId: 'b9', userId: 'u9', role: 'OWNER', userName: 'Bob', permissions: ['pos.communications.view', 'pos.communications.send', 'pos.communications.manage'] };
const viewer = { tenantId: 't_A', branchId: 'b1', userId: 'u2', role: 'TECH', userName: 'V', permissions: ['pos.communications.view'] };

const newSvc = (audit?: AuditService) => new CommunicationsService(new InMemoryCommunicationsRepository(), audit);

const tRow = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 't', tenantId: 't', branchId: null, customerId: null, customerName: 'Olivia', customerContact: '555', channel: 'sms', subject: null,
  status: 'open', assignedTo: null, assignedToName: null, unreadCount: 1, lastMessageAt: '2026-06-01T00:00:00Z', lastMessagePreview: 'hi', lastDirection: 'inbound',
  createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z', ...over,
});

describe('communications pure logic', () => {
  it('normalizers + preview truncation', () => {
    expect(normalizeThreadStatus('replied')).toBe('replied');
    expect(normalizeThreadStatus('bogus')).toBe('open');
    expect(normalizeCommChannel('email')).toBe('email');
    expect(normalizeCommChannel('pigeon')).toBe('sms');
    expect(preview('  hello   world  ')).toBe('hello world');
    expect(preview('x'.repeat(200)).endsWith('…')).toBe(true);
    expect(preview('x'.repeat(200)).length).toBe(80);
  });
  it('deriveCommKpis + filters', () => {
    const rows = [tRow({ id: '1', status: 'open', unreadCount: 2 }), tRow({ id: '2', status: 'replied', unreadCount: 0 }), tRow({ id: '3', status: 'missed', unreadCount: 1, channel: 'call' })];
    const k = deriveCommKpis(rows);
    expect(k.totalThreads).toBe(3);
    expect(k.openConversations).toBe(1);
    expect(k.unreadThreads).toBe(2);
    expect(k.unreadMessages).toBe(3);
    expect(k.repliedThreads).toBe(1);
    expect(k.missedThreads).toBe(1);
    expect(applyThreadFilters(rows, { channel: 'call' })).toHaveLength(1);
    expect(applyThreadFilters(rows, { unreadOnly: true })).toHaveLength(2);
    expect(applyThreadFilters(rows, { status: 'replied' })[0].id).toBe('2');
  });
});

describe('CommunicationsService', () => {
  it('opens a thread with an inbound message (unread bumps) and lists it in the inbox', async () => {
    const svc = newSvc();
    const t = await svc.createThread(ctx as any, { customerName: 'Olivia', customerContact: '555', channel: 'sms', initialInbound: 'Can I book a gel mani?' });
    expect(t.unreadCount).toBe(1);
    expect(t.lastDirection).toBe('inbound');
    const inbox = await svc.getInbox(ctx as any, {});
    expect(inbox.threads).toHaveLength(1);
    expect(inbox.kpis.unreadThreads).toBe(1);
    const detail = await svc.getThread(ctx as any, t.id);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].direction).toBe('inbound');
  });

  it('reply appends an outbound message, flips status to replied, and clears unread', async () => {
    const svc = newSvc();
    const t = await svc.createThread(ctx as any, { customerName: 'Olivia', initialInbound: 'Hi' });
    await expect(svc.reply(ctx as any, t.id, '   ')).rejects.toBeInstanceOf(ValidationError);
    const detail = await svc.reply(ctx as any, t.id, 'Yes! We have 2pm open.');
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1].direction).toBe('outbound');
    expect(detail.messages[1].authorName).toBe('Jess');
    expect(detail.thread.status).toBe('replied');
    expect(detail.thread.unreadCount).toBe(0);
  });

  it('mark read, assign and status transitions', async () => {
    const svc = newSvc();
    const t = await svc.createThread(ctx as any, { customerName: 'A', initialInbound: 'hi' });
    expect((await svc.markRead(ctx as any, t.id)).unreadCount).toBe(0);
    expect((await svc.assign(ctx as any, t.id, 'u5', 'Emma')).assignedToName).toBe('Emma');
    expect((await svc.setStatus(ctx as any, t.id, 'closed')).status).toBe('closed');
  });

  it('isolates tenants and gates writes behind the send/manage permissions', async () => {
    const svc = newSvc();
    const a = await svc.createThread(ctx as any, { customerName: 'A', initialInbound: 'hi' });
    await svc.createThread(ctxB as any, { customerName: 'B', initialInbound: 'hi' });
    expect((await svc.getInbox(ctx as any, {})).threads).toHaveLength(1);
    await expect(svc.getThread(ctxB as any, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.reply(viewer as any, a.id, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.assign(viewer as any, a.id, 'u', 'n')).rejects.toBeInstanceOf(ForbiddenError);
    const plat = await svc.getPlatformInbox({});
    expect(plat.threads).toHaveLength(2);
  });

  it('writes durable, tenant-scoped audit events on reply/assign', async () => {
    const audit = new AuditService(new InMemoryAuditRepository());
    const svc = newSvc(audit);
    const t = await svc.createThread(ctx as any, { customerName: 'A', initialInbound: 'hi' });
    await svc.reply(ctx as any, t.id, 'hello');
    await svc.assign(ctx as any, t.id, 'u5', 'Emma');
    const page = await audit.list('t_A', {});
    expect(page.items.some((r) => r.module === 'communications' && r.action === 'thread.replied')).toBe(true);
    expect(page.items.some((r) => r.module === 'communications' && r.action === 'thread.assigned')).toBe(true);
    expect((await audit.list('t_B', {})).pagination.totalItems).toBe(0);
  });
});
