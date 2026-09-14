import type { GameConfigSchema } from './game-config.mjs'
import type { HtmlUi } from './html-ui.mjs'
import type { Scene } from './scene.js'
export { parseScene, sceneLimits } from './scene.js'
export type { Scene, SceneNode, ViewContext } from './scene.js'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type SettlementPolicy = 'equal-winners-v1' | 'conserved-payouts-v1'
export type Mode = 'score' | 'local-chips' | 'token'
export interface Manifest {
  waitingUi?: boolean
  rulesBot?: 'rules-bot-v1'
  spectating?: boolean
  minimumViewport?: { width: number; height: number }
  configSchema?: GameConfigSchema
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
  /** Optional isolated policy: globalThis.bot(observation, ViewContext) returns one action.
   * Source is hashed with the immutable package; no rules/state/seed are supplied. */
  bot?: { format: 'rules-bot-v1'; source: string }
  rules: string
  ui: { format: 'scene-v1'; render: string } | HtmlUi
}
export interface RuleContext {
  participants?: { name: string; kind: Seat['kind'] }[]
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
/** Platform observation before authoritative setup; HTML UIs render their own waiting surface. */
export interface WaitingObservation {
  phase: 'waiting' | 'funding'
  selfSeat: number | null
  config: Json
  capacity: number
  minPlayers: number
  participants: { seat: number; name: string; kind: Seat['kind']; ready: boolean }[]
  legalActions: []
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
  /** Stable physical chair; absent on legacy rooms (array ordinal fallback). */
  seatIndex?: number
  id: string
  kind: 'human' | 'agent' | 'bot'
  participantId: string | null
  accountId: string
  /** Optional bounded inline display avatar; not an identity credential. */
  avatar?: string
  name: string
  ready: boolean
}
export interface PackageMetadata {
  hash: string
  manifest: Manifest
  publisherId: string
  reviewState: 'unreviewed'
  uiUrl: string
  uiSha256: string
  uiFormat: 'scene-v1' | 'html-v1'
}
export interface EconomyIdentity {
  instanceId: string
  gameServiceId: string
  url: string
}
export interface RoomCard {
  creatorAccountId: string
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
  walletSpend?: {
    protocol: 'economy.spend/v1'
    termsHash: string | null
    acceptBefore: number | null
    phase: 'waiting' | 'funding' | 'active' | 'capture' | 'refund'
  }
  economyIdentity: EconomyIdentity | null
  funding: { economyUrl: string; agreementId: string; termsHash: string } | null
  settlement: 'none' | 'pending' | 'reserved' | 'settled' | 'refunded'
}
export type SceneError = 'ui_render_failed' | 'ui_scene_invalid' | 'observation_failed'
export interface RoomView extends RoomCard {
  selfSeatId: string
  observation: Json
  scene: Scene | null
  sceneError: SceneError | null
}
export interface ActionRequest {
  expectedVersion: number
  idempotencyKey: string
  action: Json
}
export interface CreateRoomRequest {
  botCount?: number
  packageHash: string
  mode: Mode
  config?: Json
  /** Total seat capacity (creator + humans + rules bots + Agents), excluding spectators. Defaults to manifest maximum. */
  maxPlayers?: number
  allowAgents?: boolean
  turnTimeoutMs?: number
  stake?: number
  consent?: Consent
  policy?: SettlementPolicy
}
