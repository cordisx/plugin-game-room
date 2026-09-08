import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createDispatchService, createSeatHttpTransport, DispatchError } from '../index.ts';
import type { AgentProvider, DispatchInput, SeatGrant } from '../index.ts';

// Opt-in source assembly test. No user server, credentials or real model is touched.
const serverRoot = process.env.GAME_ROOM_SERVER_SOURCE;
test('one human and two Agents owned by the same account keep distinct seat observations', {
  skip: !serverRoot,
}, async t => {
  const { harness, game } = await import(
    pathToFileURL(resolve(serverRoot!, 'tests/server/helpers.ts')).href
  );
  const h = await harness();
  t.after(() => h.app.close());
  const pkg = game(`globalThis.game={
    setup(ctx){return {state:{n:0,hands:ctx.seats.map((_,i)=>'private-'+i)},turn:0}},
    observe(s,i){return {hand:s.hands[i],legalActions:[{type:'move'}]}},
    act(s,a,ctx){if(a.type!=='move')throw Error('invalid_action');s.n++;return s.n===3?{state:s,turn:null,done:{winners:[0]}}:{state:s,turn:s.n}},
    timeout(s,ctx){return {state:s,turn:null,done:{winners:[]}}}
  }`);
  pkg.manifest.maxPlayers = 3;
  const published = await h.request('/v1/packages', h.alice.token, pkg);
  const created = await h.request('/v1/rooms', h.alice.token, {
    packageHash: published.body.hash,
    mode: 'score',
    allowAgents: true,
    maxPlayers: 3,
  });
  const room = created.body;
  const path = `/v1/rooms/${room.id}`;
  const grants: SeatGrant[] = [];
  const tokens = new Map<string, string>();
  for (const participantId of ['companion-a', 'companion-b']) {
    const added = await h.request(path + '/agent-seats', h.alice.token, {
      participantId,
      name: participantId,
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.seat.kind, 'agent');
    const issued = await h.request(path + '/agent-grants', h.alice.token, {
      seatId: added.body.seat.id,
      expiresAt: Date.now() + 60000,
      maxActions: 3,
    });
    assert.equal(issued.status, 200);
    const { token, ...fields } = issued.body;
    const grant = { ...fields, credentialRef: participantId } as SeatGrant;
    grants.push(grant);
    tokens.set(participantId, token);
    assert.equal(
      (await h.request(path + '/ready', h.alice.token, { ready: true, seatId: grant.seatId }))
        .status,
      200,
    );
  }
  await h.request(path + '/ready', h.alice.token, { ready: true, seatId: room.selfSeatId });
  const started = await h.request(path + '/start', h.alice.token, {});
  assert.equal(started.body.status, 'playing');
  await h.request(path + '/actions', h.alice.token, {
    expectedVersion: started.body.version,
    idempotencyKey: 'human-first',
    action: { type: 'move' },
  });
  const observed = new Map<string, unknown>();
  const provider: AgentProvider = {
    availability: () => ({ available: true }),
    async act(input) {
      observed.set(input.contextId, input.observation);
      return JSON.stringify({
        requestId: input.requestId,
        version: input.version,
        action: { type: 'move' },
      });
    },
    async dispose() {},
  };
  const transport = createSeatHttpTransport({
    async request(input) {
      return h.request(input.path, tokens.get(input.credentialRef), input.body, input.method);
    },
  });
  const service = createDispatchService({ provider, transport, automatic: false });
  t.after(() => service.close());
  for (const [index, grant] of grants.entries()) {
    await service.dispatch({
      id: `same-owner-agent-${index}`,
      profile: {
        id: 'same-profile',
        name: 'Player',
        gameIds: ['test-game'],
        personality: 'calm',
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
    });
  }
  for (let i = 0; i < 4; i++) {
    for (const snapshot of service.list()) await service.tick(snapshot.id);
  }
  assert.deepEqual(observed.get('same-owner-agent-0'), {
    hand: 'private-1',
    legalActions: [{ type: 'move' }],
  });
  assert.deepEqual(observed.get('same-owner-agent-1'), {
    hand: 'private-2',
    legalActions: [{ type: 'move' }],
  });
  assert.ok(
    service.list().every(s =>
      s.status === 'completed' && s.modelCallsUsed === 1 && s.actionsUsed === 1
    ),
  );
});
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
