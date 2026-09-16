import { TokenAmount, TokenIcon } from './token-amount.js'
import { RoomInfoHero } from './room-info-hero.js'
import { RoomInfoTabs } from './room-info-tabs.js'
import { settlementLabel } from '../data/settlement-label.js'
import { useState } from 'cordisx/react'
import type { EconomyMode, Game, Source } from '../data/model.js'
import { economyLabel } from '../data/model.js'
import { Symbol } from './icons.js'
export function CreateRoomPreview({ game, name, source, mode, stake, agents, config }: {
  game?: Game
  name: string
  source?: Source
  mode: EconomyMode
  stake: string
  agents: boolean
  config: Record<string, unknown>
}) {
  const [tab, setTab] = useState<string>('overview')

  return (
    <aside
      className='gr-create-preview gr-room-info-surface'
      data-game-theme={(game?.id ?? '').includes('gomoku')
        ? 'gomoku'
        : (game?.id ?? '').includes('holdem')
        ? 'holdem'
        : undefined}
      aria-label='房间实时预览'
    >
      <RoomInfoHero
        gameId={game?.id ?? ''}
        gameName={game?.name ?? '选择玩法'}
        title={name.trim() || '房间名称'}
        tabs={
          <RoomInfoTabs selected={tab} changed={setTab} prefix='preview-tab' panelId={`preview-panel-${tab}`} preview />
        }
        preview
      />
      <div
        className='gr-create-preview-body'
        role='tabpanel'
        tabIndex={0}
        id={`preview-panel-${tab}`}
        aria-labelledby={`preview-tab-${tab}`}
      >
        {tab === 'overview' && (
          <dl>
            <div>
              <dt>
                <Symbol name='score' />计分方式
              </dt>
              <dd>{economyLabel(mode)}</dd>
            </div>
            <div>
              <dt>
                {mode === 'token' ? <TokenIcon /> : <Symbol name='coins' />}每人抵押
              </dt>
              <dd>
                {mode === 'token'
                  ? (
                    <TokenAmount
                      value={stake.trim() && Number.isSafeInteger(Number(stake)) ? Number(stake) : undefined}
                    />
                  )
                  : '无需投入'}
              </dd>
            </div>
            <div>
              <dt>
                <Symbol name='source' />服务器
              </dt>
              <dd>{source?.name ?? '未选择'}</dd>
            </div>
            <div>
              <dt>
                <Symbol name='agent' />Agent
              </dt>
              <dd>{agents ? '允许加入' : '不允许加入'}</dd>
            </div>
          </dl>
        )}
        {tab === 'rules' && (
          <>
            <dl>
              {Object.entries(game?.configSchema?.properties ?? {}).map(([key, field]) => (
                <div key={key}>
                  <dt>
                    <Symbol name='document' />
                    {field.title ?? key}
                  </dt>
                  <dd>
                    {typeof config[key] === 'boolean' ? (config[key] ? '开启' : '关闭') : String(config[key] ?? '—')}
                  </dd>
                </div>
              ))}
            </dl>
            <p>{game?.description ?? '选择玩法后查看规则'}</p>
            <p className='gr-muted'>
              <Symbol name='document' />
              {game?.policies.map(policy => settlementLabel(policy, mode)).join(' / ')}
            </p>
            <p className='gr-muted'>作者自制 · 未审核</p>
            {mode === 'token' && <p className='gr-muted'>结束时按游戏结果分配奖池，收益回到你的 Token 余额。</p>}
          </>
        )}
        {tab === 'source' && (
          <>
            <dl>
              <div>
                <dt>
                  <Symbol name='source' />来源
                </dt>
                <dd>{source?.name ?? '未选择'}</dd>
              </div>
              <div>
                <dt>
                  <Symbol name='document' />版本
                </dt>
                <dd>{game ? `v${game.version}` : '—'}</dd>
              </div>
            </dl>
            <p className='gr-muted'>发布者</p>
            <p className='gr-code'>{game?.publisherId}</p>
            <p className='gr-muted'>版本哈希</p>
            <p className='gr-code'>{game?.packageHash}</p>
            <p className='gr-muted'>结算策略标识</p>
            <p className='gr-code'>{game?.policies.join(' / ')}</p>
          </>
        )}
      </div>
    </aside>
  )
}
