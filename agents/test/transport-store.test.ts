import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFileDispatchStore } from '../file-store.ts';
import { createSeatHttpTransport, DispatchError } from '../index.ts';
import type { DispatchRecord, SeatGrant } from '../index.ts';

const grant: SeatGrant = {
  serverId: 's',
  roomId: 'r',
  seatId: 'seat',
  accountId: 'owner',
  matchId: 'm',
  grantId: 'g',
  credentialRef: 'opaque',
  maxActions: 3,
  expiresAt: 999999,
};
function view() {
  return {
    id: 'r',
    serverId: 's',
    selfSeatId: 'seat',
    matchId: 'm',
    seats: [{ id: 'seat', accountId: 'owner' }, { id: 'other', accountId: 'owner' }],
    manifest: { id: 'gomoku' },
    allowAgents: true,
    status: 'playing',
    version: 2,
    deadline: 5000,
    turn: 0,
    observation: { board: [] },
    unknownPrivateField: 'must never project',
  };
}
test('HTTP transport restricts endpoint surface and strips all non-seat payload fields', async () => {
  const calls: unknown[] = [];
  const t = createSeatHttpTransport({
    async request(input) {
      calls.push(input);
      return { status: 200, body: view() };
    },
  });
  const signal = new AbortController().signal;
  const observation = await t.observe(grant, signal);
  assert.deepEqual(observation.observation, { board: [] });
  assert.equal(observation.isOurTurn, true);
  assert.ok(!JSON.stringify(observation).includes('must never project'));
  await t.submit(
    grant,
    { expectedVersion: 2, idempotencyKey: 'move', action: { x: 1, y: 1 } },
    signal,
  );
  await t.revoke(grant, signal);
  assert.deepEqual(calls.map(c => (c as { path: string; }).path), [
    '/v1/agent/observation',
    '/v1/agent/actions',
    '/v1/agent/revoke',
  ]);
});
test('HTTP transport refuses cross-seat and next-match responses before exposing observations', async () => {
  for (const change of [{ selfSeatId: 'other' }, { matchId: 'next' }, { serverId: 'another' }]) {
    const t = createSeatHttpTransport({
      async request() {
        return { status: 200, body: { ...view(), ...change } };
      },
    });
    await assert.rejects(
      t.observe(grant, new AbortController().signal),
      /scope_or_response_mismatch/,
    );
  }
});
test('HTTP errors are redacted and transient failures marked retryable', async () => {
  const t = createSeatHttpTransport({
    async request() {
      return { status: 503, body: { error: { code: 'secret-token-value', message: 'private' } } };
    },
  });
  await assert.rejects(
    t.observe(grant, new AbortController().signal),
    e => e instanceof DispatchError && e.retryable && e.message === 'server_rejected',
  );
});
test('durable file store is private, atomic across reopen, and single-writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'game-agents-store-'));
  const record = {
    input: { id: 'd', grant },
    snapshot: { id: 'd' },
    retries: 0,
    pending: { expectedVersion: 1, idempotencyKey: 'move', action: { privateCard: 1 } },
  } as unknown as DispatchRecord;
  try {
    const store = await createFileDispatchStore(root);
    await assert.rejects(createFileDispatchStore(root), /store_locked/);
    await store.save(record);
    assert.equal((await stat(join(root, 'dispatches.json'))).mode & 0o777, 0o600);
    await store.close();
    const reopened = await createFileDispatchStore(root);
    assert.deepEqual(await reopened.load(), [record]);
    await reopened.close();
    await chmod(root, 0o755);
    await assert.rejects(createFileDispatchStore(root), /unsafe_store_directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
