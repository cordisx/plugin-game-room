// Bundled snapshot of the public isolated-game-ui/v1 types for game authors.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
/** Independent HTML execution capability. Does not extend restricted scene v1. */
export interface GameUiBundleV1 {
  readonly format: 'html-v1'
  readonly bridgeVersion: 1
  readonly entry: string
  readonly assets: Readonly<
    Record<string, {
      readonly mediaType: 'text/html' | 'text/css' | 'text/javascript' | 'image/svg+xml'
      readonly content: string
      readonly sha256: string
    }>
  >
}
export type GameUiRoomActionV1 = 'ready' | 'cancel-ready' | 'start' | 'funding' | 'next-round'
export interface GameUiSnapshotV1 {
  readonly matchId: string
  readonly sequence: number
  readonly observation: Json
  readonly status: string
  readonly canAct: boolean
  readonly readOnly: boolean
  /** Room workflow operations currently authorized by the trusted projection. */
  readonly roomActions?: readonly GameUiRoomActionV1[]
  readonly theme: 'light' | 'dark'
}
export interface GameUiRequestV1 {
  readonly requestId: string
  readonly matchId: string
  readonly sequence: number
  readonly kind: 'action' | 'room-action' | 'exit' | 'next-round'
  readonly payload: Json
}
export interface GameUiReplyV1 {
  readonly status: 'accepted' | 'rejected' | 'uncertain'
  readonly code?: string
}
/** The Host-injected GameUI object available only inside the isolated child. */
export interface GameUiClientV1 {
  readonly version: 1
  subscribe(listener: (snapshot: GameUiSnapshotV1) => void): () => void
  action(payload: Json): Promise<GameUiReplyV1>
  requestRoomAction(operation: Exclude<GameUiRoomActionV1, 'next-round'>): Promise<GameUiReplyV1>
  requestExit(): Promise<GameUiReplyV1>
  requestNextRound(): Promise<GameUiReplyV1>
  reconnect(): void
}
export interface GameUiSeatV1 {
  publish(snapshot: GameUiSnapshotV1): void
  dispose(): void
}
export interface IsolatedGameUiV1 {
  readonly contract: 'cordisx.isolated-game-ui/v1'
  readonly supportedBridgeVersions: readonly [1]
  mount(input: {
    readonly element: HTMLElement
    readonly bundle: GameUiBundleV1
    readonly title: string
    readonly onRequest: (request: GameUiRequestV1) => Promise<GameUiReplyV1>
    readonly onUnavailable?: (code: string) => void
  }): Promise<
    { readonly status: 'accepted'; readonly value: GameUiSeatV1 } | {
      readonly status: 'unavailable'
      readonly code: 'isolation-unavailable' | 'invalid-bundle' | 'disposed' | 'load-failed'
    }
  >
  dispose(): void
}
