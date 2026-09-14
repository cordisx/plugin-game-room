import { TokenAmount } from './token-amount.js'
import { walletBalanceResource, walletLedgerResource } from '../data/wallet-presentation.js'
import { type PanelResource, usePanelResource } from '../data/use-panel-resource.js'
import type { GameRoomPort } from '../data/port.js'
import type { Balance, Source } from '../data/model.js'
import { PanelState, RecordDetails } from './panel-state.js'
import { ledgerMovement } from '../data/ledger-presentation.js'
import '../styles/ledger-panel.css'
export function LedgerPanel({ port, epoch, balances, sources, navigate }: {
  port: GameRoomPort
  epoch: number
  balances: PanelResource<Balance>
  sources: readonly Source[]
  navigate: (page: string) => void
}) {
  const ledger = usePanelResource(port, signal => port.ledger?.(signal) ?? Promise.resolve([]), epoch)
  const canonical = port.walletMode?.() === 'canonical-local'
  const localBalances = walletBalanceResource(port, balances)
  const localLedger = walletLedgerResource(port, ledger, localBalances)
  return (
    <div className='gr-ledger'>
      <section className='gr-ledger-summary' aria-label='账户余额概览'>
        <PanelState
          resource={localBalances}
          empty='钱包尚未连接'
          description={canonical
            ? '连接钱包后查看余额和收支。'
            : '当前为测试模式。'}
          action='查看来源'
          next={() => navigate('settings')}
        >
          {localBalances.data.map((balance, index) => (
            <div className='gr-ledger-wallet' key={`${balance.economyId}/${index}`}>
              {!canonical && <span className='gr-muted'>测试余额</span>}
              <div className='gr-panel-balances'>
                <div>
                  <span className='gr-muted'>可用余额</span>
                  <strong>
                    <TokenAmount value={balance.available} size='balance' />
                  </strong>
                </div>
                <div>
                  <span className='gr-muted'>冻结中</span>
                  <strong>
                    <TokenAmount value={balance.reserved} size='balance' />
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </PanelState>
      </section>
      <section className='gr-ledger-records' aria-label='收支明细'>
        <div className='gr-ledger-heading'>
          <h2>最近收支</h2>
          <span className='gr-muted'>账户最近 200 条记录</span>
        </div>
        <PanelState
          resource={localLedger}
          unavailable={!port.ledger ? '收支记录暂时不可用。' : undefined}
          empty={localBalances.data.length ? '最近没有收支记录' : '尚无可读取的账本'}
          description={localBalances.data.length
            ? '收入和支出会显示在这里。'
            : '连接钱包后查看收支。'}
          action='查看来源'
          next={() => navigate('settings')}
        >
          {localLedger.data.map(row => {
            const movement = ledgerMovement(row)
            return (
              <div className='gr-panel-row' key={`${row.economyId}/${row.accountId}/${row.sequence}`}>
                <div className='gr-panel-copy'>
                  <strong>
                    {movement.label} · {row.reference === 'local-test-initial-credit:initial-1000'
                      ? '本地测试初始额度'
                      : row.reason}
                  </strong>
                  <span className='gr-muted'>
                    {sources.find(source => source.id === row.sourceId)?.name
                      ?? (row.sourceId === 'economy:canonical' ? '本地钱包' : '未加载游戏来源')} · {row.economyId} ·
                    {' '}
                    {row.accountId} · {new Date(row.createdAt).toLocaleString()}
                  </span>
                  {row.reference && <span className='gr-muted'>关联：{row.reference}</span>}
                </div>
                <strong>
                  <TokenAmount value={movement.amount} signed={movement.label === '收入'} />
                </strong>
                <RecordDetails label='查看账本标识'>
                  <span>实例：{row.economyId}</span>
                  <span>交易：{row.transactionId}</span>
                  <span>账户：{row.accountId}</span>
                  <span>
                    可用变化：<TokenAmount value={row.availableDelta} signed />
                  </span>
                  <span>
                    冻结变化：<TokenAmount value={row.reservedDelta} signed />
                  </span>
                </RecordDetails>
              </div>
            )
          })}
        </PanelState>
      </section>
    </div>
  )
}
