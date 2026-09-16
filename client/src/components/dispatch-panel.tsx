import { ActionConfirmation } from './action-confirmation.js'
import type { DialogsV1 } from '@cordisx/protocol/dialogs/v1'
import { filterTasks } from '../data/task-filter.js'
import gomoku from '../assets/rooms/gomoku.webp'
import holdem from '../assets/rooms/holdem.webp'
import '../styles/task-directory.css'
import { useEffect, useState } from 'cordisx/react'
import { AgentAvatar, Button, SearchField } from 'cordisx/ui'
import type { Agent, Dispatch, Room, Source } from '../data/model.js'
import type { PanelResource } from '../data/use-panel-resource.js'
import { PanelState, RecordDetails } from './panel-state.js'
import { Symbol } from './icons.js'
const labels = { running: '运行中', completed: '已完成', withdrawn: '已撤回', failed: '失败' }
export function DispatchPanel(
  { resource, agents, rooms, sources, withdraw, busy, configure, openRoom, canSpectate, dialogs }: {
    resource: PanelResource<Dispatch>
    agents: Agent[]
    rooms: Room[]
    sources: readonly Source[]
    dialogs?: DialogsV1
    withdraw: (run: Dispatch, signal: AbortSignal) => Promise<void>
    busy: boolean
    openRoom: (room: Room, watch: boolean) => void
    canSpectate: boolean
    configure: () => void
  },
) {
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<'active' | 'history'>('active')
  const visible = filterTasks(resource.data, agents, rooms, search, period)
  const [confirm, setConfirm] = useState<string>()
  useEffect(() => {
    if (!resource.data.some(run => run.id === confirm && run.state === 'running')) setConfirm(undefined)
  }, [resource.data, confirm])
  return (
    <section className='gr-task-directory' aria-label='任务'>
      <div className='gr-task-toolbar'>
        <div className='gr-task-search'>
          <SearchField aria-label='搜索房间或代理' placeholder='搜索房间或代理' value={search} onChange={setSearch} />
        </div>
        <div className='gr-task-period' aria-label='任务范围'>
          <Button variant='ghost' aria-pressed={period === 'active'} onClick={() => setPeriod('active')}>进行中</Button>
          <Button variant='ghost' aria-pressed={period === 'history'} onClick={() => setPeriod('history')}>历史</Button>
        </div>
      </div>
      <div className='gr-task-results'>
        <PanelState
          resource={{ ...resource, data: visible }}
          empty={search ? '没有匹配的任务' : period === 'active' ? '暂无进行中的任务' : '暂无历史任务'}
          description='从我的 Agent 中选择伙伴，派往一个兼容房间。'
          action='配置 Agent'
          next={configure}
        >
          {visible.map(run => {
            const name = agents.find(agent => agent.id === run.agentId)?.name ?? '未加载 Agent'
            const room = rooms.find(room => room.sourceId === run.sourceId && room.id === run.roomId)
            const source = sources.find(source => source.id === run.sourceId)
            return (
              <div className='gr-panel-record gr-task-card' key={run.id}>
                {room && (room.game.id.includes('gomoku') || room.game.id.includes('holdem')) && (
                  <img className='gr-task-art' src={room.game.id.includes('gomoku') ? gomoku : holdem} alt='' />
                )}
                <div className='gr-task-content'>
                  <div className='gr-panel-copy'>
                    <strong className='gr-task-title'>{room?.name ?? '房间暂不可用'}</strong>
                    <span className='gr-task-agent'>
                      <span className='gr-panel-avatar'>
                        <AgentAvatar participant={{ id: run.agentId, name }} fallback='initials' />
                      </span>
                      {name}
                    </span>
                    <span className='gr-muted'>
                      {source?.name ?? '未加载来源'}
                    </span>
                    <span className='gr-panel-status' data-state={run.state}>{labels[run.state]}</span>
                    {run.detail && <span className='gr-muted'>{run.detail}</span>}
                  </div>
                  <div className='gr-panel-actions'>
                    <Button
                      className='gr-task-open'
                      disabled={busy || !room}
                      onClick={() =>
                        room && openRoom(room, !!(canSpectate && room.game.spectating && room.state === 'playing'))}
                    >
                      <Symbol
                        name={canSpectate && room?.game.spectating && room.state === 'playing' ? 'watch' : 'external'}
                        size={16}
                      />
                      {canSpectate && room?.game.spectating && room.state === 'playing' ? '观战' : '查看房间'}
                    </Button>
                    <RecordDetails label='查看派遣标识'>
                      <span>派遣：{run.id}</span>
                      <span>Agent：{run.agentId}</span>
                      <span>来源：{run.sourceId}</span>
                      <span>房间：{run.roomId}</span>
                    </RecordDetails>
                    {run.state === 'running' && (
                      <Button
                        variant='ghost'
                        className='gr-square-button'
                        disabled={busy || confirm === run.id}
                        aria-label={`撤回 ${name}`}
                        title={`撤回 ${name}`}
                        onClick={() => {
                          setConfirm(run.id)
                        }}
                      >
                        <Symbol name='close' />
                      </Button>
                    )}
                  </div>
                </div>
                {confirm === run.id && run.state === 'running' && (
                  <ActionConfirmation
                    service={dialogs}
                    kind='withdraw-agent'
                    title={`撤回 ${name}？`}
                    description='此 Agent 将停止参与。已有对局结果和投入仍按游戏规则结算。'
                    confirmLabel='撤回 Agent'
                    danger
                    disabled={busy}
                    close={() => setConfirm(undefined)}
                    confirm={signal => withdraw(run, signal)}
                  />
                )}
              </div>
            )
          })}
        </PanelState>
      </div>
    </section>
  )
}
