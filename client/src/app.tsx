import type { CreatePreferences } from './data/create-preferences.js'
import { walletBalanceResource } from './data/wallet-presentation.js'
import { useSourceStates } from './data/use-source-states.js'
import { type CreateContext, defaultLobbyFilters, openLobbyCreate } from './data/lobby-context.js'
import { startSeatRefresh } from './data/seat-refresh.js'
import type { IsolatedGameUiV1 } from '@cordisx/protocol/isolated-game-ui/v1'
import { ActionScope, runPageAction } from './data/action-scope.js'
import { agentPageBlocked } from './data/features.js'
import { Spectator } from './components/spectator-content.js'
import { Symbol } from './components/icons.js'
import type { ReactElement } from 'cordisx/react'
import { useEffect, useRef, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { GameRoomPort } from './data/port.js'
import type { Agent, Filters, Seat, SourceState } from './data/model.js'
import { consentFor } from './data/model.js'
import { Lobby } from './components/lobby.js'
import { AgentPanel, CreateRoomPanel, PreparePanel } from './components/details.js'
import { AgentsPanel } from './components/agents-panel.js'
import { DispatchPanel } from './components/dispatch-panel.js'
import { LedgerPanel } from './components/ledger-panel.js'
import { PersonalPanel } from './components/personal-panel.js'
import { usePanelResource } from './data/use-panel-resource.js'
import { InvitePanel } from './components/invite.js'
import { SourcesPanel } from './components/sources-restored.js'
import { PublishPanel } from './components/publish.js'
import { ReplayPanel } from './components/replay.js'
import { GameSurface } from './components/game-content.js'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import { FundingPanel } from './components/funding.js'
import type { FundingQuote } from './data/economy.js'
import './styles/foundation.css'
import { headerBalanceAccessibleLabel, headerBalanceLabel } from './data/header-balance.js'
import { PageShell } from './components/page-shell.js'
import type { CurrentUserState } from './data/current-user-sync.js'
export type ClientRuntime = {
  currentUser?: CurrentUserState
  port: GameRoomPort
  createPreferences?: CreatePreferences
  officialSourceOrigins?: readonly string[]
  createContext?: CreateContext
  lobbyStates?: SourceState[]
  lobbyFilters?: Filters
  balanceLabel?: string
  balanceAriaLabel?: string
  updateBalanceLabel?: (label: string, ariaLabel?: string) => void
  updateRoomHeader?: (name: string) => void
  subscribeWallet?: (changed: () => void) => () => void
  subscribeCurrentUser?: (changed: () => void) => () => void
  isolatedGameUi?: IsolatedGameUiV1
  restrictedContent?: RestrictedContentV1
  navigate: (page: string) => void
  seat?: Seat
  agent?: Agent
  replay?: import('./data/model.js').ReplayEvent[]
  lobbyTarget?: { room: import('./data/model.js').Room; watch: boolean }
  dispatchRoomKey?: string
  quote?: FundingQuote
  roomHeaderAction?: (action: 'details' | 'sync' | 'leave', signal: AbortSignal) => Promise<void>
}
export function GameRoomPage({ page, runtime }: { page: string; runtime: ClientRuntime }): ReactElement {
  const blocked = agentPageBlocked(page)
  useEffect(() => {
    if (blocked) runtime.navigate('lobby')
  }, [blocked, runtime])
  if (blocked) {
    return (
      <PageShell page={page} navigate={runtime.navigate}>
        <p role='status'>代理派遣暂未开放，正在返回大厅。</p>
      </PageShell>
    )
  }
  return <EnabledGameRoomPage page={page} runtime={runtime} />
}
function EnabledGameRoomPage({ page, runtime }: { page: string; runtime: ClientRuntime }): ReactElement {
  const { port, navigate } = runtime
  const roomName = runtime.seat?.room.name
  useEffect(() => {
    if (['prepare', 'funding'].includes(page) && roomName) runtime.updateRoomHeader?.(roomName)
  }, [page, roomName, runtime])
  useEffect(() => {
    if (page === 'lobby') delete runtime.lobbyTarget
  }, [page, runtime])
  const [epoch, setEpoch] = useState(0)
  const [walletEpoch, setWalletEpoch] = useState(0)
  const [sourceOwnerRevision, setSourceOwnerRevision] = useState(0)
  const currentSourceOwner = () => runtime.currentUser?.status === 'available' ? runtime.currentUser.subject : undefined
  const sourceOwner = useRef(currentSourceOwner())
  const states = useSourceStates(port, epoch, 2000, sourceOwnerRevision)
  const [filters, setFilters] = useState<Filters>(() => runtime.lobbyFilters ?? defaultLobbyFilters())
  if (page === 'lobby') {
    runtime.lobbyFilters = filters
    runtime.lobbyStates = states
  }
  const [busy, setBusy] = useState(false)
  const [actions] = useState(() => new ActionScope())
  const [error, setError] = useState('')
  const [, renderSeat] = useState(0)
  useEffect(() =>
    runtime.subscribeCurrentUser?.(() => {
      const next = currentSourceOwner()
      if (sourceOwner.current !== next) {
        sourceOwner.current = next
        setSourceOwnerRevision(value => value + 1)
      }
      setEpoch(value => value + 1)
    }), [runtime])
  useEffect(() => runtime.subscribeWallet?.(() => setWalletEpoch(value => value + 1)), [runtime])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [exitRequest, setExitRequest] = useState(0)
  const [syncRevision, setSyncRevision] = useState(0)
  const [connectionError, setConnectionError] = useState('')
  const [refreshAttempt, setRefreshAttempt] = useState(0)
  const uncertainConnection = useRef(false)
  const poll = ['lobby', 'agents', 'agent', 'dispatch'].includes(page)
  const agentResource = usePanelResource(port, signal => port.agents(signal), epoch, poll)
  const dispatchResource = usePanelResource(port, signal => port.dispatches(signal), epoch, poll)
  const personalEpoch = epoch + states.filter(state => state.state === 'online').length
  const walletBalances = usePanelResource(port, signal => port.balances(signal), personalEpoch + walletEpoch)
  const balances = walletBalanceResource(port, walletBalances)
  const history = usePanelResource(port, signal => port.history(signal), personalEpoch)
  const balanceLabel = headerBalanceLabel(balances)
  const balanceAriaLabel = headerBalanceAccessibleLabel(balances)
  useEffect(() => {
    runtime.balanceLabel = balanceLabel
    runtime.balanceAriaLabel = balanceAriaLabel
    runtime.updateBalanceLabel?.(balanceLabel, balanceAriaLabel)
  }, [balanceLabel, balanceAriaLabel, runtime])
  const agents = agentResource.data
  useEffect(() => {
    const deactivate = actions.activate()
    setBusy(false)
    return deactivate
  }, [actions])
  useEffect(() => {
    if (!['prepare', 'funding'].includes(page) || !runtime.seat?.seatId || !port.refreshSeat) return
    setConnectionError('')
    return startSeatRefresh({
      refresh: signal => port.refreshSeat!(runtime.seat!, signal),
      changed: next => {
        if ((next.version ?? 0) >= (runtime.seat?.version ?? 0)) {
          runtime.seat = next
          renderSeat(value => value + 1)
        }
      },
      recovered: next => {
        if ((next.version ?? 0) < (runtime.seat?.version ?? 0)) return
        setConnectionError('')
        if (uncertainConnection.current) {
          uncertainConnection.current = false
          setSyncRevision(value => value + 1)
        }
      },
      failed: setConnectionError,
    })
  }, [page, port, runtime, refreshAttempt])
  useEffect(() => {
    if (page !== 'prepare') {
      setDetailsOpen(false)
      return
    }
    const handler: ClientRuntime['roomHeaderAction'] = async (action, signal) => {
      if (action === 'details') {
        setDetailsOpen(open => !open)
        return
      }
      if (action === 'leave') {
        setExitRequest(value => value + 1)
        return
      }
      if (!runtime.seat || !port.refreshSeat) throw new Error('当前席位无法同步')
      setBusy(true)
      setError('')
      try {
        const next = await port.refreshSeat(runtime.seat, signal)
        if ((next.version ?? 0) >= (runtime.seat?.version ?? 0)) {
          runtime.seat = next
          renderSeat(value => value + 1)
          setSyncRevision(value => value + 1)
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '同步失败，请重试')
        throw reason
      } finally {
        setBusy(false)
      }
    }
    runtime.roomHeaderAction = handler
    return () => {
      if (runtime.roomHeaderAction === handler) runtime.roomHeaderAction = undefined
    }
  }, [page, port, runtime])
  const run = (operation: (signal: AbortSignal) => Promise<void>) => {
    void runPageAction(actions, operation, {
      busy: setBusy,
      error: setError,
      complete: () => setEpoch(epoch => epoch + 1),
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
    <PageShell
      page={page}
      navigate={navigate}
      actions={page === 'lobby'
        ? (
          <>
            <Button
              variant='ghost'
              className='gr-square-button'
              aria-label='邀请加入'
              title='邀请加入'
              onClick={() => navigate('invite')}
            >
              <Symbol name='link' />
            </Button>
            <Button className='gr-open-game' onClick={() => navigate('create')}>
              <Symbol name='plus' />开一局
            </Button>
          </>
        )
        : undefined}
    >
      {port.kind === 'sample' && (
        <div className='gr-notice' role='status'>
          样例数据 · 真实插件组件预览 · 不连接服务器、不运行模型、不改变余额
        </div>
      )}
      {error && <div className='gr-error' role='alert'>{error}</div>}
      {page === 'lobby' && (
        <Lobby
          key={sourceOwnerRevision}
          configured={port.sources.some(source => source.enabled)}
          bots={port.roomBots
            ? (room, change) =>
              run(async signal => {
                const next = await port.roomBots!(room, change, signal)
                if (runtime.seat?.room.id === room.id && runtime.seat.room.sourceId === room.sourceId) {
                  runtime.seat = next
                }
                setEpoch(value => value + 1)
              })
            : undefined}
          initialRoom={runtime.lobbyTarget?.room}
          initialWatching={runtime.lobbyTarget?.watch}
          spectator={(room, close) => (
            <Spectator
              htmlService={runtime.isolatedGameUi}
              room={room}
              port={port}
              service={runtime.restrictedContent}
              close={close}
            />
          )}
          connected={sourceId => port.kind === 'sample' || port.isConnected?.(sourceId) === true}
          refresh={() => setEpoch(epoch => epoch + 1)}
          busy={busy}
          states={states}
          filters={filters}
          setFilters={setFilters}
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
          dispatch={room => {
            runtime.dispatchRoomKey = `${room.sourceId}/${room.id}`
            navigate('agents')
          }}
          create={() => openLobbyCreate(runtime)}
          invite={() => navigate('invite')}
        />
      )}
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
          tokenAvailable={port.walletMode?.() === 'canonical-local'
            ? sourceId => !!port.economyAvailable?.(sourceId)
            : undefined}
          tokenStatus={port.tokenStatus ? sourceId => port.tokenStatus!(sourceId) : undefined}
          preferences={runtime.createPreferences}
          officialOrigins={runtime.officialSourceOrigins}
          context={runtime.createContext}
          configure={() => navigate('configuration')}
          publish={() => navigate('publish')}
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
        <InvitePanel
          port={port}
          settings={() => navigate('settings')}
          joined={seat => {
            runtime.seat = seat
            navigate('prepare')
          }}
        />
      )}
      {page === 'prepare' && !runtime.seat && (
        <section className='gr-panel-section' aria-label='恢复房间'>
          <p role='status'>当前页面的席位信息已丢失。返回大厅恢复现有连接，再选择「返回房间」。</p>
          <p className='gr-muted'>若原访客连接已失效，将无法恢复原席位；请勿重复创建访客身份。</p>
          <Button onClick={() => navigate('lobby')}>返回大厅恢复</Button>
        </section>
      )}
      {page === 'prepare' && runtime.seat && (
        <PreparePanel
          surface={
            <GameSurface
              htmlService={runtime.isolatedGameUi}
              exitRequest={exitRequest}
              syncRevision={syncRevision}
              connectionError={connectionError}
              recoverConnection={() => {
                uncertainConnection.current = true
                setRefreshAttempt(value => value + 1)
              }}
              exited={() => {
                runtime.seat = undefined
                navigate('lobby')
              }}
              seat={runtime.seat}
              port={port}
              service={runtime.restrictedContent}
              funding={(runtime.seat.walletSpend?.phase === 'funding') && port.quote
                ? async signal => {
                  runtime.quote = await port.quote!(runtime.seat!, signal)
                  navigate('funding')
                }
                : undefined}
              changed={next => {
                if ((next.version ?? 0) >= (runtime.seat?.version ?? 0)) {
                  runtime.seat = next
                  renderSeat(epoch => epoch + 1)
                }
              }}
            />
          }
          closeRoom={port.closeRoom
            ? () =>
              run(async signal => {
                await port.closeRoom!(runtime.seat!, signal)
                runtime.seat = undefined
                navigate('lobby')
              })
            : undefined}
          seat={runtime.seat}
          detailsOpen={detailsOpen}
          closeDetails={() => setDetailsOpen(false)}
          busy={busy}
          bots={port.bots
            ? change =>
              run(async signal => {
                runtime.seat = await port.bots!(runtime.seat!, change, signal)
              })
            : undefined}
          sources={port.sources}
        />
      )}
      {page === 'funding' && runtime.seat && runtime.quote && (
        <FundingPanel
          key={runtime.quote.termsHash}
          seat={runtime.seat}
          quote={runtime.quote}
          sources={port.sources}
          back={() => navigate('prepare')}
          unavailable={port.walletMode?.() === 'canonical-local'
              && (!port.economyAvailable?.(runtime.seat!.room.sourceId) || port.walletStatus?.() !== 'ready')
            ? '唯一本地钱包不可用或此来源不支持本地结算'
            : !port.reserve || !port.refreshSeat
            ? '此连接无法确认费用'
            : undefined}
          refresh={port.quote
            ? () =>
              run(async signal => {
                runtime.quote = await port.quote!(runtime.seat!, signal)
              })
            : undefined}
          busy={busy}
          reserve={() =>
            run(async signal => {
              await port.reserve!(runtime.seat!, runtime.quote!, signal)
              runtime.seat = await port.refreshSeat!(runtime.seat!, signal)
              navigate('prepare')
            })}
        />
      )}
      {page === 'agent' && runtime.agent && (
        <AgentPanel
          agent={runtime.agent}
          sources={port.sources}
          back={() => navigate('agents')}
          unavailable={port.capabilities?.().agent.available === false
            ? port.capabilities().agent.reason ?? '派遣服务不可用'
            : undefined}
          initialRoomKey={runtime.dispatchRoomKey}
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
      {page === 'agents' && (
        <AgentsPanel
          resource={agentResource}
          tasks={dispatchResource}
          rooms={rooms}
          select={selectAgent}
          configure={() => navigate('configuration')}
          unavailable={port.capabilities?.().agent.available === false
            ? port.capabilities().agent.reason ?? '派遣服务尚不可用'
            : undefined}
        />
      )}
      {page === 'dispatch' && (
        <DispatchPanel
          resource={dispatchResource}
          canSpectate={!!port.spectate && !!(runtime.restrictedContent || runtime.isolatedGameUi)}
          openRoom={(room, watch) => {
            runtime.lobbyTarget = { room, watch }
            navigate('lobby')
          }}
          agents={agents}
          rooms={rooms}
          sources={port.sources}
          busy={busy}
          configure={() => navigate('configuration')}
          withdraw={dispatch =>
            run(async signal => {
              await port.withdraw(dispatch, signal)
            })}
        />
      )}
      {page === 'personal' && (
        <PersonalPanel
          currentUser={runtime.currentUser}
          port={port}
          epoch={personalEpoch}
          balances={balances}
          sources={port.sources}
          navigate={navigate}
          busy={busy}
          history={history}
          replay={record =>
            run(async signal => {
              runtime.replay = await port.replay(record, signal)
              navigate('replay')
            })}
        />
      )}
      {page === 'ledger' && (
        <LedgerPanel port={port} epoch={personalEpoch} balances={balances} sources={port.sources} navigate={navigate} />
      )}
      {page === 'replay' && (
        <ReplayPanel
          back={() => navigate('personal')}
          events={runtime.replay ?? []}
          port={port}
          service={runtime.restrictedContent}
        />
      )}
      {page === 'settings' && (
        <SourcesPanel
          states={states}
          port={port}
          configure={() => navigate('configuration')}
          changed={() => setEpoch(value => value + 1)}
        />
      )}
    </PageShell>
  )
}
