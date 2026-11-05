// Repository port for IP block rules + allowlist. In-memory mirrors the contract; Kysely writes to ip_block_rules and
// records a security audit event on block/unblock.
export interface IpBlockRow { id: string; target: string; blockKind: string; ipVersion: number; isAllowlist: boolean; threatType: string | null; source: string | null; reason: string | null; country: string | null; status: string; blockedAt: string | null; expiresAt: string | null }
export interface InsertBlockInput { target: string; blockKind: string; ipVersion: number; threatType: string | null; source: string | null; reason: string | null; country: string | null; tenantId: string | null; expiresAt: string | null }
export interface BlockActor { userId: string | null; role: string | null; name: string | null; ip: string | null }

export interface IpBlockRepositoryPort {
  findActiveBlock(target: string): Promise<IpBlockRow | null>;
  insertBlock(input: InsertBlockInput, actor: BlockActor): Promise<IpBlockRow>;
  listBlocks(limit: number): Promise<IpBlockRow[]>;
  getBlock(id: string): Promise<IpBlockRow | null>;
  setStatus(id: string, status: string, actor: BlockActor): Promise<IpBlockRow | null>;
  countActiveBlocks(): Promise<number>;
  blockedToday(): Promise<number>;
  allowlistExact(): Promise<string[]>;
  allowlistCidrs(): Promise<string[]>;
  addAllowlist(target: string, kind: string, reason: string | null, actor: BlockActor): Promise<IpBlockRow>;
}

export class InMemoryIpBlockRepository implements IpBlockRepositoryPort {
  rows: IpBlockRow[] = []; audits: any[] = []; private seq = 1;
  async findActiveBlock(target: string) { return this.rows.find((r) => r.target === target && !r.isAllowlist && r.status === 'blocked') || null; }
  async insertBlock(i: InsertBlockInput, actor: BlockActor) {
    const existing = await this.findActiveBlock(i.target); if (existing) return existing;
    const row: IpBlockRow = { id: `ip${this.seq++}`, target: i.target, blockKind: i.blockKind, ipVersion: i.ipVersion, isAllowlist: false, threatType: i.threatType, source: i.source, reason: i.reason, country: i.country, status: 'blocked', blockedAt: new Date().toISOString(), expiresAt: i.expiresAt };
    this.rows.push(row); this.audits.push({ module: 'security', action: 'ip_blocked', actor: actor.userId, target: i.target, threatType: i.threatType }); return row;
  }
  async listBlocks(limit: number) { return this.rows.filter((r) => !r.isAllowlist).slice(0, limit); }
  async getBlock(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async setStatus(id: string, status: string, actor: BlockActor) { const r = this.rows.find((x) => x.id === id); if (!r) return null; r.status = status; this.audits.push({ module: 'security', action: 'ip_unblocked', actor: actor.userId, target: r.target, status }); return r; }
  async countActiveBlocks() { return this.rows.filter((r) => !r.isAllowlist && r.status === 'blocked').length; }
  async blockedToday() { return this.rows.filter((r) => !r.isAllowlist).length; }
  async allowlistExact() { return this.rows.filter((r) => r.isAllowlist && r.blockKind === 'exact').map((r) => r.target); }
  async allowlistCidrs() { return this.rows.filter((r) => r.isAllowlist && r.blockKind === 'cidr').map((r) => r.target); }
  async addAllowlist(target: string, kind: string, reason: string | null, actor: BlockActor) { const row: IpBlockRow = { id: `al${this.seq++}`, target, blockKind: kind, ipVersion: target.includes(':') ? 6 : 4, isAllowlist: true, threatType: null, source: 'allowlist', reason, country: null, status: 'whitelisted', blockedAt: new Date().toISOString(), expiresAt: null }; this.rows.push(row); this.audits.push({ module: 'security', action: 'allowlist_changed', actor: actor.userId, target }); return row; }
}
