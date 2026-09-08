export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Mode = 'score' | 'local-chips' | 'token';
export interface Manifest { id: string; version: string; name: string; minPlayers: number; maxPlayers: number; modes: Mode[]; description?: string }
export interface GamePackage { packageVersion: 1; manifest: Manifest; rules: string; ui: { html: string } }
export interface RuleContext { seats: string[]; config: Json; seatIndex: number | null; random(): number }
export interface GameResult { winners: number[]; scores?: number[] }
export interface Transition { state: Json; turn: number | null; done?: GameResult }
export interface GameRules { setup(ctx: RuleContext): Transition; act(state: Json, action: Json, ctx: RuleContext): Transition; timeout(state: Json, ctx: RuleContext): Transition; observe(state: Json, seatIndex: number, ctx: RuleContext): Json }
export interface Consent { packageHash: string; stake: number; policy: 'equal-winners-v1'; reviewState: 'unreviewed' }
export interface Seat { id: string; accountId: string; name: string; ready: boolean }
export interface PackageMetadata { hash: string; manifest: Manifest; publisherId: string; reviewState: 'unreviewed'; uiUrl: string }
export interface RoomCard { id: string; serverId: string; packageHash: string; manifest: Manifest; mode: Mode; config: Json; maxPlayers: number; allowAgents: boolean; turnTimeoutMs: number; stake: number; policy: 'equal-winners-v1'; reviewState: 'unreviewed'; status: 'waiting' | 'funding' | 'playing' | 'finished' | 'aborted'; version: number; seats: Seat[]; turn: number | null; deadline: number | null; result: GameResult | null; settlement: 'none' | 'pending' | 'reserved' | 'settled' | 'refunded' }
export interface RoomView extends RoomCard { selfSeatId: string; observation: Json }
export interface ActionRequest { expectedVersion: number; idempotencyKey: string; action: Json }
export interface CreateRoomRequest { packageHash: string; mode: Mode; config?: Json; maxPlayers?: number; allowAgents?: boolean; turnTimeoutMs?: number; stake?: number; consent?: Consent }
