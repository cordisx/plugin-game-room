import type {
  AgentLoopControlledTurnV1,
  AgentLoopControlV1,
} from '@cordisx/protocol/agent-loop-control/v1';
import type {
  AgentLoopCreateOrBindResult,
  AgentLoopEventPage,
  AgentLoopTaskBinding,
  BoundAgentLoopClient,
} from '@cordisx/protocol/agent-loop/v4';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentLoopProvider } from '../agent-loop-provider.ts';
import type { ModelRequest } from '../types.ts';

function request(id = 'dispatch1'): ModelRequest {
  return {
    contextId: id,
    requestId: `${id}:1:1`,
    profile: {
      id: 'profile',
      name: 'Player',
      gameIds: ['gomoku'],
      personality: 'calm',
      model: 'selected-model',
    },
    binding: { serverId: 's', roomId: 'r', seatId: id, accountId: 'same-owner' },
    version: 1,
    observation: { legalActions: [{ type: 'place', x: 1, y: 1 }] },
    deadline: Date.now() + 10000,
    maxOutputBytes: 1000,
    signal: new AbortController().signal,
  };
}
function fixture() {
  const creates: unknown[] = [];
  const sends: unknown[] = [];
  const cancels: AgentLoopControlledTurnV1[] = [];
  let unsubscribed = 0;
  let state = 'completed';
  let autoComplete = true;
  let cancelledUnavailable = false;
  const bindings = new Map<string, AgentLoopTaskBinding>();
  const targets = new Map<string, AgentLoopControlledTurnV1>();
  const loop = {
    contract: 'cordisx.bound-agent-loop-client/v4',
    async createOrBind() {
      throw Error('must use controlled creation with Host-owned game cwd');
    },
    async subscribe(binding: AgentLoopTaskBinding) {
      let ended = false;
      return {
        status: 'accepted',
        handle: {
          unsubscribe() {
            ended = true;
            unsubscribed++;
          },
          pages: {
            async *[Symbol.asyncIterator]() {
              while (!ended) {
                const target = targets.get(binding.binding.bindingId);
                if (!target || !autoComplete) {
                  await new Promise(r => setTimeout(r, 5));
                  continue;
                }
                const event = {
                  binding: binding.binding,
                  turn: target.turn,
                  causation: { operationId: target.commandId },
                };
                yield {
                  events: [
                    {
                      ...event,
                      turn: 'foreign-turn',
                      type: 'message',
                      message: {
                        role: 'assistant',
                        purpose: 'conversation',
                        content: [{ kind: 'text', text: 'foreign-secret' }],
                      },
                    },
                    {
                      ...event,
                      type: 'message',
                      message: {
                        role: 'assistant',
                        purpose: 'conversation',
                        content: [{
                          kind: 'text',
                          text: JSON.stringify({
                            requestId: target.commandId,
                            version: 1,
                            action: { type: 'place', x: 1, y: 1 },
                          }),
                        }],
                      },
                    },
                    { ...event, type: 'lifecycle', lifecycle: { phase: 'turn.completed' } },
                  ],
                } as unknown as AgentLoopEventPage;
                return;
              }
            },
          },
        },
      };
    },
    dispose() {
      throw Error('must not dispose shared client');
    },
  } as unknown as BoundAgentLoopClient;
  const control: AgentLoopControlV1 = {
    contract: 'cordisx.agent-loop-control/v1',
    async create(input) {
      creates.push(input);
      const binding = {
        binding: { bindingId: input.commandId, generation: 1 },
        task: `opaque-${input.commandId}`,
        state: 'active',
        definition: input.definition,
      } as AgentLoopTaskBinding;
      bindings.set(input.commandId, binding);
      return { status: 'accepted', binding } as AgentLoopCreateOrBindResult;
    },
    async submit(input) {
      sends.push(input);
      const target = {
        contract: 'cordisx.agent-loop-controlled-turn/v1',
        ...input,
        turn: `turn-${input.commandId}`,
      } as AgentLoopControlledTurnV1;
      targets.set(input.binding.binding.bindingId, target);
      return { status: 'accepted', value: target };
    },
    async read() {
      return { status: 'accepted', value: { state: state as 'completed' } };
    },
    async cancel(input) {
      cancels.push(input.target);
      return cancelledUnavailable
        ? { status: 'unavailable', code: 'host-unavailable' }
        : { status: 'accepted', value: { outcome: 'cancelled' } };
    },
    dispose() {
      throw Error('must not dispose shared control');
    },
  };
  const options = {
    agentLoop: loop,
    agentLoopControl: control,
    providerId: 'provider',
    aggregateRewards: 'disabled-or-game-excluded' as const,
  };
  return {
    options,
    creates,
    sends,
    cancels,
    unsubscribed: () => unsubscribed,
    running: () => {
      state = 'running';
      autoComplete = false;
    },
    rejectCancel: (value: boolean) => {
      cancelledUnavailable = value;
    },
  };
}

