import { DispatchError } from './types.ts';
import type { DispatchInput, Json, SeatBinding, SeatObservation } from './types.ts';

export function sameSeat(a: SeatBinding, b: SeatBinding): boolean {
  return ['serverId', 'roomId', 'seatId', 'accountId'].every(k =>
    a[k as keyof SeatBinding] === b[k as keyof SeatBinding]
  );
}
export function validateInput(input: DispatchInput, now: number): void {
  if (!/^[a-zA-Z0-9_:-]{1,80}$/.test(input.id) || !sameSeat(input.binding, input.grant)) {
    throw new DispatchError('invalid_binding');
  }
  for (const value of Object.values(input.binding)) {
    if (typeof value !== 'string' || !value || value.length > 250) {
      throw new DispatchError('invalid_binding');
    }
  }
  if (
    !input.profile.id || !input.profile.model || !input.profile.gameIds.length
    || input.profile.personality.length > 8000
  ) throw new DispatchError('invalid_profile');
  const { budget, grant } = input;
  for (
    const key of [
      'maxActions',
      'maxModelCalls',
      'maxDurationMs',
      'turnTimeoutMs',
      'maxRetries',
      'maxOutputBytes',
    ] as const
  ) {
    const value = budget[key];
    if (!Number.isSafeInteger(value) || value < (key === 'maxRetries' ? 0 : 1)) {
      throw new DispatchError('invalid_budget');
    }
  }
  if (
    budget.maxRetries > 10 || budget.maxOutputBytes > 65536
    || budget.maxDurationMs > 86400000 || budget.turnTimeoutMs > 300000
    || budget.maxActions > 10000 || budget.maxModelCalls > 10000
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now
    || !Number.isSafeInteger(grant.maxActions) || grant.maxActions < budget.maxActions
    || !grant.credentialRef || !grant.grantId || !grant.matchId
  ) throw new DispatchError('invalid_budget');
}
export function validateView(view: SeatObservation, input: DispatchInput): void {
  if (!sameSeat(view, input.binding)) throw new DispatchError('scope_mismatch');
  if (view.matchId !== input.grant.matchId) throw new DispatchError('grant_scope_changed');
  if (!view.allowAgents) throw new DispatchError('agents_not_allowed');
  if (!input.profile.gameIds.includes(view.gameId)) throw new DispatchError('unsupported_game');
  if (
    !Number.isSafeInteger(view.version) || view.version < 0
    || (view.deadline !== null && !Number.isSafeInteger(view.deadline))
  ) {
    throw new DispatchError('invalid_observation');
  }
  boundedJson(view.observation, 262144);
}
export function boundedJson(value: unknown, maxBytes: number): Json {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new DispatchError('invalid_json');
  }
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) {
    throw new DispatchError('json_limit');
  }
  return JSON.parse(text) as Json;
}
export function parseAction(
  text: string,
  requestId: string,
  version: number,
  maxBytes: number,
): Json {
  if (new TextEncoder().encode(text).length > maxBytes) throw new DispatchError('output_limit');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DispatchError('invalid_action_json');
  }
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.requestId !== requestId || value.version !== version
    || !Object.hasOwn(value, 'action')
    || Object.keys(value).some(k => !['requestId', 'version', 'action'].includes(k))
  ) {
    throw new DispatchError('action_envelope_mismatch');
  }
  return boundedJson(value.action, Math.min(maxBytes, 16384));
}
