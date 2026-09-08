import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createDispatchService, createSeatHttpTransport, DispatchError } from '../index.ts';
import type { AgentProvider, DispatchInput, SeatGrant } from '../index.ts';

// Opt-in source assembly test. No user server, credentials or real model is touched.
const serverRoot = process.env.GAME_ROOM_SERVER_SOURCE;
test('real HTTP grant + authoritative QuickJS game + lost ACK + isolated dispatch', {
  skip: !serverRoot,
}, async t => {
  const { harness } = await import(
    pathToFileURL(resolve(serverRoot!, 'tests/server/helpers.ts')).href
  );
  const h = await harness();
  t.after(() => h.app.close());
  const room = await h.room();
  const response = await h.request(`/v1/rooms/${room.id}/agent-grants`, h.alice.token, {
    seatId: room.selfSeatId,
    expiresAt: Date.now() + 60000,
    maxActions: 3,
  });
  assert.equal(response.status, 200);
  const { token, ...fields } = response.body;
  const grant: SeatGrant = { ...fields, credentialRef: 'test-only-grant-handle' };
  let lost = false;
  const transport = createSeatHttpTransport({
    async request(input) {
      assert.equal(input.credentialRef, grant.credentialRef);
      assert.equal(input.serverId, room.serverId);
      const result = await h.request(input.path, token, input.body, input.method);
      if (input.path === '/v1/agent/actions' && !lost) {
        lost = true;
        throw new DispatchError('network_unavailable', true);
      }
      return result;
    },
  });
  let calls = 0;
  const provider: AgentProvider = {
    availability: () => ({ available: true }),
    async act(input) {
      calls++;
      assert.equal((input.observation as { hand: string; }).hand, 'private-0');
      assert.ok(!JSON.stringify(input).includes('private-1'));
      assert.ok(!JSON.stringify(input).includes(token));
      return JSON.stringify({
        requestId: input.requestId,
        version: input.version,
        action: { type: 'move' },
      });
    },
    async dispose() {},
  };
  const dispatch: DispatchInput = {
    id: 'real-http-fixture',
    profile: {
      id: 'test',
      name: 'Player',
      gameIds: ['test-game'],
      personality: 'careful',
      model: 'fixture',
    },
    binding: {
      serverId: grant.serverId,
      roomId: grant.roomId,
      seatId: grant.seatId,
      accountId: grant.accountId,
    },
    grant,
    budget: {
      maxActions: 3,
      maxModelCalls: 3,
      maxDurationMs: 60000,
      turnTimeoutMs: 10000,
      maxRetries: 2,
      maxOutputBytes: 1000,
    },
  };
  const service = createDispatchService({ provider, transport, automatic: false });
  t.after(() => service.close());
  await service.dispatch(dispatch);
  await service.tick(dispatch.id);
  await service.tick(dispatch.id);
  assert.equal(service.get(dispatch.id).status, 'retrying');
  await service.tick(dispatch.id);
  assert.equal(calls, 1);
  assert.equal(service.get(dispatch.id).actionsUsed, 1);
  const bobView = await h.request(`/v1/rooms/${room.id}`, h.bob.token);
  assert.equal(bobView.body.version, room.version + 1);
  await service.withdraw(dispatch.id, 'after-match');
  const ended = await h.request(`/v1/rooms/${room.id}/actions`, h.bob.token, {
    expectedVersion: bobView.body.version,
    idempotencyKey: 'bob-finishes',
    action: { type: 'move' },
  });
  assert.equal(ended.body.status, 'finished');
  await service.tick(dispatch.id);
  assert.equal(service.get(dispatch.id).status, 'completed');
  assert.equal((await h.request('/v1/agent/observation', token)).body.error.code, 'grant_revoked');
});
