// export-artifact-store.ts — B-18 (Oct 22 2026): report and export FILES the control plane produces live in the PRIVATE
// object store (packages/media private-store: never a public URL; the API streams the bytes to the authorized person),
// and the row keeps the KEY. Before, three tables held whole files as base64 columns (scheduled report runs, billing
// export jobs, revenue export jobs) — the rows grew with every run and the files never reached object storage.
// The legacy columns are kept and still read for rows written before migration 677; nothing is removed or moved.
import type { PrivateObjectStore } from '@aipowersalon/media';
import { privateObjectKey } from '@aipowersalon/media';

/** DI token for the store (provided by the modules that export files; optional — without it the legacy column is written). */
export const PRIVATE_EXPORT_STORE = 'PRIVATE_EXPORT_STORE';
export type ExportArtifactStore = Pick<PrivateObjectStore, 'put' | 'get'>;

/** Store an export's bytes privately under `<env>/<namespace>/platform/<id>/<filename>`; answers the key. */
export async function stashExportBytes(store: ExportArtifactStore, namespace: string, id: string, filename: string, bytes: Buffer, contentType?: string): Promise<string> {
  const key = privateObjectKey(namespace, 'platform', id, filename);
  await store.put(key, bytes, contentType);
  return key;
}

/** The bytes of an export: the key's object when the row holds a key (null when the object is gone), else the legacy column. */
export async function loadExportBytes(store: ExportArtifactStore | null | undefined, key: string | null | undefined, legacy: { base64?: string | null; text?: string | null }): Promise<Buffer | null> {
  if (key) return store ? await store.get(key) : null;
  if (typeof legacy.base64 === 'string') return Buffer.from(legacy.base64, 'base64');
  if (typeof legacy.text === 'string') return Buffer.from(legacy.text, 'utf8');
  return null;
}
