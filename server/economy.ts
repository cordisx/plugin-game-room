import type { RoomCard } from '../sdk/index.js'
import { ApiError, requireThat } from './errors.js'
export interface Agreement {
  id: string
  termsHash: string
  state: 'open' | 'settled' | 'cancelled' | 'expired'
  reservations: string[]
}
export interface FundingTerms {
  matchId: string
  game: { id: string; version: string; digest: string; reviewStatus: string }
  participants: { accountId: string; amount: number; participantIds: string[] }[]
  settlementPolicy: { kind: 'conserved-payouts' }
  expiresAt: number
}
export interface EconomyAdapter {
  readonly url: string
  readonly serviceId: string
  redeem(
    code: string,
    gameAccountId: string,
    key: string,
  ): Promise<{ instanceId: string; accountId: string; gameServiceId: string; gameAccountId: string }>
  create(terms: FundingTerms, key: string): Promise<Agreement>
  get(id: string): Promise<Agreement>
  settle(
    id: string,
    termsHash: string,
    payouts: { accountId: string; amount: number }[],
    key: string,
  ): Promise<Agreement>
  cancel(id: string, key: string): Promise<Agreement>
}
export class HttpEconomy implements EconomyAdapter {
  constructor(readonly url: string, private serviceToken: string, readonly serviceId: string) {
    const parsed = new URL(url)
    requireThat(
      parsed.protocol === 'https:'
        || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)),
      'insecure_economy_url',
    )
  }
  private async request(path: string, method: string, token: string, body?: unknown, key?: string): Promise<unknown> {
    const response = await fetch(new URL(`v1/${path}`, this.url.endsWith('/') ? this.url : this.url + '/'), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    })
    if (!response.ok) throw new ApiError(503, 'economy_unavailable')
    return response.json()
  }
  async redeem(code: string, gameAccountId: string, key: string) {
    return await this.request('link-proofs/redeem', 'POST', this.serviceToken, { code, gameAccountId }, key) as {
      instanceId: string
      accountId: string
      gameServiceId: string
      gameAccountId: string
    }
  }
  async create(terms: FundingTerms, key: string) {
    return await this.request('agreements', 'POST', this.serviceToken, terms, key) as Agreement
  }
  async get(id: string) {
    return await this.request(`agreements/${encodeURIComponent(id)}`, 'GET', this.serviceToken) as Agreement
  }
  async settle(id: string, termsHash: string, payouts: { accountId: string; amount: number }[], key: string) {
    return await this.request(
      'settle',
      'POST',
      this.serviceToken,
      { agreementId: id, termsHash, payouts },
      key,
    ) as Agreement
  }
  async cancel(id: string, key: string) {
    return await this.request(
      'cancel',
      'POST',
      this.serviceToken,
      { agreementId: id, reason: 'game_aborted' },
      key,
    ) as Agreement
  }
}
export function payouts(room: RoomCard): number[] {
  const pot = room.stake * room.seats.length
  if (room.policy === 'conserved-payouts-v1') {
    const amounts = room.result?.payouts
    requireThat(
      Array.isArray(amounts) && amounts.length === room.seats.length && amounts.every(n =>
        Number.isSafeInteger(n) && n >= 0
      ) && amounts.reduce((a, b) => a + b, 0) === pot,
      'invalid_payouts',
      422,
    )
    return amounts
  }
  const winners = [...(room.result?.winners ?? [])].sort((a, b) => a - b)
  if (!winners.length) return room.seats.map(() => room.stake)
  const result = room.seats.map(() => 0)
  winners.forEach((seat, index) => {
    result[seat] = Math.floor(pot / winners.length) + (index < pot % winners.length ? 1 : 0)
  })
  return result
}
