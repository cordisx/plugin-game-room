import { TokenAmount } from './token-amount.js'
import { RoomInfoHero } from './room-info-hero.js'
import { RoomPlayers } from './room-players.js'
import type { BotChange } from '../data/model.js'
import { RoomInfoTabs } from './room-info-tabs.js'
import { settlementLabel } from '../data/settlement-label.js'
import { useId, useState } from 'cordisx/react'
import { Button, EmptyState, Icon } from 'cordisx/ui'
import type { Room, Source } from '../data/model.js'
import { economyLabel } from '../data/model.js'
import { Symbol } from './icons.js'
import '../styles/confirmation.css'
import '../styles/room-summary.css'
export function RoomSummary(
  { room, sources, busy, bots }: {
    room?: Room
    sources: readonly Source[]
    busy?: boolean
    bots?: (change: BotChange) => void
  },
) {
  const [tab, setTab] = useState('overview')
  const id = useId()
  if (!room) {
    return (
      <aside className='gr-confirmation-summary gr-room-summary'>
        <EmptyState title='选择目标房间' description='选择兼容房间后查看规则、席位和来源。' />
      </aside>
    )
  }
  const source = sources.find(source => source.id === room.sourceId)

  return (
    <aside
      className='gr-confirmation-summary gr-room-summary gr-room-info-surface'
      data-game-theme={room.game.id.includes('gomoku')
        ? 'gomoku'
        : room.game.id.includes('holdem')
        ? 'holdem'
        : undefined}
      aria-label='房间摘要'
    >
      <RoomInfoHero
        gameId={room.game.id}
        gameName={room.game.name}
        title={room.name}
        tabs={<RoomInfoTabs selected={tab} changed={setTab} prefix={`${id}`} panelId={`${id}-panel`} players />}
      />
      <div
        className='gr-confirmation-summary-body'
        role='tabpanel'
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        tabIndex={0}
      >
        {tab === 'players' && <RoomPlayers room={room} busy={busy} bots={bots} />}
        {tab === 'overview' && (
          <>
            <dl className='gr-confirmation-facts'>
              <div>
                <dt>
                  <span className='gr-summary-fact-icon'>
                    <Symbol name='personal' size={16} />
                  </span>
                  <span>参与玩家</span>
                </dt>
                <dd>{room.occupied} / {room.capacity}</dd>
              </div>
              <div>
                <dt>
                  <span className='gr-summary-fact-icon'>
                    <Symbol name='score' size={16} />
                  </span>
                  <span>计分方式</span>
                </dt>
                <dd>{economyLabel(room.mode)}</dd>
              </div>
              <div>
                <dt>
                  <Icon className='gr-summary-fact-icon' name='host:tags' />
                  <span>每席位费用</span>
                </dt>
                <dd>{room.mode === 'token' ? <TokenAmount value={room.stake} /> : '无需投入资产'}</dd>
              </div>
              <div>
                <dt>
                  <span className='gr-summary-fact-icon'>
                    <Symbol name='source' size={16} />
                  </span>
                  <span>服务器</span>
                </dt>
                <dd>{source?.name ?? '未加载来源'}</dd>
              </div>
            </dl>
            <p className='gr-muted'>
              {room.allowAgents ? '允许 Agent' : '仅玩家参与'} ·{' '}
              {room.game.spectating ? '允许观战 · 仅公共信息' : '未开放观战'}
            </p>
          </>
        )}
        {tab === 'rules' && (
          <>
            <p className='gr-confirmation-prose'>{room.rules}</p>
            <p>{settlementLabel(room.settlement, room.mode)}</p>
            <p className='gr-muted'>{room.review}</p>
          </>
        )}
        {tab === 'source' && (
          <>
            <strong>{source?.name ?? '未加载来源'}</strong>
            <p className='gr-code'>{source?.url ?? room.sourceId}</p>
            <p>v{room.game.version} · {room.game.publisherId}</p>
            <p className='gr-code'>包：{room.game.packageHash}</p>
            <p className='gr-code'>房间：{room.id}</p>
            <p className='gr-code'>结算策略：{room.settlement}</p>
          </>
        )}
      </div>
    </aside>
  )
}
export function RoomTerms({ room }: { room: Room }) {
  return (
    <>
      <dl className='gr-confirmation-facts'>
        <div>
          <dt>游戏版本</dt>
          <dd>{room.game.name} · v{room.game.version}</dd>
        </div>
        <div>
          <dt>审核状态</dt>
          <dd>{room.review}</dd>
        </div>
      </dl>
      <section className='gr-confirmation-section'>
        <h3>玩法规则</h3>
        <p className='gr-confirmation-prose'>{room.rules}</p>
      </section>
      <section className='gr-confirmation-section'>
        <h3>计分与费用</h3>
        <dl className='gr-confirmation-facts'>
          <div>
            <dt>计分方式</dt>
            <dd>{economyLabel(room.mode)}</dd>
          </div>
          <div>
            <dt>每席位费用</dt>
            <dd>{room.mode === 'token' ? <TokenAmount value={room.stake} /> : '无需投入资产'}</dd>
          </div>
        </dl>
        <p>{settlementLabel(room.settlement, room.mode)}</p>
      </section>
    </>
  )
}
