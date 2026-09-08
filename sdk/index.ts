export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type SettlementPolicy = 'equal-winners-v1' | 'conserved-payouts-v1'
export type Mode = 'score' | 'local-chips' | 'token'
export interface Manifest {
  id: string
  version: string
  name: string
  minPlayers: number
  maxPlayers: number
  modes: Mode[]
  description?: string
  settlementPolicies?: SettlementPolicy[]
}
export interface GamePackage {
  packageVersion: 1
  manifest: Manifest
  rules: string
  ui: { html: string }
}
export interface RuleContext {
  seats: string[]
  config: Json
  seatIndex: number | null
  mode: Mode
  stake: number
  policy: SettlementPolicy
  random(): number
}
export interface GameResult {
  winners: number[]
  scores?: number[]
  payouts?: number[]
}
export interface Transition {
  state: Json
  turn: number | null
  done?: GameResult
}
export interface GameRules {
  setup(ctx: RuleContext): Transition
  act(state: Json, action: Json, ctx: RuleContext): Transition
  timeout(state: Json, ctx: RuleContext): Transition
  observe(state: Json, seatIndex: number, ctx: RuleContext): Json
}
export interface Consent {
  packageHash: string
  stake: number
  policy: SettlementPolicy
  reviewState: 'unreviewed'
}
export interface Seat {
  id: string
  kind: 'human' | 'agent'
  participantId: string | null
  accountId: string
  name: string
  ready: boolean
}
export interface PackageMetadata {
  hash: string
  manifest: Manifest
  publisherId: string
  reviewState: 'unreviewed'
  uiUrl: string
}
export interface RoomCard {
  id: string
  matchId: string
  handNo: number
  serverId: string
  packageHash: string
  manifest: Manifest
  mode: Mode
  config: Json
  maxPlayers: number
  allowAgents: boolean
  turnTimeoutMs: number
  stake: number
  policy: SettlementPolicy
  reviewState: 'unreviewed'
  status: 'waiting' | 'funding' | 'playing' | 'finished' | 'aborted'
  version: number
  seats: Seat[]
  turn: number | null
  deadline: number | null
  result: GameResult | null
  funding: { economyUrl: string; agreementId: string; termsHash: string } | null
  settlement: 'none' | 'pending' | 'reserved' | 'settled' | 'refunded'
}
export interface RoomView extends RoomCard {
  selfSeatId: string
  observation: Json
}
export interface ActionRequest {
  expectedVersion: number
  idempotencyKey: string
  action: Json
}
export interface CreateRoomRequest {
  packageHash: string
  mode: Mode
  config?: Json
  maxPlayers?: number
  allowAgents?: boolean
  turnTimeoutMs?: number
  stake?: number
  consent?: Consent
  policy?: SettlementPolicy
}
