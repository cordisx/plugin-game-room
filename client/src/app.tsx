import type { ReactElement } from 'react'
import { useEffect, useState } from 'cordisx/react'
import { Button, SearchField } from 'cordisx/ui'
import { SourceAggregator } from './data/aggregate.js'
import type { GameRoomPort } from './data/port.js'
import type { Agent, Balance, Dispatch, Filters, History, Seat, SourceState } from './data/model.js'
import { consentFor, decodeInvitation } from './data/model.js'
import { Lobby } from './components/lobby.js'
import {
  AgentPanel,
  AgentsPanel,
  CreateRoomPanel,
  DispatchPanel,
  PersonalPanel,
  PreparePanel,
} from './components/details.js'
import './styles/foundation.css'
export type ClientRuntime = {
  port: GameRoomPort
  navigate: (page: string) => void
  seat?: Seat
  agent?: Agent
  replay?: { turn: number; description: string }[]
}
export function GameRoomPage({ page, runtime }: { page: string; runtime: ClientRuntime }): ReactElement {
  const { port, navigate } = runtime
  const [states, setStates] = useState<SourceState[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [history, setHistory] = useState<History[]>([])
  const [filters, setFilters] = useState<Filters>({
    search: '',
    gameId: '',
    sourceId: '',
    vacancy: false,
    agents: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invitation, setInvitation] = useState('')
  const [epoch, setEpoch] = useState(0)
  const [controller] = useState(() => new AbortController())
  useEffect(() => () => controller.abort(), [controller])
  useEffect(() => {
    const current = new AbortController()
    const aggregate = new SourceAggregator(port, setStates)
    void aggregate.refresh()
    void Promise.allSettled([
      port.agents(current.signal).then(setAgents),
      port.dispatches(current.signal).then(setDispatches),
      port.balances(current.signal).then(setBalances),
      port.history(current.signal).then(setHistory),
    ])
    return () => {
      current.abort()
      aggregate.dispose()
    }
  }, [port, epoch])
  const run = (operation: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    void operation(controller.signal).then(() => {
      if (!controller.signal.aborted) setEpoch(epoch => epoch + 1)
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '操作失败')
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false)
    })
  }
  const selectAgent = (agent: Agent) => {
    runtime.agent = agent
    navigate('agent')
  }
  const rooms = states.flatMap(state => state.snapshot?.rooms ?? [])
  return (
    <div className='gr-root'>
      {port.kind === 'sample' && (
        <div className='gr-notice' role='status'>
          样例数据 · 真实插件组件预览 · 不连接服务器、不运行模型、不改变余额
        </div>
      )}
      {error && <div className='gr-error' role='alert'>{error}</div>}
      {page === 'lobby' && (
        <Lobby
          states={states}
          filters={filters}
          setFilters={setFilters}
          agents={agents}
          dispatches={dispatches}
          join={room =>
            run(async signal => {
              runtime.seat = await port.join({ sourceId: room.sourceId, roomId: room.id }, signal)
              navigate('prepare')
            })}
          create={() => navigate('create')}
          invite={() => navigate('invite')}
          agentDetail={selectAgent}
          navigate={navigate}
        />
      )}
      {page === 'create' && (
        <CreateRoomPanel
          key={states.map(state => state.state).join()}
          states={states}
          busy={busy}
          create={(sourceId, draft) =>
            run(async signal => {
              const invitation = await port.create(sourceId, draft, signal)
              runtime.seat = await port.join(invitation, signal)
              navigate('prepare')
            })}
        />
      )}
      {page === 'invite' && (
        <div className='gr-detail'>
          <label className='gr-field'>
            完整邀请 ID<SearchField
              aria-label='完整邀请 ID'
              placeholder='粘贴包含来源的邀请 ID'
              value={invitation}
              onChange={setInvitation}
            />
          </label>
          <p className='gr-muted'>邀请绑定房间所在的来源。不会在其他来源查找同名房间。</p>
          <Button
            variant='primary'
            disabled={busy || !invitation.trim()}
            onClick={() =>
              run(async signal => {
                runtime.seat = await port.join(decodeInvitation(invitation, port.sources), signal)
                navigate('prepare')
              })}
          >
            查看房间
          </Button>
        </div>
      )}
      {page === 'prepare' && runtime.seat && (
        <PreparePanel
          seat={runtime.seat}
          busy={busy}
          sample={port.kind === 'sample'}
          sources={port.sources}
          ready={() =>
            run(async signal => {
              runtime.seat = await port.ready(runtime.seat!, consentFor(runtime.seat!.room), signal)
            })}
          close={() =>
            run(async signal => {
              await port.leave(runtime.seat!, signal)
              runtime.seat = undefined
              navigate('lobby')
            })}
        />
      )}
      {page === 'agents' && <AgentsPanel agents={agents} select={selectAgent} />}
      {page === 'agent' && runtime.agent && (
        <AgentPanel
          agent={runtime.agent}
          rooms={rooms}
          busy={busy}
          dispatch={(room, budget) =>
            run(async signal => {
              await port.dispatch(runtime.agent!.id, { sourceId: room.sourceId, roomId: room.id }, budget, signal)
              navigate('dispatch')
            })}
        />
      )}
      {page === 'dispatch' && (
        <DispatchPanel
          runs={dispatches}
          agents={agents}
          busy={busy}
          withdraw={dispatch =>
            run(async signal => {
              await port.withdraw(dispatch, signal)
            })}
        />
      )}
      {page === 'personal' && (
        <PersonalPanel
          balances={balances}
          history={history}
          replay={record =>
            run(async signal => {
              runtime.replay = await port.replay(record, signal)
              navigate('replay')
            })}
        />
      )}
      {page === 'replay' && (
        <div className='gr-detail'>
          {runtime.replay?.map(event => (
            <div className='gr-detail-row' key={event.turn}>
              <strong>第 {event.turn} 步</strong>
              <span>{event.description}</span>
            </div>
          ))}
        </div>
      )}
      {page === 'settings' && (
        <div className='gr-detail'>
          {states.map(state => (
            <div className='gr-record' key={state.source.id}>
              <strong>{state.source.name}</strong>
              <span>{state.state === 'online' ? '已连接' : state.state === 'loading' ? '连接中' : '不可用'}</span>
              <span className='gr-code'>{state.source.url}</span>
              <span className='gr-muted'>
                协议 {state.snapshot?.protocol ?? '未知'} · 账户 {state.source.accountId}
              </span>
              {state.error && <span>{state.error}</span>}
            </div>
          ))}
          <Button disabled={busy} onClick={() => setEpoch(epoch => epoch + 1)}>重新连接来源</Button>
          <p className='gr-muted'>来源地址与账户分别配置。多个来源会同时显示在大厅。</p>
        </div>
      )}
      {page === 'lobby' && (
        <div className='gr-action-row'>
          <Button variant='ghost' onClick={() => navigate('personal')}>个人 · 资产与战绩</Button>
          <Button variant='ghost' onClick={() => navigate('settings')}>设置 · 数据来源</Button>
        </div>
      )}
    </div>
  )
}
