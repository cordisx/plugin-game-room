/** Historical wire types for read-only recovery. No service-driven wallet client exists. */
export interface Agreement {
  id: string
  instanceId: string
  serviceId: string
  termsHash: string
  state: 'open' | 'settled' | 'cancelled' | 'expired'
  reservations: string[]
  outcomeId?: string | null
}
export interface FundingTerms {
  matchId: string
  game: {
    id: string
    version: string
    digest: string
    reviewStatus: string
  }
  participants: {
    accountId: string
    amount: number
    participantIds: string[]
  }[]
  settlementPolicy: {
    kind: 'conserved-payouts'
  }
  expiresAt: number
}
export interface EconomyAdapter {
  readonly url: string
  readonly serviceId: string
  readonly instanceId?: string
  redeem(code: string, gameAccountId: string, key: string): Promise<{
    instanceId: string
    accountId: string
    gameServiceId: string
    gameAccountId: string
  }>
  create(terms: FundingTerms, key: string): Promise<Agreement>
  get(id: string): Promise<Agreement>
  settle(id: string, termsHash: string, payouts: {
    accountId: string
    amount: number
  }[], key: string): Promise<Agreement>
  cancel(id: string, key: string): Promise<Agreement>
}
