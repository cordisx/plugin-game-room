import type {
  AgentLoopControlledTurnV1,
  AgentLoopControlV1,
} from '@cordisx/protocol/agent-loop-control/v1';
import type {
  AgentDefinition,
  AgentLoopSubscription,
  AgentLoopTaskBinding,
  BoundAgentLoopClient,
} from '@cordisx/protocol/agent-loop/v4';
import { createPlayerPrompt, PLAYER_INSTRUCTIONS } from './prompt.ts';
import { DispatchError } from './types.ts';
import type { AgentProvider, ModelRequest } from './types.ts';

export interface AgentLoopProviderOptions {
  agentLoop?: BoundAgentLoopClient;
  agentLoopControl?: AgentLoopControlV1;
  providerId: string;
  executionMode?: 'ordinary' | 'strict-data-only';
  /** Integration policy acknowledgement, not a claim that this package controls other plugins. */
  aggregateRewards: 'disabled-or-game-excluded' | 'unknown';
  now?: () => number;
}
interface Context {
  identity: string;
  binding?: AgentLoopTaskBinding;
  target?: AgentLoopControlledTurnV1;
  controller?: AbortController;
  running?: Promise<string>;
}
const base = {
  $schema:
    'https://raw.githubusercontent.com/cordisx/cordisx-protocol/main/schemas/agent-loop-command.v4.schema.json',
  contract: 'cordisx.agent-loop-command/v4',
  schemaVersion: 4,
} as const;

function definition(request: ModelRequest, providerId: string): AgentDefinition {
  return {
    $schema:
      'https://raw.githubusercontent.com/cordisx/cordisx-protocol/main/schemas/agent-definition.v1.schema.json',
    contract: 'cordisx.agent-definition/v1',
    schemaVersion: 1,
    identity: { agentId: `game-player-${request.contextId}`, revision: '1' },
    name: request.profile.name,
    inherit: {
      promptSections: 'none',
      rules: 'none',
      skills: 'none',
      tools: 'none',
      mcpServers: 'none',
      runtimeDefaults: 'none',
    },
    promptSections: [
      { sectionId: 'player-policy', kind: 'operations', text: PLAYER_INSTRUCTIONS },
      { sectionId: 'personality', kind: 'personality', text: request.profile.personality },
    ],
    runtimeDefaults: { model: { providerId, modelId: request.profile.model }, effort: 'high' },
  };
}

