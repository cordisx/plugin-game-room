import type { ReactElement } from 'cordisx/react'
import { useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { FundingQuote } from '../data/economy.js'
import type { Seat } from '../data/model.js'
export function FundingPanel(
  { seat, quote, reserve, busy }: { seat: Seat; quote: FundingQuote; reserve: () => void; busy: boolean },
): ReactElement {
  const [accepted, setAccepted] = useState(false)
  return (
    <div className='gr-detail'>
      <div className='gr-record'>
        <strong>{seat.room.name} · 此次投入确认</strong>
        <span>虚拟 Token · 经济实例 {quote.instanceId}</span>
        <span>游戏服务 {quote.serviceId}</span>
        <span>{seat.room.game.name} · v{seat.room.game.version} · {seat.room.review}</span>
        <span className='gr-code'>包 {seat.room.game.packageHash}</span>
      </div>
      <div className='gr-record'>
        <strong>你的 {quote.seatIds.length} 个席位 · 合计 {quote.amount} Token</strong>
        {quote.seatIds.map(id => (
          <span key={id}>{seat.ownedSeats?.find(seat => seat.id === id)?.name ?? id} · {seat.room.stake} Token</span>
        ))}
        <span className='gr-muted'>账户 {quote.accountId}</span>
      </div>
      <div className='gr-record'>
        <strong>分配与退款规则</strong>
        <span>{seat.room.settlement}</span>
        <p>游戏服务决定参与账户间的守恒分配。审核标记不保证玩法公平；其他账户无法获得额外铸币。</p>
        <span>条款到期：{new Date(quote.expiresAt).toLocaleString()}</span>
        <span className='gr-code'>条款哈希 {quote.termsHash}</span>
        <span>
          全桌投入 {quote.participants.reduce((sum, row) => sum + row.amount, 0)} Token · {quote.participants.length}
          {' '}
          个账户
        </span>
      </div>
      {quote.reserved ? <p role='status'>此账户已按该条款投入，等待其他账户。</p> : (
        <>
          <label className='gr-check'>
            <input
              type='checkbox'
              checked={accepted}
              onChange={event => setAccepted(event.target.checked)}
            />我确认以上全部席位、累计投入和分配权限
          </label>
          <Button variant='primary' disabled={!accepted || busy} onClick={reserve}>
            确认投入 {quote.amount} 虚拟 Token
          </Button>
        </>
      )}
    </div>
  )
}