test('public adapter uses controlled game-cwd creation and exact turn plus authoritative completion', async () => {
  const f = fixture();
  const provider = createAgentLoopProvider(f.options);
  const [a, b] = await Promise.all([provider.act(request('a')), provider.act(request('b'))]);
  assert.equal(JSON.parse(a).requestId, 'a:1:1');
  assert.equal(JSON.parse(b).requestId, 'b:1:1');
  assert.equal(f.creates.length, 2);
  assert.equal(f.sends.length, 2);
  assert.equal(f.unsubscribed(), 2);
  assert.equal(f.cancels.length, 0);
  for (const create of f.creates) {
    assert.deepEqual((create as { target: unknown; }).target, { mode: 'create' });
  }
  assert.ok(JSON.stringify(f.creates).includes('selected-model'));
  await provider.dispose('a');
  await provider.dispose('b');
});

test('an older control client without controlled creation never falls back to legacy task creation', async () => {
  const f = fixture();
  const old = { ...f.options.agentLoopControl, create: undefined } as unknown as AgentLoopControlV1;
  const provider = createAgentLoopProvider({ ...f.options, agentLoopControl: old });
  assert.deepEqual(provider.availability(), {
    available: false,
    reason: 'ordinary-turn-control-unavailable',
  });
  await assert.rejects(provider.act(request()), /ordinary-turn-control-unavailable/);
  assert.equal(f.creates.length, 0);
});

test('abort calls public cancellation for the exact active turn and disposes the subscription', async () => {
  const f = fixture();
  f.running();
  const provider = createAgentLoopProvider(f.options);
  const input = request();
  const controller = new AbortController();
  input.signal = controller.signal;
  const run = provider.act(input);
  const rejected = assert.rejects(run, /turn_deadline/);
  while (!f.sends.length) await new Promise(r => setTimeout(r, 1));
  controller.abort();
  await rejected;
  assert.equal(f.cancels.length, 1);
  assert.equal(f.cancels[0].commandId, input.requestId);
  assert.equal(f.unsubscribed(), 1);
});

test('deadline cancels model work and cancellation failures remain retryable cleanup', async () => {
  const f = fixture();
  f.running();
  f.rejectCancel(true);
  const provider = createAgentLoopProvider(f.options);
  const input = request();
  input.deadline = Date.now() + 30;
  await assert.rejects(provider.act(input), /provider_cancel_unavailable/);
  await assert.rejects(provider.act(input), /provider_context_busy/);
  f.rejectCancel(false);
  await provider.dispose(input.contextId);
  assert.ok(f.cancels.length >= 2);
});

test('strict data-only, missing control and unconfirmed reward policy never silently fall back', async () => {
  const f = fixture();
  for (
    const changes of [{ executionMode: 'strict-data-only' as const }, {
      agentLoopControl: undefined,
    }, { aggregateRewards: 'unknown' as const }]
  ) {
    const provider = createAgentLoopProvider({ ...f.options, ...changes });
    assert.equal(provider.availability().available, false);
    await assert.rejects(provider.act(request()));
  }
  assert.equal(f.creates.length, 0);
});

test('a context cannot be rebound to another seat or profile', async () => {
  const f = fixture();
  const provider = createAgentLoopProvider(f.options);
  const input = request();
  await provider.act(input);
  input.binding.seatId = 'someone-else';
  await assert.rejects(provider.act(input), /provider_context_scope_mismatch/);
});

test('reward policy is checked again before each inference and failure cannot retain old approval', async () => {
  const f = fixture();
  let permitted = true;
  const provider = createAgentLoopProvider({
    ...f.options,
    aggregateRewards: () => {
      if (!permitted) throw Error('retired work epoch');
      return 'disabled-or-game-excluded';
    },
  });
  await provider.act(request('first'));
  permitted = false;
  assert.equal(provider.availability().available, false);
  await assert.rejects(provider.act(request('second')), /aggregate-reward-policy-unconfirmed/);
  assert.equal(f.creates.length, 1);
});
