import type {
  Agent,
  Balance,
  Consent,
  CreateRoom,
  Dispatch,
  History,
  Invitation,
  Seat,
  Source,
  SourceSnapshot,
} from './model.js'
/** Internal boundary, not a published server protocol. Adapters must bind every operation to one source. */
export interface GameRoomPort {
  readonly kind: 'sample' | 'live'
  sources: readonly Source[]
  list(source: Source, signal: AbortSignal): Promise<SourceSnapshot>
  create(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Invitation>
  join(invitation: Invitation, signal: AbortSignal): Promise<Seat>
  ready(seat: Seat, consent: Consent, signal: AbortSignal): Promise<Seat>
  leave(seat: Seat, signal: AbortSignal): Promise<void>
  agents(signal: AbortSignal): Promise<Agent[]>
  dispatches(signal: AbortSignal): Promise<Dispatch[]>
  dispatch(agentId: string, invitation: Invitation, budget: number, signal: AbortSignal): Promise<Dispatch>
  withdraw(dispatch: Dispatch, signal: AbortSignal): Promise<void>
  balances(signal: AbortSignal): Promise<Balance[]>
  history(signal: AbortSignal): Promise<History[]>
  replay(record: History, signal: AbortSignal): Promise<{ turn: number; description: string }[]>
  dispose(): void
}
