import { TokenAmount, TokenIcon } from './token-amount.js'
import { useEffect, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { FundingQuote } from '../data/economy.js'
import type { Seat, Source } from '../data/model.js'
import { quoteExpired } from '../data/confirmation.js'
import { ConfirmationLayout } from './confirmation-layout.js'
import { RoomSummary } from './room-summary.js'
import { Symbol } from './icons.js'
export function FundingPanel({ seat, quote, reserve, busy, refresh, back, sources, unavailable }: {
  seat: Seat
  quote: FundingQuote
  reserve: () => void
  busy: boolean
  refresh?: () => void
  back: () => void
  sources: readonly Source[]
  unavailable?: string
}) {
  const [now, setNow] = useState(Date.now())
  const key = JSON.stringify([quote, seat.room.game.packageHash, seat.room.settlement])
  const expired = quoteExpired(quote.expiresAt, now)
  useEffect(() => {
    setNow(Date.now())
    if (quoteExpired(quote.expiresAt, Date.now())) return
    const timer = setTimeout(() => {
      setNow(Date.now())
    }, Math.min(2147483647, Math.max(0, quote.expiresAt - Date.now() + 1)))
    return () => clearTimeout(timer)
  }, [key])
  const disabled = busy || expired || quote.reserved || !!unavailable
  return (
    <ConfirmationLayout
      label='抵押确认'
      summary={<RoomSummary room={seat.room} sources={sources} />}
      footer={
        <>
          <span className='gr-muted'>
            {quote.reserved
              ? '此账户已确认抵押'
              : expired
              ? '报价已过期，请刷新后重新确认'
              : (
                <>
                  你的 {quote.seatIds.length} 个席位 · <TokenAmount value={quote.amount} />
                </>
              )}
          </span>
          <div className='gr-confirmation-actions'>
            <Button
              variant='ghost'
              className='gr-square-button'
              aria-label='返回对局准备'
              title='返回对局准备'
              disabled={busy}
              onClick={back}
            >
              <Symbol name='back' />
            </Button>
            {expired && refresh && !quote.reserved
              ? (
                <Button variant='primary' className='gr-confirmation-submit' disabled={busy} onClick={refresh}>
                  刷新报价
                </Button>
              )
              : (
                <Button
                  variant='primary'
                  className='gr-confirmation-submit'
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled && !quoteExpired(quote.expiresAt, Date.now())) reserve()
                  }}
                >
                  {quote.reserved ? '已确认抵押' : (
                    <>
                      确认抵押 <TokenAmount value={quote.amount} />
                    </>
                  )}
                </Button>
              )}
          </div>
        </>
      }
    >
      <div className='gr-confirmation-heading'>
        <TokenIcon size='balance' />
        <div>
          <strong>此次抵押确认</strong>
          <p className='gr-muted'>
            虚拟 Token · {seat.room.game.name} · v{seat.room.game.version} · {seat.room.review}
          </p>
        </div>
      </div>
      {unavailable && <p role='status'>{unavailable}</p>}
      <section className='gr-confirmation-section'>
        <h3>你的全部席位</h3>
        <dl className='gr-confirmation-facts'>
          {quote.seatIds.map(id => (
            <div key={id}>
              <dt>{seat.ownedSeats?.find(seat => seat.id === id)?.name ?? id}</dt>
              <dd>
                <TokenAmount value={seat.room.stake} />
              </dd>
            </div>
          ))}
          <div>
            <dt>合计</dt>
            <dd>
              <TokenAmount value={quote.amount} />
            </dd>
          </div>
        </dl>
      </section>
      <section className='gr-confirmation-section'>
        <h3>奖池与结算</h3>
        <dl className='gr-confirmation-facts'>
          <div>
            <dt>总奖池</dt>
            <dd>
              <TokenAmount value={quote.participants.reduce((n, p) => n + p.amount, 0)} />
            </dd>
          </div>
          {quote.poolTerms && (
            <div>
              <dt>游戏轮数</dt>
              <dd>{quote.poolTerms.payload.rounds}</dd>
            </div>
          )}
        </dl>
        <p>
          {quote.poolTerms?.payload.policy === 'remaining-chips'
            ? '1 筹码 = 1 Token。离桌时兑回剩余筹码，本手下注结算后到账。'
            : quote.poolTerms
            ? '结束时胜者分配奖池，平局退回抵押。'
            : '此为历史费用对局，按原条款恢复结算。'}
        </p>
      </section>
      {quote.reserved && <p role='status'>已抵押，等待其他玩家。</p>}
    </ConfirmationLayout>
  )
}
