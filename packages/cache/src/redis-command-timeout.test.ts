// Phase 11 DR drill (redis-loss): with Redis down, a cached read waited 2–6 s per command (offline queue + retries) and a
// tenant-cache miss took > 10 s. Request/response commands now give up after REDIS_COMMAND_TIMEOUT_MS (500 ms) so the
// feature's own fallback runs; blocking / subscription commands are exempt (they legitimately wait).
import { describe, it, expect } from 'vitest';
import { withCommandTimeout, BLOCKING_COMMANDS } from './redis';

function fakeClient() {
  const sent: any[] = [];
  const client: any = {
    status: 'reconnecting',
    sendCommand(cmd: any) { sent.push(cmd); return cmd.promise; },   // never resolves — Redis is down
  };
  return { client, sent };
}
function cmd(name: string) {
  let reject!: (e: Error) => void; let resolve!: (v: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { name, promise, reject, resolve, setTimeout(ms: number) { setTimeout(() => reject(new Error('Command timed out')), ms); } };
}

describe('withCommandTimeout', () => {
  it('a request/response command rejects within the timeout instead of hanging', async () => {
    const { client } = fakeClient();
    withCommandTimeout(client, 50);
    const c = cmd('get'); client.sendCommand(c);
    const t0 = Date.now();
    await expect(c.promise).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('subscribe (and other blocking commands) are never timed out', async () => {
    const { client } = fakeClient();
    withCommandTimeout(client, 20);
    const c = cmd('subscribe'); client.sendCommand(c);
    const outcome = await Promise.race([c.promise.then(() => 'settled', () => 'rejected'), new Promise((r) => setTimeout(() => r('still pending'), 80))]);
    expect(outcome).toBe('still pending');
    expect(BLOCKING_COMMANDS.has('psubscribe')).toBe(true);
  });
  it('a command that answers in time resolves normally', async () => {
    const { client } = fakeClient();
    withCommandTimeout(client, 50);
    const c = cmd('set'); client.sendCommand(c); c.resolve('OK');
    await expect(c.promise).resolves.toBe('OK');
  });
});
