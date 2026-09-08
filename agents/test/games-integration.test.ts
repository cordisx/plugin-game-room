import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createDispatchService, createSeatHttpTransport } from '../index.ts';
import type { AgentProvider, Json, SeatGrant } from '../index.ts';

const serverRoot = process.env.GAME_ROOM_SERVER_SOURCE;
const packagesRoot = process.env.GAME_ROOM_PACKAGES;
for (const name of ['gomoku-1.0.0', 'texas-holdem-1.0.0']) {
  test(
    `published ${name} plays through dispatch using seat legal actions (deterministic fixture, not AI)`,
    { skip: !serverRoot || !packagesRoot },
    async t => {
      const { harness } = await import(
        pathToFileURL(resolve(serverRoot!, 'tests/server/helpers.ts')).href
      );
      const h = await harness();
      t.after(() => h.app.close());
      const pkg = JSON.parse(await readFile(resolve(packagesRoot!, `${name}.json`), 'utf8'));
      assert.equal(
        pkg.ui.format,
        'scene-v1',
        'integration packages must use the current scene UI contract',
      );
      const published = await h.request('/v1/packages', h.alice.token, pkg);
      assert.equal(published.status, 200, JSON.stringify(published.body));
      const created = await h.request('/v1/rooms', h.alice.token, {
        packageHash: published.body.hash,
        mode: 'score',
        allowAgents: true,
        policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      const path = `/v1/rooms/${created.body.id}`;
      assert.equal((await h.request(path + '/join', h.bob.token, {})).status, 200);
      for (const owner of [h.alice, h.bob]) {
        assert.equal((await h.request(path + '/ready', owner.token, { ready: true })).status, 200);
      }
      const started = await h.request(path + '/start', h.alice.token, {});
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const room = started.body;
      assert.equal(room.status, 'playing', JSON.stringify(room));
      const grants: SeatGrant[] = [];
      const tokens = new Map<string, string>();
      for (const [index, owner] of [h.alice, h.bob].entries()) {
        const issued = await h.request(`/v1/rooms/${room.id}/agent-grants`, owner.token, {
          seatId: room.seats[index].id,
          expiresAt: Date.now() + 60000,
          maxActions: 30,
        });
        assert.equal(issued.status, 200);
        const { token, ...fields } = issued.body;
        const grant = { ...fields, credentialRef: `grant-${index}` } as SeatGrant;
        grants.push(grant);
        tokens.set(grant.credentialRef, token);
      }
      const seen: Json[] = [];
      const provider: AgentProvider = {
        availability: () => ({ available: true }),
        async act(request) {
          const observation = request.observation as {
            legalActions: { type: string; x?: number; y?: number; }[];
            selfSeat: number;
          };
          seen.push(request.observation);
          assert.ok(observation.legalActions.length);
          assert.ok(!JSON.stringify(request).includes('"deck"'));
          assert.ok(!JSON.stringify(request).includes('"seed"'));
          let action: Json;
          if (name.startsWith('gomoku')) {
            const index = grants.findIndex(g => g.seatId === request.binding.seatId);
            action = observation.legalActions.find(a =>
              a.type === 'place' && a.y === index
            ) as Json;
          } else {
            assert.ok(observation.legalActions.some(a => a.type === 'fold'));
            action = { type: 'fold' };
          }
          assert.ok(action);
          return JSON.stringify({ requestId: request.requestId, version: request.version, action });
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
          id: `builtin-agent-${index}`,
          profile: {
            id: 'fixture',
            name: 'Player',
            gameIds: [pkg.manifest.id],
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
            maxActions: 30,
            maxModelCalls: 30,
            maxDurationMs: 60000,
            turnTimeoutMs: 10000,
            maxRetries: 2,
            maxOutputBytes: 2000,
          },
        });
      }
      for (
        let round = 0;
        round < 40 && service.list().some(s => s.status !== 'completed');
        round++
      ) {
        for (const snapshot of service.list()) await service.tick(snapshot.id);
      }
      assert.ok(seen.length > 0);
      assert.ok(
        service.list().every(s => s.status === 'completed'),
        JSON.stringify(service.list()),
      );
      assert.equal(
        (await h.request(`/v1/rooms/${room.id}`, h.alice.token)).body.status,
        'finished',
      );
    },
  );
}
