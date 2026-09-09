import { TextInput } from './components/text-input.js'
import type { ReactElement } from 'cordisx/react'
import { useEffect, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
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
import { PublishPanel } from './components/publish.js'
import { ReplayPanel } from './components/replay.js'
import { GameSurface } from './components/game-surface.js'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import { FundingPanel } from './components/funding.js'
import type { FundingQuote } from './data/economy.js'
import './styles/foundation.css'
import { PageShell } from './components/page-shell.js'
export type ClientRuntime = {
  port: GameRoomPort
  restrictedContent?: RestrictedContentV1
  navigate: (page: string) => void
  seat?: Seat
  agent?: Agent
  replay?: import('./data/model.js').ReplayEvent[]
  quote?: FundingQuote
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
  const [, renderSeat] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const [controller] = useState(() => new AbortController())
  useEffect(() => () => controller.abort(), [controller])
  useEffect(() => {
    const current = new AbortController()
    const aggregate = new SourceAggregator(port, setStates)
    void aggregate.refresh()
    void Promise.allSettled([
      port.agents(current.signal).then(value => {
        if (!current.signal.aborted) setAgents(value)
      }),
      port.dispatches(current.signal).then(value => {
        if (!current.signal.aborted) setDispatches(value)
      }),
      port.balances(current.signal).then(value => {
        if (!current.signal.aborted) setBalances(value)
      }),
      port.history(current.signal).then(value => {
        if (!current.signal.aborted) setHistory(value)
      }),
    ])
    return () => {
      current.abort()
      aggregate.dispose()
    }
  }, [port, epoch])
  useEffect(() => {
    if (!['prepare', 'funding'].includes(page) || !runtime.seat?.seatId || !port.refreshSeat) return
    const polling = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await port.refreshSeat!(runtime.seat!, polling.signal)
        if (!polling.signal.aborted && (next.version ?? 0) >= (runtime.seat?.version ?? 0)) {
          runtime.seat = next
          renderSeat(epoch => epoch + 1)
        }
      } catch (error) {
        if (!polling.signal.aborted) setError(error instanceof Error ? error.message : '对局连接中断')
      } finally {
        if (!polling.signal.aborted) timer = setTimeout(poll, 1500)
      }
    }
    timer = setTimeout(poll, 1500)
    return () => {
      polling.abort()
      clearTimeout(timer)
    }
  }, [page, port, runtime])
  useEffect(() => {
    if (!['lobby', 'agents', 'agent', 'dispatch'].includes(page)) return
    const current = new AbortController()
    const timer = setInterval(() => {
      void port.agents(current.signal).then(value => {
        if (!current.signal.aborted) setAgents(value)
      }).catch(() => {})
      void port.dispatches(current.signal).then(value => {
        if (!current.signal.aborted) setDispatches(value)
      }).catch(() => {})
    }, 2000)
    return () => {
      current.abort()
      clearInterval(timer)
    }
  }, [page, port])
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
  const ensureAccount = async (sourceId: string, signal: AbortSignal) => {
    if (port.kind === 'live' && !port.isConnected?.(sourceId)) {
      if (!port.connect) throw new Error('此 Host 尚未提供安全账户连接')
      await port.connect(sourceId)
      signal.throwIfAborted()
    }
  }
  const rooms = states.flatMap(state => state.snapshot?.rooms ?? [])
  return (
    <PageShell page={page} navigate={navigate}>
      {port.kind === 'sample' && (
        <div className='gr-notice' role='status'>
          样例数据 · 真实插件组件预览 · 不连接服务器、不运行模型、不改变余额
        </div>
      )}
      {error && <div className='gr-error' role='alert'>{error}</div>}
      {page === 'lobby' && (
        <Lobby
          connected={sourceId => port.kind === 'sample' || port.isConnected?.(sourceId) === true}
          refresh={() => setEpoch(epoch => epoch + 1)}
          busy={busy}
          states={states}
          filters={filters}
          setFilters={setFilters}
          agents={agents}
          dispatches={dispatches}
          join={room =>
            run(async signal => {
              await ensureAccount(room.sourceId, signal)
              if (room.state !== 'waiting' || room.occupied >= room.capacity) {
                const snapshot = await port.list(port.sources.find(source => source.id === room.sourceId)!, signal)
                const current = snapshot.rooms.find(value => value.id === room.id)
                if (!current?.owned && !(current?.state === 'waiting' && current.occupied < current.capacity)) return
              }
              runtime.seat = await port.join({ sourceId: room.sourceId, roomId: room.id }, signal)
              navigate('prepare')
            })}
          create={() => navigate('create')}
          invite={() => navigate('invite')}
          agentDetail={selectAgent}
          navigate={navigate}
        />
      )}
      {page === 'create' && <Button variant='ghost' onClick={() => navigate('publish')}>导入 / 发布自制游戏包</Button>}
      {page === 'publish' && (
        <PublishPanel
          states={states}
          busy={busy}
          publish={async (sourceId, preview) => {
            run(async signal => {
              if (!port.publish) throw new Error('样例预览不发布游戏包')
              await port.publish(sourceId, preview.document, preview.digest, signal)
              navigate('create')
            })
          }}
        />
      )}
      {page === 'create' && (
        <CreateRoomPanel
          key={states.map(state => state.state).join()}
          states={states}
          busy={busy}
          create={(sourceId, draft) =>
            run(async signal => {
              await ensureAccount(sourceId, signal)
              const invitation = await port.create(sourceId, draft, signal)
              runtime.seat = await port.join(invitation, signal)
              navigate('prepare')
            })}
        />
      )}
      {page === 'invite' && (
        <div className='gr-detail'>
          <label className='gr-field'>
            完整邀请 ID<TextInput
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
                const decoded = decodeInvitation(invitation, port.sources)
                await ensureAccount(decoded.sourceId, signal)
                runtime.seat = await port.join(decoded, signal)
                navigate('prepare')
              })}
          >
            查看房间
          </Button>
        </div>
      )}
      {page === 'prepare' && runtime.seat?.status && ['playing', 'finished', 'aborted'].includes(runtime.seat.status)
        && (
          <GameSurface
            seat={runtime.seat}
            port={port}
            service={runtime.restrictedContent}
            changed={next => {
              if ((next.version ?? 0) >= (runtime.seat?.version ?? 0)) {
                runtime.seat = next
                renderSeat(epoch => epoch + 1)
              }
            }}
          />
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
      {page === 'funding' && runtime.seat && runtime.quote && (
        <FundingPanel
          key={runtime.quote.termsHash}
          seat={runtime.seat}
          quote={runtime.quote}
          busy={busy}
          reserve={() =>
            run(async signal => {
              await port.reserve!(runtime.seat!, runtime.quote!, signal)
              runtime.seat = await port.refreshSeat!(runtime.seat!, signal)
              navigate('prepare')
            })}
        />
      )}
      {page === 'prepare' && runtime.seat && (
        <div className='gr-action-row'>
          {runtime.seat.canStart && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async signal => {
                  runtime.seat = await port.start!(runtime.seat!, signal)
                })}
            >
              开始对局
            </Button>
          )}
          {runtime.seat.funding && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async signal => {
                  runtime.quote = await port.quote!(runtime.seat!, signal)
                  navigate('funding')
                })}
            >
              查看全部席位投入条款
            </Button>
          )}
          {runtime.seat.canNextMatch && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async signal => {
                  runtime.seat = await port.nextMatch!(runtime.seat!, signal)
                })}
            >
              开始下一局准备
            </Button>
          )}
        </div>
      )}
      {page === 'agents' && <Button onClick={() => navigate('configuration')}>添加 / 编辑 Agent</Button>}
      {page === 'agents' && <AgentsPanel agents={agents} select={selectAgent} />}
      {page === 'agent' && port.capabilities?.().agent.reason && <p role='status'>{port.capabilities().agent.reason}
      </p>}
      {page === 'agent' && runtime.agent && (
        <AgentPanel
          agent={runtime.agent}
          rooms={rooms}
          busy={busy || port.capabilities?.().agent.available === false}
          dispatch={(room, budget) =>
            run(async signal => {
              await port.dispatch(
                runtime.agent!.id,
                { sourceId: room.sourceId, roomId: room.id },
                budget,
                signal,
                consentFor(room),
              )
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
        <ReplayPanel events={runtime.replay ?? []} port={port} service={runtime.restrictedContent} />
      )}
      {page === 'settings' && (
        <div className='gr-detail'>
          {states.map(state => (
            <div className='gr-record' key={state.source.id}>
              <strong>{state.source.name}</strong>
              <span>
                {state.state === 'online'
                  ? (port.isConnected?.(state.source.id) ? '账户已连接' : '服务在线 · 账户未连接')
                  : state.state === 'loading'
                  ? '连接中'
                  : '不可用'}
              </span>
              <span className='gr-code'>{state.source.url}</span>
              <span className='gr-muted'>
                协议 {state.snapshot?.protocol ?? '未知'} · 账户 {state.source.accountId}
              </span>
              {state.error && <span>{state.error}</span>}
              {port.kind === 'live' && (
                <div className='gr-action-row'>
                  <Button
                    disabled={busy || port.capabilities?.().account === false}
                    onClick={() =>
                      run(async () => {
                        await port.connect!(state.source.id)
                      })}
                  >
                    连接游戏账户
                  </Button>
                  <Button
                    disabled={busy || port.capabilities?.().account === false}
                    onClick={() => run(signal => port.connectEconomy!(state.source.id, signal))}
                  >
                    连接经济账户
                  </Button>
                  <Button
                    disabled={busy || port.capabilities?.().account === false}
                    onClick={() => run(signal => port.linkEconomy!(state.source.id, signal))}
                  >
                    确认绑定经济账户
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Button disabled={busy} onClick={() => setEpoch(epoch => epoch + 1)}>重新连接来源</Button>
          <Button onClick={() => navigate('configuration')}>管理来源与 Agent 配置</Button>
          <p className='gr-muted'>来源地址与账户分别配置。多个来源会同时显示在大厅。</p>
        </div>
      )}
    </PageShell>
  )
}
