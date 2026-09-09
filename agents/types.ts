export type Json = null | boolean | number | string | Json[] | { [key: string]: Json; };
export interface SeatBinding {
  serverId: string;
  roomId: string;
  seatId: string;
  accountId: string;
}
export interface AgentProfile {
  id: string;
  name: string;
  gameIds: string[];
  personality: string;
  model: string;
}
export interface DispatchBudget {
  maxActions: number;
  maxModelCalls: number;
  maxDurationMs: number;
  turnTimeoutMs: number;
  maxRetries: number;
  maxOutputBytes: number;
}
/** An opaque credential reference resolved only by trusted transport. Never model input. */
export interface SeatGrant extends SeatBinding {
  matchId: string;
  grantId: string;
  credentialRef: string;
  expiresAt: number;
  maxActions: number;
}
export interface SeatObservation extends SeatBinding {
  matchId: string;
  gameId: string;
  allowAgents: boolean;
  status: 'waiting' | 'funding' | 'playing' | 'finished' | 'aborted';
  version: number;
  isOurTurn: boolean;
  deadline: number | null;
  observation: Json;
}
export interface ActionRequest {
  expectedVersion: number;
  idempotencyKey: string;
  action: Json;
}
export interface SeatTransport {
  observe(grant: SeatGrant, signal: AbortSignal): Promise<SeatObservation>;
  submit(grant: SeatGrant, action: ActionRequest, signal: AbortSignal): Promise<SeatObservation>;
  revoke(grant: SeatGrant, signal: AbortSignal): Promise<void>;
}
export interface ModelRequest {
  contextId: string;
  requestId: string;
  profile: AgentProfile;
  binding: SeatBinding;
  version: number;
  observation: Json;
  deadline: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}
export interface AgentProvider {
  availability(): { available: boolean; reason?: string; };
  /** Must enforce real cancellation/deadline. Ordinary mode retains the user's provider permissions. */
  act(request: ModelRequest): Promise<string>;
  dispose(contextId: string): Promise<void>;
}
export type DispatchStatus =
  | 'starting'
  | 'waiting'
  | 'thinking'
  | 'submitting'
  | 'retrying'
  | 'paused'
  | 'withdrawing'
  | 'completed'
  | 'withdrawn'
  | 'failed';
export interface DispatchInput {
  id: string;
  profile: AgentProfile;
  binding: SeatBinding;
  grant: SeatGrant;
  budget: DispatchBudget;
}
export interface DispatchSnapshot {
  id: string;
  profile: AgentProfile;
  binding: SeatBinding;
  status: DispatchStatus;
  reason?: string;
  actionsUsed: number;
  modelCallsUsed: number;
  startedAt: number;
  updatedAt: number;
  leaveAfterMatch: boolean;
  /** No per-task attribution is currently available. Never mint rewards from aggregate usage. */
  usage: { tokens: null; rewardEnabled: false; reason: 'usage-attribution-unavailable'; };
}
/** Sensitive private state: do not put observation/action contents in public documents. */
export interface DispatchRecord {
  input: DispatchInput;
  snapshot: DispatchSnapshot;
  pending?: ActionRequest;
  /** After restart, wait out a submitted turn's Host deadline before opening another inference. */
  inferenceDeadline?: number;
  retries: number;
  terminalTarget?: 'completed' | 'withdrawn' | 'failed';
}
/** Store requires exclusive single-writer ownership; durable implementations protect seat-private data. */
export interface DispatchStore {
  load(): Promise<DispatchRecord[]>;
  save(record: DispatchRecord): Promise<void>;
}
export class DispatchError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) {
    super(code);
  }
}
