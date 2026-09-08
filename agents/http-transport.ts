import { DispatchError } from './types.ts';
import type { Json, SeatGrant, SeatObservation, SeatTransport } from './types.ts';

export interface AuthorizedSeatHttp {
  /** Host or trusted server adapter binds origin and credentialRef, denies redirects, bounds body size. */
  request(input: {
    serverId: string;
    credentialRef: string;
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    body?: Json;
    signal: AbortSignal;
  }): Promise<{ status: number; body: unknown; }>;
}

function project(value: unknown, grant: SeatGrant): SeatObservation {
  if (!value || typeof value !== 'object') throw new DispatchError('invalid_response');
  const v = value as Record<string, unknown>;
  const seats = v.seats as { id: string; accountId: string; }[];
  const manifest = v.manifest as { id: string; };
  const seat = Array.isArray(seats) && seats.find(s => s.id === grant.seatId);
  if (
    v.id !== grant.roomId || v.serverId !== grant.serverId || v.matchId !== grant.matchId
    || v.selfSeatId !== grant.seatId || !seat || seat.accountId !== grant.accountId
    || !manifest || typeof manifest.id !== 'string' || typeof v.allowAgents !== 'boolean'
    || !['waiting', 'funding', 'playing', 'finished', 'aborted'].includes(String(v.status))
    || typeof v.version !== 'number' || (v.deadline !== null && typeof v.deadline !== 'number')
    || (v.turn !== null
      && (!Number.isInteger(v.turn) || Number(v.turn) < 0 || Number(v.turn) >= seats.length))
    || !Object.hasOwn(v, 'observation')
  ) throw new DispatchError('scope_or_response_mismatch');
  return {
    matchId: grant.matchId,
    serverId: grant.serverId,
    roomId: grant.roomId,
    seatId: grant.seatId,
    accountId: grant.accountId,
    gameId: manifest.id,
    allowAgents: v.allowAgents,
    status: v.status as SeatObservation['status'],
    version: v.version,
    deadline: v.deadline as number | null,
    isOurTurn: v.turn !== null && seats[Number(v.turn)]?.id === grant.seatId,
    observation: v.observation as Json,
  };
}
export function createSeatHttpTransport(http: AuthorizedSeatHttp): SeatTransport {
  async function request(
    grant: SeatGrant,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    signal: AbortSignal,
    body?: Json,
  ) {
    let response;
    try {
      response = await http.request({
        serverId: grant.serverId,
        credentialRef: grant.credentialRef,
        method,
        path,
        signal,
        body,
      });
    } catch (error) {
      if (error instanceof DispatchError) throw error;
      throw new DispatchError('network_unavailable', true);
    }
    if (response.status < 200 || response.status >= 300) {
      const code = (response.body as { error?: { code?: unknown; }; })?.error?.code;
      // Do not reflect server error text or tokens into UI events.
      const known = [
        'version_conflict',
        'idempotency_conflict',
        'grant_revoked',
        'grant_expired',
        'grant_budget_exhausted',
        'grant_scope_changed',
        'invalid_action',
      ];
      throw new DispatchError(
        typeof code === 'string' && known.includes(code) ? code : 'server_rejected',
        response.status >= 500 || response.status === 429,
      );
    }
    return response.body;
  }
  return {
    async observe(grant, signal) {
      return project(await request(grant, 'GET', '/v1/agent/observation', signal), grant);
    },
    async submit(grant, action, signal) {
      return project(
        await request(grant, 'POST', '/v1/agent/actions', signal, { ...action }),
        grant,
      );
    },
    async revoke(grant, signal) {
      await request(grant, 'POST', '/v1/agent/revoke', signal, {});
    },
  };
}
