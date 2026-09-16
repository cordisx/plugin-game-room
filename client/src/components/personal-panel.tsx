import { TokenAmount } from './token-amount.js'
import { PersonalTabs } from './personal-tabs.js'
import { GlobalProfileIdentity } from './global-profile-identity.js'
import { walletBalanceResource } from '../data/wallet-presentation.js'
import { openLedgerPage } from '../data/ledger-navigation.js'
import { useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { Balance, History, Source } from '../data/model.js'
import type { GameRoomPort } from '../data/port.js'
import { type PanelResource, usePanelResource } from '../data/use-panel-resource.js'
import { PanelState } from './panel-state.js'
import { GameIcon, Symbol } from './icons.js'
import '../styles/personal-panel.css'
import { type CurrentUserState } from '../data/current-user-sync.js'
export function PersonalPanel(
  { currentUser, port, epoch, balances, history, sources, replay, navigate, busy }: {
    currentUser?: CurrentUserState
    port: GameRoomPort
    epoch: number
    balances: PanelResource<Balance>
    history: PanelResource<History>
    sources: readonly Source[]
    replay: (record: History) => void
    navigate: (page: string) => void
    busy: boolean
  },
) {
  const [tab, setTab] = useState('overview')
  const canonical = port.walletMode?.() === 'canonical-local'
  const localBalances = walletBalanceResource(port, balances)
  const profiles = usePanelResource(port, signal => port.personalProfiles?.(signal) ?? Promise.resolve([]), epoch)
  const connected = profiles.data.filter(profile => profile.state === 'connected')
  return (
    <div className='gr-personal'>
      <header className='gr-personal-header'>
        <GlobalProfileIdentity currentUser={currentUser} />
      </header>
      {profiles.status === 'loading' && <div role='status' className='gr-panel-loading'>正在读取游戏档案…</div>}
      {profiles.status === 'error' && (
        <div className='gr-panel-message' role='alert'>
          <div className='gr-panel-copy'>
            <strong>
              {profiles.stale ? '档案刷新失败 · 显示上次结果' : connected.length ? '部分档案读取失败' : '档案读取失败'}
            </strong>
            <span className='gr-muted'>{profiles.error}</span>
          </div>
          <Button disabled={profiles.refreshing} onClick={profiles.retry}>重试</Button>
        </div>
      )}
      <PersonalTabs selected={tab} changed={setTab} />
      <div role='tabpanel' id='gr-personal-tab-panel' aria-labelledby={`gr-personal-tab-${tab}`}>
        {tab === 'overview' && (
          <dl className='gr-personal-overview'>
            <div>
              <dt>
                <Symbol name='source' size={16} />游戏来源
              </dt>
              <dd>
                {profiles.status === 'loading'
                  ? '读取中'
                  : profiles.status === 'error'
                  ? connected.length ? `${connected.length} 已连接 · 部分失败` : '读取失败'
                  : `${connected.length} 已连接`}
              </dd>
            </div>
            <div>
              <dt>
                <Symbol name='score' size={16} />已结束对局
              </dt>
              <dd>
                {history.status === 'ready'
                  ? history.data.length
                  : history.status === 'loading'
                  ? '读取中'
                  : '读取失败'}
              </dd>
            </div>
            <div>
              <dt>
                本地资产
              </dt>
              <dd>
                {localBalances.status === 'ready'
                  ? localBalances.data.length
                    ? (
                      <>
                        <TokenAmount value={localBalances.data[0]!.available} />
                        {canonical ? '' : '（测试）'}
                      </>
                    )
                    : '未连接'
                  : localBalances.status === 'loading'
                  ? '读取中'
                  : '读取失败'}
              </dd>
            </div>
          </dl>
        )}
        {tab === 'history' && (
          <section className='gr-personal-section gr-personal-card gr-personal-history' aria-label='近期战绩'>
            <PanelState
              resource={history}
              empty='还没有已结束的对局'
              description={connected.length
                ? '当前进行中的房间不会计入战绩。结束一局后可在这里查看与回放。'
                : '连接游戏来源后，查看属于该游戏账户的战绩。'}
              action={connected.length ? '去大厅' : '查看来源'}
              next={() =>
                navigate(connected.length ? 'lobby' : 'settings')}
            >
              {history.data.map(record => (
                <div className='gr-panel-row' key={`${record.sourceId}/${record.id}`}>
                  <GameIcon id={record.gameName} />
                  <div className='gr-panel-copy'>
                    <strong>{record.roomName}</strong>
                    <span className='gr-muted'>
                      {record.gameName} · {sources.find(source => source.id === record.sourceId)?.name ?? '未加载来源'}
                    </span>
                    <span className='gr-muted'>
                      {record.result} · {record.completedAt && Number.isFinite(Date.parse(record.completedAt))
                        ? new Date(record.completedAt).toLocaleDateString()
                        : '结束时间未提供'}
                    </span>
                  </div>
                  <Button
                    variant='ghost'
                    disabled={busy}
                    onClick={() =>
                      replay(record)}
                  >
                    回放
                  </Button>
                </div>
              ))}
            </PanelState>
          </section>
        )}
        {tab === 'assets' && (
          <section className='gr-personal-section gr-personal-card gr-personal-assets' aria-label='资产'>
            <div className='gr-personal-section-heading'>
              <Button
                variant='ghost'
                onClick={() =>
                  openLedgerPage(navigate)}
              >
                <Symbol name='document' size={16} />查看收支明细
              </Button>
            </div>
            <PanelState
              resource={localBalances}
              empty='钱包尚未连接'
              description={canonical
                ? '连接钱包后查看余额。'
                : '当前为测试模式。'}
              action='查看来源'
              next={() =>
                navigate('settings')}
            >
              {localBalances.data.map((balance, index) => (
                <div className='gr-personal-wallet' key={`${balance.economyId}/${index}`}>
                  {!canonical && <span className='gr-muted'>测试余额</span>}
                  <div className='gr-panel-balances'>
                    <div>
                      <span className='gr-muted gr-personal-metric-label'>
                        可用余额
                      </span>
                      <strong>
                        <TokenAmount value={balance.available} size='balance' />
                      </strong>
                    </div>
                    <div>
                      <span className='gr-muted gr-personal-metric-label'>
                        冻结中
                      </span>
                      <strong>
                        <TokenAmount value={balance.reserved} size='balance' />
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </PanelState>
          </section>
        )}
      </div>
    </div>
  )
}
