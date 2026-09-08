import { createMemoryDispatchStore } from './store.ts';
import { DispatchError } from './types.ts';
import type {
  AgentProvider,
  DispatchInput,
  DispatchRecord,
  DispatchSnapshot,
  DispatchStatus,
  DispatchStore,
  SeatTransport,
} from './types.ts';
import { parseAction, sameSeat, validateInput, validateView } from './validation.ts';

interface Entry {
  record: DispatchRecord;
  running?: Promise<void>;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  epoch: number;
}
export interface DispatchServiceOptions {
  provider: AgentProvider;
  transport: SeatTransport;
  store?: DispatchStore;
  now?: () => number;
  pollIntervalMs?: number;
  /** Manual drive is useful for deterministic integration harnesses. Production defaults to automatic. */
  automatic?: boolean;
}
const terminal = new Set<DispatchStatus>(['completed', 'withdrawn', 'failed']);

export function createDispatchService(options: DispatchServiceOptions) {
  const { provider, transport } = options;
  const store = options.store ?? createMemoryDispatchStore();
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const listeners = new Set<(snapshot: DispatchSnapshot) => void>();
  let closed = false;
  const getEntry = (id: string) => {
    const entry = entries.get(id);
    if (!entry) throw new DispatchError('dispatch_not_found');
    return entry;
  };
  async function save(entry: Entry, status?: DispatchStatus, reason?: string) {
    if (status) entry.record.snapshot.status = status;
    if (reason !== undefined) entry.record.snapshot.reason = reason;
    entry.record.snapshot.updatedAt = now();
    await store.save(structuredClone(entry.record));
    for (const listener of listeners) {
      try {
        listener(structuredClone(entry.record.snapshot));
      } catch { /* UI cannot break execution. */ }
    }
  }
  function schedule(entry: Entry) {
    clearTimeout(entry.timer);
    if (
      closed || options.automatic === false || terminal.has(entry.record.snapshot.status)
      || entry.record.snapshot.status === 'paused'
    ) return;
    entry.timer = setTimeout(() => {
      void tick(entry.record.input.id).catch(() => {});
    }, Math.max(50, options.pollIntervalMs ?? 1000));
  }
  async function stop(entry: Entry, target: 'completed' | 'withdrawn' | 'failed', reason?: string) {
    entry.record.terminalTarget = target;
    await save(entry, 'withdrawing', reason);
    await provider.dispose(entry.record.input.id);
    const signal = AbortSignal.timeout(10000);
    await transport.revoke(entry.record.input.grant, signal);
    delete entry.record.pending;
    await save(entry, target);
  }
  async function drive(entry: Entry) {
    const { record } = entry;
    const { input, snapshot } = record;
    if (closed || terminal.has(snapshot.status) || snapshot.status === 'paused') return;
    const epoch = entry.epoch;
    const controller = new AbortController();
    entry.controller = controller;
    const active = () => {
      if (closed || controller.signal.aborted || epoch !== entry.epoch) {
        throw new DispatchError('cancelled');
      }
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (record.terminalTarget) {
        await stop(entry, record.terminalTarget);
        return;
      }
      const end = Math.min(input.grant.expiresAt, snapshot.startedAt + input.budget.maxDurationMs);
      if (now() >= end) {
        await stop(entry, 'failed', 'dispatch_deadline');
        return;
      }
      timeout = setTimeout(() => controller.abort(), Math.min(10000, end - now()));
      if (record.pending) {
        await save(entry, 'submitting');
        active();
        const view = await transport.submit(
          input.grant,
          structuredClone(record.pending),
          controller.signal,
        );
        active();
        validateView(view, input);
        snapshot.actionsUsed++;
        delete record.pending;
        record.retries = 0;
        await save(entry, 'waiting');
        if (view.status === 'finished' || view.status === 'aborted') {
          await stop(entry, 'completed', view.status);
        }
        return;
      }
      const view = await transport.observe(input.grant, controller.signal);
      active();
      validateView(view, input);
      if (view.status === 'finished' || view.status === 'aborted') {
        await stop(entry, 'completed', view.status);
        return;
      }
      if (snapshot.leaveAfterMatch && view.status === 'waiting') {
        await stop(entry, 'withdrawn', 'left_before_start');
        return;
      }
      if (
        snapshot.actionsUsed >= input.budget.maxActions
        || snapshot.modelCallsUsed >= input.budget.maxModelCalls
      ) {
        await stop(entry, 'failed', 'budget_exhausted');
        return;
      }
      if (view.status !== 'playing' || !view.isOurTurn) {
        record.retries = 0;
        await save(entry, 'waiting');
        return;
      }
      const available = provider.availability();
      if (!available.available) throw new DispatchError('provider_unavailable');
      const deadline = Math.min(end, view.deadline ?? end, now() + input.budget.turnTimeoutMs);
      if (deadline <= now()) {
        await save(entry, 'waiting');
        return;
      }
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), deadline - now());
      const requestId = `${input.id}:${view.version}:${snapshot.modelCallsUsed + 1}`;
      snapshot.modelCallsUsed++;
      await save(entry, 'thinking');
      active();
      const text = await provider.act({
        contextId: input.id,
        requestId,
        profile: structuredClone(input.profile),
        binding: structuredClone(input.binding),
        version: view.version,
        observation: structuredClone(view.observation),
        deadline,
        maxOutputBytes: input.budget.maxOutputBytes,
        signal: controller.signal,
      });
      active();
      if (now() >= deadline) throw new DispatchError('turn_deadline');
      const action = parseAction(text, requestId, view.version, input.budget.maxOutputBytes);
      record.pending = { expectedVersion: view.version, idempotencyKey: requestId, action };
      record.retries = 0;
      await save(entry, 'submitting');
    } catch (error) {
      if (closed || epoch !== entry.epoch) return;
      const code = error instanceof DispatchError ? error.code : 'operation_failed';
      if (code === 'version_conflict' && record.pending) {
        delete record.pending;
        record.retries = 0;
        await save(entry, 'waiting', code);
      } else if (record.terminalTarget) {
        record.retries++;
        await save(
          entry,
          record.retries > input.budget.maxRetries ? 'paused' : 'withdrawing',
          'cleanup_pending',
        );
      } else if (
        (error instanceof DispatchError && error.retryable || controller.signal.aborted)
        && record.retries < input.budget.maxRetries
      ) {
        record.retries++;
        await save(entry, 'retrying', controller.signal.aborted ? 'operation_deadline' : code);
      } else {
        try {
          await stop(entry, 'failed', code);
        } catch {
          await save(entry, 'paused', 'cleanup_pending');
        }
      }
    } finally {
      clearTimeout(timeout);
      if (entry.controller === controller) entry.controller = undefined;
    }
  }
  async function tick(id: string): Promise<void> {
    const entry = getEntry(id);
    if (entry.running) return entry.running;
    entry.running = drive(entry).finally(() => {
      entry.running = undefined;
      schedule(entry);
    });
    return entry.running;
  }
  return {
    async dispatch(input: DispatchInput): Promise<DispatchSnapshot> {
      if (closed) throw new DispatchError('service_closed');
      validateInput(input, now());
      if (
        entries.has(input.id)
        || [...entries.values()].some(e =>
          !terminal.has(e.record.snapshot.status) && sameSeat(e.record.input.binding, input.binding)
        )
      ) {
        throw new DispatchError('dispatch_conflict');
      }
      const snapshot: DispatchSnapshot = {
        id: input.id,
        profile: structuredClone(input.profile),
        binding: structuredClone(input.binding),
        status: 'starting',
        actionsUsed: 0,
        modelCallsUsed: 0,
        startedAt: now(),
        updatedAt: now(),
        leaveAfterMatch: false,
        usage: { tokens: null, rewardEnabled: false, reason: 'usage-attribution-unavailable' },
      };
      const entry: Entry = {
        record: { input: structuredClone(input), snapshot, retries: 0 },
        epoch: 0,
      };
      entries.set(input.id, entry);
      try {
        await save(entry);
      } catch (error) {
        entries.delete(input.id);
        throw error;
      }
      schedule(entry);
      return structuredClone(snapshot);
    },
    async restore(): Promise<void> {
      if (closed || entries.size) throw new DispatchError('restore_requires_empty_service');
      for (const record of await store.load()) {
        // Recovery never restarts a model turn; it reobserves or replays a persisted pending action.
        const entry: Entry = { record: structuredClone(record), epoch: 0 };
        entries.set(record.input.id, entry);
        if (!terminal.has(record.snapshot.status) && record.snapshot.status !== 'paused') {
          await save(entry, record.terminalTarget ? 'withdrawing' : 'waiting');
          schedule(entry);
        }
      }
    },
    tick,
    async pause(id: string): Promise<void> {
      const entry = getEntry(id);
      if (terminal.has(entry.record.snapshot.status)) return;
      entry.epoch++;
      clearTimeout(entry.timer);
      entry.controller?.abort();
      await save(entry, 'paused');
      await provider.dispose(id);
    },
    async resume(id: string): Promise<void> {
      if (closed) throw new DispatchError('service_closed');
      const entry = getEntry(id);
      if (entry.record.snapshot.status !== 'paused') return;
      await entry.running;
      entry.record.retries = 0;
      await save(entry, entry.record.terminalTarget ? 'withdrawing' : 'waiting');
      schedule(entry);
    },
    async withdraw(id: string, mode: 'immediate' | 'after-match'): Promise<void> {
      const entry = getEntry(id);
      if (terminal.has(entry.record.snapshot.status)) return;
      if (mode === 'after-match') {
        entry.record.snapshot.leaveAfterMatch = true;
        await save(entry);
        schedule(entry);
        return;
      }
      entry.epoch++;
      clearTimeout(entry.timer);
      entry.controller?.abort();
      entry.record.terminalTarget = 'withdrawn';
      await save(entry, 'withdrawing');
      await provider.dispose(id);
      await entry.running;
      await tick(id);
    },
    get(id: string): DispatchSnapshot {
      return structuredClone(getEntry(id).record.snapshot);
    },
    list(): DispatchSnapshot[] {
      return [...entries.values()].map(e => structuredClone(e.record.snapshot));
    },
    subscribe(listener: (snapshot: DispatchSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      closed = true;
      for (const entry of entries.values()) {
        entry.epoch++;
        clearTimeout(entry.timer);
        entry.controller?.abort();
      }
      await Promise.all([...entries.values()].map(async entry => {
        await provider.dispose(entry.record.input.id);
        await entry.running;
      }));
      listeners.clear();
    },
  };
}
export type DispatchService = ReturnType<typeof createDispatchService>;
