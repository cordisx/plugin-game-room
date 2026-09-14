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
  const [acceptedKey, setAcceptedKey] = useState('')
  const [now, setNow] = useState(Date.now())
  const key = JSON.stringify([quote, seat.room.game.packageHash, seat.room.settlement])
  const accepted = acceptedKey === key
  const expired = quoteExpired(quote.expiresAt, now)
  useEffect(() => {
    setAcceptedKey('')
    setNow(Date.now())
    if (quoteExpired(quote.expiresAt, Date.now())) return
    const timer = setTimeout(() => {
      setNow(Date.now())
      setAcceptedKey('')
    }, Math.min(2147483647, Math.max(0, quote.expiresAt - Date.now() + 1)))
    return () => clearTimeout(timer)
  }, [key])
  const disabled = !accepted || busy || expired || quote.reserved || !!unavailable
  return (
    <ConfirmationLayout
      label='费用确认'
      summary={<RoomSummary room={seat.room} sources={sources} />}
      footer={
        <>
          <span className='gr-muted'>
            {quote.reserved
              ? '此账户已确认费用'
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
                  {quote.reserved ? '已确认费用' : (
                    <>
                      确认费用 <TokenAmount value={quote.amount} />
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
          <strong>此次费用确认</strong>
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
        <h3>费用与释放规则</h3>
        <p>每个账户只承担自己的费用。正常结束扣除此费用，取消后退回原冻结费用。胜负计入分数或本局筹码。</p>
        <p className='gr-muted'>审核标记不保证玩法公平。请确认以上全部席位、累计费用与费用规则。</p>
        <dl className='gr-confirmation-facts'>
          <div>
            <dt>全桌费用</dt>
            <dd>
              <TokenAmount value={quote.participants.reduce((sum, row) => sum + row.amount, 0)} /> ·{' '}
              {quote.participants.length} 个账户
            </dd>
          </div>
          <div>
            <dt>条款到期</dt>
            <dd>{new Date(quote.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>
      <details className='gr-confirmation-ids'>
        <summary>查看来源与条款标识</summary>
        <p>本地钱包：{quote.instanceId}</p>
        <p>游戏服务：{quote.serviceId}</p>
        <p>账户：{quote.accountId}</p>
        <p>条款：{quote.termsHash}</p>
        <p>包：{seat.room.game.packageHash}</p>
        <p>结算策略：{seat.room.settlement}</p>
      </details>
      {quote.reserved
        ? <p role='status'>此账户已确认本局费用，等待其他账户。</p>
        : expired
        ? <p role='status'>报价已过期，请刷新报价后重新确认。</p>
        : (
          <label className='gr-confirmation-consent'>
            <input
              type='checkbox'
              checked={accepted}
              disabled={busy || !!unavailable}
              onChange={event => setAcceptedKey(event.target.checked ? key : '')}
            />我确认以上全部席位、累计费用和费用与退款规则
          </label>
        )}
    </ConfirmationLayout>
  )
}
