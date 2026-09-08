import type { ReactElement } from 'react'
import { useEffect, useState } from 'cordisx/react'
import { Button, EmptyState, SearchField, Select } from 'cordisx/ui'
import type { Agent, Balance, CreateRoom, Dispatch, History, Room, Seat, Source, SourceState } from '../data/model.js'
import { consentFor, economyLabel, encodeInvitation } from '../data/model.js'
export function CreateRoomPanel(
  { states, create, busy }: {
    states: SourceState[]
    create: (sourceId: string, draft: CreateRoom) => void
    busy: boolean
  },
): ReactElement {
  const available = states.filter(state => state.state === 'online')
  const [sourceId, setSourceId] = useState(available[0]?.source.id ?? '')
  const source = available.find(state => state.source.id === sourceId)
  const [gameId, setGameId] = useState(source?.snapshot?.games[0]?.packageHash ?? '')
  const game = source?.snapshot?.games.find(game => game.packageHash === gameId)
  const [name, setName] = useState('朋友来一局')
  const [mode, setMode] = useState<CreateRoom['mode']>('score')
  const [stake, setStake] = useState('100')
  const [agents, setAgents] = useState(true)
  const [accepted, setAccepted] = useState(false)
  useEffect(() => {
    setAccepted(false)
  }, [sourceId, gameId, mode, stake])
  useEffect(() => {
    if (game && !game.modes.includes(mode)) setMode(game.modes[0] ?? 'score')
  }, [game, mode])
  return (
    <div className='gr-detail'>
      <label className='gr-field'>
        房间来源<Select
          aria-label='创建房间来源'
          value={sourceId}
          options={available.map(state => ({ value: state.source.id, label: state.source.name }))}
          onChange={value => {
            setSourceId(value)
            setGameId(available.find(state => state.source.id === value)?.snapshot?.games[0]?.packageHash ?? '')
          }}
        />
      </label>
      <label className='gr-field'>
        房间名称<SearchField aria-label='房间名称' value={name} onChange={setName} />
      </label>
      <label className='gr-field'>
        玩法<Select
          aria-label='创建房间玩法'
          value={gameId}
          options={(source?.snapshot?.games ?? []).map(game => ({
            value: game.packageHash,
            label: `${game.name} · v${game.version} · ${game.publisherId} · ${game.packageHash.slice(0, 8)}`,
          }))}
          onChange={setGameId}
        />
      </label>
      <label className='gr-field'>
        经济模式<Select
          aria-label='经济模式'
          value={mode}
          options={(game?.modes ?? ['score']).map(value => ({
            value,
            label: economyLabel(value as CreateRoom['mode']),
          }))}
          onChange={value => setMode(value as CreateRoom['mode'])}
        />
      </label>
      {mode === 'token' && (
        <>
          <p className='gr-muted'>虚拟娱乐 Token。仅在所选来源关联的经济实例结算；房间创建后须逐人确认并投入。</p>
          <label className='gr-field'>
            每席位投入<SearchField aria-label='每席位投入' inputMode='numeric' value={stake} onChange={setStake} />
          </label>
        </>
      )}
      <label className='gr-check'>
        <input type='checkbox' checked={agents} onChange={event => setAgents(event.target.checked)} />允许 Agent
      </label>
      {game && (
        <div className='gr-record'>
          <strong>{game.name} · v{game.version} · {game.publisherId}</strong>
          <span className='gr-code'>{game.packageHash}</span>
          <span>作者自制 · 未审核 · {game.policies.join(' / ')}</span>
          <p className='gr-muted'>{game.description}</p>
        </div>
      )}
      {mode === 'token' && (
        <label className='gr-check'>
          <input
            type='checkbox'
            checked={accepted}
            onChange={event => setAccepted(event.target.checked)}
          />我同意该固定版本、每席位投入与结算政策
        </label>
      )}
      <Button
        variant='primary'
        disabled={busy || !source || !game || !name.trim() || (mode === 'token' && !accepted)
          || (mode === 'token' && (!Number.isSafeInteger(Number(stake)) || Number(stake) <= 0))}
        onClick={() =>
          create(sourceId, {
            name: name.trim(),
            gameId: game!.id,
            packageHash: game!.packageHash,
            gameVersion: game!.version,
            mode,
            stake: mode === 'token' ? Number(stake) : 0,
            allowAgents: agents,
            consentAccepted: accepted,
          })}
      >
        创建并查看规则
      </Button>
    </div>
  )
}
export function PreparePanel(
  { seat, ready, close, busy, sample, sources }: {
    seat: Seat
    ready: () => void
    close: () => void
    busy: boolean
    sample: boolean
    sources: readonly Source[]
  },
): ReactElement {
  const [consented, setConsented] = useState(false)
  const terms = consentFor(seat.room)
  const termsKey = JSON.stringify([seat.matchId, terms])
  useEffect(() => {
    setConsented(false)
  }, [termsKey])
  return (
    <div className='gr-detail'>
      <div className='gr-detail-row'>
        <div className='gr-detail-copy'>
          <strong>{seat.room.name}</strong>
          <span className='gr-muted'>{seat.room.game.name} · v{terms.gameVersion}</span>
        </div>
        <span>{seat.room.occupied} / {seat.room.capacity} 人</span>
      </div>
      <div className='gr-record'>
        <strong>规则与版本</strong>
        <p>{terms.rules}</p>
        <span className='gr-muted'>{terms.review}</span>
        <span className='gr-code'>
          {encodeInvitation({ sourceId: seat.room.sourceId, roomId: seat.room.id }, sources)}
        </span>
      </div>
      <div className='gr-record'>
        <strong>{economyLabel(terms.mode)}{terms.stake ? ` · 投入 ${terms.stake}` : ''}</strong>
        {terms.economyId && <span>经济实例：{terms.economyId}</span>}
        <p className='gr-muted'>{terms.settlement}</p>
        {terms.mode === 'token' && <span>Token 为虚拟娱乐币。自制玩法的审核状态仅作信息披露。</span>}
      </div>
      {!seat.ready && (!seat.status || seat.status === 'waiting')
        ? (
          <>
            <label className='gr-check'>
              <input
                type='checkbox'
                checked={consented}
                onChange={event => setConsented(event.target.checked)}
              />我已阅读并同意此版本规则与投入条款
            </label>
            <div className='gr-action-row'>
              <Button variant='primary' disabled={busy || !consented} onClick={ready}>
                {sample ? '模拟确认并准备' : '确认并准备'}
              </Button>
              <Button disabled={busy} onClick={close}>离开准备页</Button>
            </div>
          </>
        )
        : (
          <div className='gr-source-notice' role='status'>
            {sample
              ? '样例：已准备，不运行真实游戏或冻结 Token'
              : seat.status === 'playing'
              ? '对局进行中'
              : seat.status === 'funding'
              ? '等待各账户确认投入'
              : seat.status === 'finished'
              ? '本局已结束'
              : seat.status === 'aborted'
              ? '本局已中止'
              : '已准备，等待其他席位'}
          </div>
        )}
    </div>
  )
}
export function AgentsPanel({ agents, select }: { agents: Agent[]; select: (agent: Agent) => void }): ReactElement {
  return (
    <div className='gr-detail'>
      {agents.map(agent => (
        <div className='gr-detail-row' key={agent.id}>
          <span className='gr-avatar'>{agent.avatar}</span>
          <div className='gr-detail-copy'>
            <strong>{agent.name}</strong>
            <span className='gr-muted'>{agent.description}</span>
            <span>{agent.status === 'playing' ? '对局中' : '空闲'} · {agent.games.join(' / ')}</span>
          </div>
          <Button onClick={() => select(agent)}>详情</Button>
        </div>
      ))}
      {!agents.length && <EmptyState title='暂无 Agent' description='连接派遣服务后在此管理对局伙伴。' />}
    </div>
  )
}
export function AgentPanel(
  { agent, rooms, dispatch, busy }: {
    agent: Agent
    rooms: Room[]
    dispatch: (room: Room, budget: number) => void
    busy: boolean
  },
): ReactElement {
  const compatible = rooms.filter(room =>
    room.allowAgents && room.compatible && room.state === 'waiting' && room.occupied < room.capacity
    && agent.games.includes(room.game.id)
  )
  const [key, setKey] = useState('')
  const [budget, setBudget] = useState('30')
  const [accepted, setAccepted] = useState(false)
  const room = compatible.find(room => `${room.sourceId}/${room.id}` === key)
  const roomTerms = JSON.stringify(room && consentFor(room))
  useEffect(() => {
    setAccepted(false)
  }, [key, roomTerms])
  return (
    <div className='gr-detail'>
      <div className='gr-detail-row'>
        <span className='gr-avatar'>{agent.avatar}</span>
        <div className='gr-detail-copy'>
          <strong>{agent.name}</strong>
          <span>{agent.description}</span>
        </div>
      </div>
      <label className='gr-field'>
        目标房间<Select
          aria-label='派遣目标房间'
          value={key}
          options={[
            { value: '', label: '选择可用房间' },
            ...compatible.map(room => ({
              value: `${room.sourceId}/${room.id}`,
              label: `${room.name} · ${room.sourceId}`,
            })),
          ]}
          onChange={setKey}
        />
      </label>
      <label className='gr-field'>
        最多动作次数<SearchField aria-label='最多动作次数' value={budget} onChange={setBudget} inputMode='numeric' />
      </label>
      <p className='gr-muted'>
        为 Agent 新增独立席位与普通任务，只将该席位观察提供给模型。达到预算后停止派遣；本轮不因模型 Token 消耗铸币。
      </p>
      {room && (
        <div className='gr-record'>
          <strong>{room.name} · {room.game.publisherId} · v{room.game.version}</strong>
          <span className='gr-code'>{room.game.packageHash}</span>
          <span>{room.review} · {economyLabel(room.mode)} · 新增席位投入 {room.stake}</span>
          <span>{room.settlement}</span>
          <p>{room.rules}</p>
        </div>
      )}
      <label className='gr-check'>
        <input type='checkbox' checked={accepted} onChange={event => setAccepted(event.target.checked)} />我授权新增此
        Agent 席位并同意上述规则与投入
      </label>
      <Button
        variant='primary'
        disabled={busy || !accepted || !room || agent.status !== 'idle' || !Number.isSafeInteger(Number(budget))
          || Number(budget) < 1}
        onClick={() => dispatch(room!, Number(budget))}
      >
        确认派遣
      </Button>
    </div>
  )
}
export function DispatchPanel(
  { runs, agents, withdraw, busy }: {
    runs: Dispatch[]
    agents: Agent[]
    withdraw: (run: Dispatch) => void
    busy: boolean
  },
): ReactElement {
  return (
    <div className='gr-detail'>
      {runs.map(run => (
        <div className='gr-record' key={run.id}>
          <strong>{agents.find(agent => agent.id === run.agentId)?.name ?? run.agentId}</strong>
          <span>来源 {run.sourceId} · 房间 {run.roomId}</span>
          <span className='gr-muted'>
            {run.state === 'running'
              ? '运行中'
              : run.state === 'withdrawn'
              ? '已撤回'
              : run.state === 'failed'
              ? '失败'
              : '已完成'} · 动作 {run.turns} / {run.budget} · 模型调用 {run.modelCalls ?? 0} · {run.detail}
          </span>
          <Button disabled={busy || run.state !== 'running'} onClick={() => withdraw(run)}>撤回 Agent</Button>
        </div>
      ))}
      {!runs.length && <EmptyState title='暂无派遣' description='从我的 Agent 中选择伙伴，派往一个兼容房间。' />}
    </div>
  )
}
export function PersonalPanel(
  { balances, history, replay }: { balances: Balance[]; history: History[]; replay: (record: History) => void },
): ReactElement {
  return (
    <div className='gr-detail'>
      <h2 className='gr-section-title'>我的资产</h2>
      {balances.map(balance => (
        <div className='gr-record' key={balance.economyId}>
          <strong>{balance.label}</strong>
          <span className='gr-code'>{balance.economyId}</span>
          <span>可用 {balance.available} Token · 已投入 {balance.reserved}</span>
        </div>
      ))}
      <h2 className='gr-section-title'>战绩</h2>
      {history.map(record => (
        <div className='gr-detail-row' key={`${record.sourceId}/${record.id}`}>
          <div className='gr-detail-copy'>
            <strong>{record.roomName} · {record.result}</strong>
            <span className='gr-muted'>
              {record.gameName} · {record.sourceId} ·{' '}
              {record.completedAt ? new Date(record.completedAt).toLocaleDateString() : '时间未提供'}
            </span>
          </div>
          <Button onClick={() => replay(record)}>回放</Button>
        </div>
      ))}
    </div>
  )
}
