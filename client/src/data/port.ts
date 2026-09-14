import type {
  Agent,
  Balance,
  Consent,
  CreateRoom,
  Dispatch,
  History,
  Invitation,
  LedgerRecord,
  PersonalProfile,
  Seat,
  Source,
  SourceSnapshot,
} from './model.js'
/** Internal boundary, not a published server protocol. Adapters must bind every operation to one source. */
export interface GameRoomPort {
  economyAvailable?(sourceId: string): boolean
  walletMode?(): import('./wallet-lifecycle.js').WalletMode
  walletStatus?(): 'ready' | 'unavailable'
  gameUi?(room: import('./model.js').Room, signal: AbortSignal): Promise<unknown>
  gameUiPackage?(sourceId: string, packageHash: string, signal: AbortSignal): Promise<unknown>
  spectate?(room: import('./model.js').Room, signal: AbortSignal): Promise<import('./model.js').SpectatorView>
  prepareSource?(source: Source, signal: AbortSignal): Promise<void>
  usesCodexAccount?(sourceId: string): boolean
  allowsGuests?(sourceId: string): boolean
  capabilities?(): { account: boolean; agent: { available: boolean; reason?: string } }
  economyLinked?(sourceId: string, signal: AbortSignal): Promise<boolean>
  connectEconomy?(sourceId: string, signal: AbortSignal): Promise<void>
  linkEconomy?(sourceId: string, signal: AbortSignal): Promise<void>
  quote?(seat: Seat, signal: AbortSignal): Promise<import('./economy.js').FundingQuote>
  reserve?(seat: Seat, quote: import('./economy.js').FundingQuote, signal: AbortSignal): Promise<void>
  isConnected?(sourceId: string): boolean
  connectionKind?(sourceId: string): 'guest' | 'account' | undefined
  connect?(sourceId: string, mode?: 'account'): Promise<void>
  disconnect?(sourceId: string): Promise<void>
  publish?(sourceId: string, document: Record<string, unknown>, digest: string, signal: AbortSignal): Promise<void>
  refreshSeat?(seat: Seat, signal: AbortSignal): Promise<Seat>
  roomBots?(room: import('./model.js').Room, change: import('./model.js').BotChange, signal: AbortSignal): Promise<Seat>
  bots?(
    seat: Seat,
    change: { add: true; seatIndex: number } | { removeSeatId: string },
    signal: AbortSignal,
  ): Promise<Seat>
  start?(seat: Seat, signal: AbortSignal): Promise<Seat>
  nextMatch?(seat: Seat, signal: AbortSignal): Promise<Seat>
  act?(seat: Seat, action: unknown, signal: AbortSignal): Promise<Seat>
  readonly kind: 'sample' | 'live'
  sources: readonly Source[]
  list(source: Source, signal: AbortSignal): Promise<SourceSnapshot>
  create(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Invitation>
  join(invitation: Invitation, signal: AbortSignal): Promise<Seat>
  ready(seat: Seat, ready: boolean, consent: Consent | undefined, signal: AbortSignal): Promise<Seat>
  leave(seat: Seat, signal: AbortSignal): Promise<void>
  agents(signal: AbortSignal): Promise<Agent[]>
  dispatches(signal: AbortSignal): Promise<Dispatch[]>
  dispatch(
    agentId: string,
    invitation: Invitation,
    budget: number,
    signal: AbortSignal,
    consent?: Consent,
  ): Promise<Dispatch>
  withdraw(dispatch: Dispatch, signal: AbortSignal): Promise<void>
  ledger?(signal: AbortSignal): Promise<LedgerRecord[]>
  personalProfiles?(signal: AbortSignal): Promise<PersonalProfile[]>
  balances(signal: AbortSignal): Promise<Balance[]>
  history(signal: AbortSignal): Promise<History[]>
  replay(record: History, signal: AbortSignal): Promise<import('./model.js').ReplayEvent[]>
  dispose(): void | Promise<void>
}
