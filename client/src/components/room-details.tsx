import { TokenAmount, TokenIcon } from './token-amount.js'
import { RoomInfoHero } from './room-info-hero.js'
import { RoomPlayers } from './room-players.js'
import type { BotChange } from '../data/model.js'
import { RoomInfoTabs } from './room-info-tabs.js'
import { AGENT_DISPATCH_ENABLED } from '../data/features.js'
import { settlementLabel } from '../data/settlement-label.js'
import { useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { Room, Source } from '../data/model.js'
import { economyLabel, encodeInvitation } from '../data/model.js'
import { Symbol } from './icons.js'
import '../styles/room-details.css'
export function RoomDetails(
  { room, sources, busy, join, close, dispatch, watch, bots }: {
    bots?: (change: BotChange) => void
    watch?: () => void
    room: Room
    sources: Source[]
    busy: boolean
    join: () => void
    close: () => void
    dispatch: () => void
  },
) {
  const [tab, setTab] = useState<string>('overview')
  const [copyStatus, setCopyStatus] = useState('')
  const available = room.compatible && room.state === 'waiting' && room.occupied < room.capacity
  const status = !room.compatible
    ? '版本不兼容'
    : room.owned
    ? '已加入'
    : room.state === 'finished'
    ? '已结束'
    : room.state === 'playing'
    ? '进行中'
    : available
    ? '等待玩家'
    : '已满'
  const source = sources.find(source => source.id === room.sourceId)
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, sources))
      setCopyStatus('邀请已复制')
    } catch {
      setCopyStatus('复制失败，可在来源页签手动复制')
      setTab('source')
    }
  }
  return (
    <aside
      className='gr-room-inspector gr-room-info-surface'
      data-game-theme={room.game.id.includes('gomoku')
        ? 'gomoku'
        : room.game.id.includes('holdem')
        ? 'holdem'
        : undefined}
      aria-label='房间详情'
    >
      <RoomInfoHero
        gameId={room.game.id}
        gameName={room.game.name}
        title={room.name}
        tabs={<RoomInfoTabs selected={tab} changed={setTab} prefix='room-tab' panelId='room-detail-content' players />}
        actions={
          <>
            <Button
              variant='ghost'
              className='gr-toolbar-icon'
              aria-label='复制房间邀请'
              title='复制房间邀请'
              onClick={() => void copyInvitation()}
            >
              <Symbol name='link' size={16} />
            </Button>
            <Button variant='ghost' className='gr-toolbar-icon' aria-label='关闭房间详情' title='关闭' onClick={close}>
              <Symbol name='close' size={16} />
            </Button>
          </>
        }
      />
      <div
        className='gr-inspector-content'
        role='tabpanel'
        id='room-detail-content'
        aria-labelledby={`room-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'players' && <RoomPlayers room={room} busy={busy} bots={bots} />}
        {tab === 'overview' && (
          <>
            <dl>
              <div>
                <dt>
                  <Symbol name='score' size={15} />计分方式
                </dt>
                <dd>{economyLabel(room.mode)}</dd>
              </div>
              <div>
                <dt>
                  {room.mode === 'token' ? <TokenIcon /> : <Symbol name='coins' size={15} />}每人抵押
                </dt>
                <dd>
                  {room.mode === 'token'
                    ? <TokenAmount value={room.stake} />
                    : room.stake > 0
                    ? room.stake
                    : '无需投入'}
                </dd>
              </div>
              <div>
                <dt>
                  <Symbol name='source' size={15} />服务器
                </dt>
                <dd>
                  <Button
                    variant='ghost'
                    className='gr-inspector-source-link'
                    title='查看来源与版本'
                    onClick={() => setTab('source')}
                  >
                    {source?.name ?? room.sourceId}
                    <Symbol name='external' size={14} />
                  </Button>
                </dd>
              </div>
              <div>
                <dt>
                  <Symbol name='agent' size={15} />Agent
                </dt>
                <dd>{room.allowAgents ? '允许加入' : '不允许加入'}</dd>
              </div>
            </dl>
            <p className='gr-inspector-muted'>{room.review}</p>
            {!room.compatible && <p role='status'>{room.compatibilityReason ?? '当前版本无法参与此房间'}</p>}
          </>
        )}
        {tab === 'rules' && (
          <>
            <h3>
              <Symbol name='document' size={15} />玩法规则
            </h3>
            <p>{room.rules || '房间未提供规则说明'}</p>
            <h3>
              {room.mode === 'token' ? <TokenIcon /> : <Symbol name='coins' size={15} />}结算约定
            </h3>
            <p>{settlementLabel(room.settlement, room.mode)}</p>
            <p className='gr-inspector-muted'>入座后确认抵押，结束时按游戏结果分配。</p>
          </>
        )}
        {tab === 'source' && (
          <>
            <dl>
              <div>
                <dt>
                  <Symbol name='source' size={15} />服务器
                </dt>
                <dd>{source?.name ?? room.sourceId}</dd>
              </div>
              <div>
                <dt>
                  <Symbol name='document' size={15} />游戏版本
                </dt>
                <dd>{room.game.version}</dd>
              </div>
            </dl>
            <h3>
              <Symbol name='personal' size={15} />发布者
            </h3>
            <code>{room.game.publisherId}</code>
            <h3 className='gr-inspector-copy-heading'>
              <span>
                <Symbol name='document' size={15} />游戏包校验
              </span>
              <Button
                variant='ghost'
                className='gr-square-button'
                aria-label='复制游戏包哈希'
                title='复制游戏包哈希'
                onClick={() =>
                  void navigator.clipboard.writeText(room.game.packageHash).then(
                    () => setCopyStatus('校验信息已复制'),
                    () => setCopyStatus('复制失败，请手动选择校验信息'),
                  )}
              >
                <Symbol name='copy' size={15} />
              </Button>
            </h3>
            <code>{room.game.packageHash}</code>
            <h3>结算策略标识</h3>
            <code>{room.settlement}</code>
            <h3 className='gr-inspector-copy-heading'>
              <span>
                <Symbol name='link' size={15} />邀请信息
              </span>
              <Button
                variant='ghost'
                className='gr-square-button'
                aria-label='复制邀请信息'
                title='复制邀请信息'
                onClick={() => void copyInvitation()}
              >
                <Symbol name='copy' size={15} />
              </Button>
            </h3>
            <textarea
              readOnly
              aria-label='邀请信息'
              value={encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, sources)}
            />
          </>
        )}
      </div>
      <footer className='gr-inspector-footer'>
        <p className='gr-inspector-muted' role='status'>
          {copyStatus
            || (room.mode === 'token'
              ? (
                <>
                  <TokenAmount value={room.stake} /> · 加入后确认抵押
                </>
              )
              : economyLabel(room.mode))}
        </p>
        <div>
          <Button className='gr-inspector-join' disabled={busy || (!available && !room.owned)} onClick={join}>
            {room.owned ? '返回房间' : available ? '加入房间' : status}
          </Button>
          {room.game.spectating && watch && (
            <Button variant='ghost' className='gr-square-button' aria-label='观战' title='观战' onClick={watch}>
              <Symbol name='watch' />
            </Button>
          )}
          {AGENT_DISPATCH_ENABLED && room.allowAgents && available && (
            <Button
              variant='ghost'
              className='gr-square-button'
              disabled={busy}
              aria-label='派遣 Agent'
              title='派遣 Agent'
              onClick={dispatch}
            >
              <span className='gr-card-symbol' data-icon='agent' />
            </Button>
          )}
        </div>
      </footer>
    </aside>
  )
}
