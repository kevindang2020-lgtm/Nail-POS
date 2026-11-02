// storage-telemetry-wiring.test — BUILD_PLAN Phase 14 B: the factories every caller uses hand out INSTRUMENTED stores, so
// no call site can write an object the storage dashboard does not see.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageOps, storageBytes, isInstrumentedStore } from '@aipowersalon/observability';
import { makeMediaStorage, LocalDiskMediaStorage, makeSupportAttachmentStorage } from './media-storage';
import { makePrivateStore } from './private-store';

const n = (labels: Record<string, string>, m: any = storageOps) =>
  (m.snapshot().find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0) as number;

describe('factories return instrumented stores', () => {
  it("makeMediaStorage → store 'media' (still a LocalDiskMediaStorage)", async () => {
    const root = mkdtempSync(join(tmpdir(), 'media-tel-'));
    try {
      const st = makeMediaStorage({ MEDIA_ROOT: root } as any);
      expect(isInstrumentedStore(st)).toBe(true);
      expect(st).toBeInstanceOf(LocalDiskMediaStorage);
      // the env passed in decides the root (not process.env / the cwd) — else this test writes into the package dir
      expect((st as LocalDiskMediaStorage).root).toBe(root);
      const before = n({ store: 'media', op: 'put', outcome: 'ok' });
      const w0 = n({ store: 'media', direction: 'written' }, storageBytes);
      await st.put('t1/avatars/a.png', Buffer.alloc(10));
      expect(n({ store: 'media', op: 'put', outcome: 'ok' })).toBe(before + 1);
      expect(n({ store: 'media', direction: 'written' }, storageBytes)).toBe(w0 + 10);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("makePrivateStore → store 'private'; get counts bytes read", async () => {
    const root = mkdtempSync(join(tmpdir(), 'priv-tel-'));
    try {
      const st = makePrivateStore({ PRIVATE_FILES_ROOT: root } as any);
      expect(isInstrumentedStore(st)).toBe(true);
      expect(st.kind).toBe('local');
      await st.put('development/exports/platform/x/a.csv', Buffer.from('abc'));
      const r0 = n({ store: 'private', direction: 'read' }, storageBytes);
      expect((await st.get('development/exports/platform/x/a.csv'))?.toString()).toBe('abc');
      expect(n({ store: 'private', direction: 'read' }, storageBytes)).toBe(r0 + 3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("makeSupportAttachmentStorage → store 'support_attachments', local disk under SUPPORT_ATTACHMENTS_ROOT", async () => {
    const root = mkdtempSync(join(tmpdir(), 'sup-tel-'));
    try {
      const st = makeSupportAttachmentStorage({ SUPPORT_ATTACHMENTS_ROOT: root } as any);
      expect(isInstrumentedStore(st)).toBe(true);
      expect((st as LocalDiskMediaStorage).root).toBe(root);
      const before = n({ store: 'support_attachments', op: 'put', outcome: 'ok' });
      await st.put('t/a.pdf', Buffer.alloc(1));
      expect(n({ store: 'support_attachments', op: 'put', outcome: 'ok' })).toBe(before + 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
