import type { Signed, SpendTerms } from '@cordisx/economy/spend'
export type FundingQuote = {
  signedTerms?: Signed<SpendTerms>
  requestId?: string
  agreementId: string
  termsHash: string
  instanceId: string
  serviceId: string
  accountId: string
  amount: number
  seatIds: string[]
  expiresAt: number
  reserved: boolean
  policy: string
  participants: { accountId: string; amount: number; seatIds: string[] }[]
}