/** Public AgentLoop v4 creation/events plus additive ordinary-turn control v1. No private fallback. */
export function createAgentLoopProvider(options: AgentLoopProviderOptions): AgentProvider {
  const contexts = new Map<string, Context>();
  const now = options.now ?? Date.now;
  function availability() {
    if (options.executionMode === 'strict-data-only') {
      return { available: false, reason: 'strict-data-only-unsupported' };
    }
    if (options.aggregateRewards !== 'disabled-or-game-excluded') {
      return { available: false, reason: 'aggregate-reward-policy-unconfirmed' };
    }
    if (
      options.agentLoop?.contract !== 'cordisx.bound-agent-loop-client/v4'
      || options.agentLoopControl?.contract !== 'cordisx.agent-loop-control/v1'
    ) {
      return { available: false, reason: 'ordinary-turn-control-unavailable' };
    }
    return { available: true };
  }
  async function cancel(context: Context) {
    if (!context.target) return;
    const target = context.target;
    const result = await options.agentLoopControl!.cancel({
      commandId: `${target.commandId}:cancel`,
      target,
    });
    if (result.status !== 'accepted') throw new DispatchError('provider_cancel_unavailable');
    if (context.target === target) context.target = undefined;
  }
  async function run(
    request: ModelRequest,
    context: Context,
    local: AbortController,
  ): Promise<string> {
    const loop = options.agentLoop!;
    const control = options.agentLoopControl!;
    const signal = AbortSignal.any([request.signal, local.signal]);
    const check = () => {
      if (signal.aborted || now() >= request.deadline) throw new DispatchError('turn_deadline');
    };
    let subscription: AgentLoopSubscription | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    try {
      check();
      const def = definition(request, options.providerId);
      if (!context.binding) {
        const created = await loop.createOrBind({
          ...base,
          type: 'create-or-bind',
          commandId: `${request.contextId}:create`,
          definition: def.identity,
          definitions: [def],
          target: { mode: 'create' },
        });
        if (created.status !== 'accepted') throw new DispatchError('provider_create_unavailable');
        context.binding = created.binding;
      }
      check();
      const subscribed = await loop.subscribe(context.binding, -1);
      if (subscribed.status !== 'accepted') throw new DispatchError('provider_events_unavailable');
      subscription = subscribed.handle;
      check();
      // Host owns the actual deadline and provider interrupt, including if this renderer disappears.
      const sent = await control.submit({
        commandId: request.requestId,
        binding: context.binding,
        content: [{ kind: 'text', text: createPlayerPrompt(request) }],
        deadline: request.deadline,
      });
      if (sent.status !== 'accepted') throw new DispatchError(`provider_${sent.code}`);
      context.target = sent.value;
      const target = sent.value;
      if (
        target.commandId !== request.requestId || target.deadline !== request.deadline
        || target.binding.binding.bindingId !== context.binding.binding.bindingId
        || target.binding.binding.generation !== context.binding.binding.generation
      ) throw new DispatchError('provider_turn_mismatch');
      check();
      let output: string | undefined;
      let completedEvent = false;
      let streamError: unknown;
      void (async () => {
        try {
          for await (const page of subscription!.pages) {
            for (const event of page.events) {
              if (
                event.binding.bindingId !== target.binding.binding.bindingId
                || event.binding.generation !== target.binding.binding.generation
                || event.turn !== target.turn
              ) continue;
              if (event.causation && event.causation.operationId !== target.commandId) continue;
              if (
                event.type === 'message' && event.message.role === 'assistant'
                && event.message.purpose === 'conversation'
              ) {
                const text = event.message.content.map(part =>
                  part.kind === 'text' ? part.text : ''
                ).join('');
                if (new TextEncoder().encode(text).length > request.maxOutputBytes) {
                  throw new DispatchError('output_limit');
                }
                output = text;
              }
              if (event.type === 'lifecycle' && event.lifecycle.phase === 'binding.closed') {
                throw new DispatchError('provider_binding_closed');
              }
              if (event.type === 'lifecycle' && event.lifecycle.phase === 'turn.completed') {
                completedEvent = true;
              }
            }
          }
        } catch (error) {
          streamError = error;
        }
      })();
      // Read authority independently from text/lifecycle events; a message alone is never a completed action.
      while (true) {
        check();
        if (streamError) throw streamError;
        const state = await control.read(target);
        check();
        if (state.status !== 'accepted') throw new DispatchError('provider_state_unavailable');
        if (state.value.state === 'completed' && completedEvent && output !== undefined) {
          completed = true;
          context.target = undefined;
          return output;
        }
        if (state.value.state !== 'running' && state.value.state !== 'completed') {
          throw new DispatchError(`provider_${state.value.state}`);
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DispatchError('turn_deadline'));
          };
          signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          }, Math.min(100, Math.max(1, request.deadline - now())));
          if (signal.aborted) abort();
        });
      }
    } finally {
      clearTimeout(timer);
      subscription?.unsubscribe();
      if (!completed) await cancel(context);
    }
  }
  return {
    availability,
    async act(request) {
      const available = availability();
      if (!available.available) throw new DispatchError(available.reason!);
      const identity = JSON.stringify({ binding: request.binding, profile: request.profile });
      let context = contexts.get(request.contextId);
      if (context && context.identity !== identity) {
        throw new DispatchError('provider_context_scope_mismatch');
      }
      if (!context) {
        context = { identity };
        contexts.set(request.contextId, context);
      }
      if (context.running || context.target) throw new DispatchError('provider_context_busy');
      const local = new AbortController();
      context.controller = local;
      const active = context;
      active.running = run(request, active, local).finally(() => {
        active.running = undefined;
        active.controller = undefined;
      });
      return active.running;
    },
    async dispose(contextId) {
      const context = contexts.get(contextId);
      if (!context) return;
      context.controller?.abort();
      await context.running?.catch(() => {});
      await cancel(context);
    },
  };
}
