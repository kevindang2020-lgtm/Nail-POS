// communications.dto.ts — types + pure logic for the unified inbox. Helpers are side-effect free and unit-tested:
// status/channel normalization, message-preview truncation, thread-list KPI roll-ups, and filtering.
export type CommChannel = 'sms' | 'email' | 'call';
export type CommDirection = 'inbound' | 'outbound';
export type ThreadStatus = 'open' | 'pending' | 'replied' | 'closed' | 'missed';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ThreadRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerContact: string | null;
  channel: CommChannel;
  subject: string | null;
  status: ThreadStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastDirection: CommDirection | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  tenantId: string;
  threadId: string;
  direction: CommDirection;
  channel: CommChannel;
  body: string;
  authorUserId: string | null;
  authorName: string | null;
  status: MessageStatus;
  createdAt: string;
}

export interface CreateThreadRequest {
  customerId?: string;
  customerName?: string;
  customerContact?: string;
  channel?: CommChannel;
  subject?: string;
  initialInbound?: string; // an inbound message that opens the thread
}

export interface ThreadFilters {
  status?: ThreadStatus;
  channel?: CommChannel;
  assignedTo?: string;
  unreadOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CommKpis {
  totalThreads: number;
  openConversations: number;
  unreadThreads: number;
  unreadMessages: number;
  repliedThreads: number;
  missedThreads: number;
}

const CHANNELS: CommChannel[] = ['sms', 'email', 'call'];
const STATUSES: ThreadStatus[] = ['open', 'pending', 'replied', 'closed', 'missed'];
const MSG_STATUSES: MessageStatus[] = ['sent', 'delivered', 'read', 'failed'];

export function normalizeCommChannel(v: unknown): CommChannel {
  return typeof v === 'string' && (CHANNELS as string[]).includes(v) ? (v as CommChannel) : 'sms';
}
export function normalizeThreadStatus(v: unknown): ThreadStatus {
  return typeof v === 'string' && (STATUSES as string[]).includes(v) ? (v as ThreadStatus) : 'open';
}
export function normalizeMessageStatus(v: unknown): MessageStatus {
  return typeof v === 'string' && (MSG_STATUSES as string[]).includes(v) ? (v as MessageStatus) : 'sent';
}

// One-line preview of a message body for the inbox list (collapses whitespace, truncates).
export function preview(body: string, max = 80): string {
  const flat = (body || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

// Inbox KPI roll-up across the thread list.
export function deriveCommKpis(rows: ThreadRow[]): CommKpis {
  return {
    totalThreads: rows.length,
    openConversations: rows.filter((r) => r.status === 'open' || r.status === 'pending').length,
    unreadThreads: rows.filter((r) => r.unreadCount > 0).length,
    unreadMessages: rows.reduce((a, r) => a + r.unreadCount, 0),
    repliedThreads: rows.filter((r) => r.status === 'replied').length,
    missedThreads: rows.filter((r) => r.status === 'missed').length,
  };
}

export function applyThreadFilters(rows: ThreadRow[], f: ThreadFilters): ThreadRow[] {
  let out = rows;
  if (f.status) out = out.filter((r) => r.status === f.status);
  if (f.channel) out = out.filter((r) => r.channel === f.channel);
  if (f.assignedTo) out = out.filter((r) => r.assignedTo === f.assignedTo);
  if (f.unreadOnly) out = out.filter((r) => r.unreadCount > 0);
  if (f.search) { const s = f.search.toLowerCase(); out = out.filter((r) =>
    [r.customerName, r.customerContact, r.subject, r.lastMessagePreview].some((x) => (x || '').toLowerCase().includes(s))); }
  return out;
}
