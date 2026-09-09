import type {
  Agent,
  Consent,
  CreateRoom,
  Dispatch,
  History,
  Invitation,
  Room,
  Seat,
  Source,
  SourceSnapshot,
} from './model.js'
import type { GameRoomPort } from './port.js'
const games: import('./model.js').Game[] = [
  {
    id: 'holdem',
    name: '德州扑克',
    version: '1.0.0',
    icon: '♠',
    description: '隐藏手牌 · 无限注德州',
    packageHash: 'sample-holdem',
    publisherId: '示例作者',
    modes: ['score', 'local-chips', 'token'],
    policies: ['conserved-payouts-v1'],
  },
  {
    id: 'gomoku',
    name: '五子棋',
    version: '1.0.0',
    icon: '◉',
    description: '公开棋盘 · 五子连珠',
    packageHash: 'sample-gomoku',
    publisherId: '示例作者',
    modes: ['score', 'local-chips', 'token'],
    policies: ['equal-winners-v1'],
  },
]
export class SamplePort implements GameRoomPort {
  readonly kind = 'sample' as const
  sources: Source[] = [
    { id: 'friends', name: '朋友的客厅', url: 'https://friends.example', accountId: 'you', enabled: true },
    { id: 'community', name: '社区牌社', url: 'https://community.example', accountId: 'you', enabled: true },
  ]
  private rooms: Room[] = [
    ['2048', 'friends', '下班来一局', 0, 3, 6, 'waiting', 'score'],
    ['1086', 'community', '周五牌局', 0, 5, 6, 'playing', 'token'],
    ['3021', 'friends', '落子无悔', 1, 1, 2, 'waiting', 'score'],
    ['4012', 'community', '慢棋小馆', 1, 2, 2, 'playing', 'score'],
    ['2061', 'friends', '午休十分钟', 1, 1, 2, 'waiting', 'local-chips'],
    ['3098', 'community', '新手德州桌', 0, 2, 6, 'waiting', 'token'],
  ].map(([id, sourceId, name, gameIndex, occupied, capacity, state, mode]) => ({
    id: String(id),
    sourceId: String(sourceId),
    name: String(name),
    game: games[Number(gameIndex)]!,
    occupied: Number(occupied),
    capacity: Number(capacity),
    state: state as Room['state'],
    mode: mode as Room['mode'],
    allowAgents: true,
    players: ['林', '猫', '柴'].slice(0, Number(occupied)),
    economyId: mode === 'token' ? 'community-economy' : undefined,
    stake: mode === 'token' ? 100 : 0,
    review: '作者自制 · 未审核',
    rules: '固定 1.0.0 版本。五子连线获胜；德州按标准牌型比较。超时由服务器执行默认动作。',
    settlement: 'equal-winners-v1 · 胜者均分，平局退回投入',
    compatible: true,
  }))
  private roster: Agent[] = [
    {
      id: 'mochi',
      name: 'Mochi',
      avatar: '🐱',
      games: ['holdem', 'gomoku'],
      status: 'playing',
      description: '谨慎观察，耐心等待机会。',
    },
    {
      id: 'atlas',
      name: 'Atlas',
      avatar: '🐕',
      games: ['holdem', 'gomoku'],
      status: 'idle',
      description: '喜欢变化与探索的对局伙伴。',
    },
    {
      id: 'echo',
      name: 'Echo',
      avatar: '🤖',
      games: ['gomoku'],
      status: 'playing',
      description: '专注棋盘，步步为营。',
    },
  ]
  private runs: Dispatch[] = [
    { id: 'd1', sourceId: 'community', roomId: '1086', agentId: 'mochi', state: 'running', budget: 30, turns: 8 },
    { id: 'd2', sourceId: 'community', roomId: '4012', agentId: 'echo', state: 'running', budget: 40, turns: 12 },
  ]
  private ensure(signal: AbortSignal) {
    signal.throwIfAborted()
  }
  async list(source: Source, signal: AbortSignal): Promise<SourceSnapshot> {
    this.ensure(signal)
    return {
      rooms: this.rooms.filter(room => room.sourceId === source.id),
      games,
      compatible: true,
      protocol: 'game-room/1',
    }
  }
  async create(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Invitation> {
    this.ensure(signal)
    const game = games.find(game => game.id === draft.gameId)!
    const room: Room = {
      ...this.rooms[0]!,
      id: String(Date.now()),
      sourceId,
      name: draft.name,
      game,
      mode: draft.mode,
      stake: draft.stake,
      economyId: draft.mode === 'token' ? `${sourceId}-economy` : undefined,
      occupied: 0,
      capacity: game.id === 'gomoku' ? 2 : 6,
      allowAgents: draft.allowAgents,
    }
    this.rooms.push(room)
    return { sourceId, roomId: room.id }
  }
  async join(invitation: Invitation, signal: AbortSignal): Promise<Seat> {
    this.ensure(signal)
    const room = this.rooms.find(room => room.id === invitation.roomId && room.sourceId === invitation.sourceId)
    if (!room) throw new Error('此来源没有这个房间')
    if (room.occupied >= room.capacity || room.state !== 'waiting') throw new Error('房间已开始或没有空位')
    return { room, seatId: 'sample-seat', ready: false, consentRequired: true, observation: null, legalActions: [] }
  }
  async ready(seat: Seat, consent: Consent, signal: AbortSignal): Promise<Seat> {
    this.ensure(signal)
    if (consent.gameVersion !== seat.room.game.version || consent.stake !== seat.room.stake) {
      throw new Error('房间条款已变更，请重新确认')
    }
    return { ...seat, ready: true, consentRequired: false }
  }
  async leave(_seat: Seat, signal: AbortSignal) {
    this.ensure(signal)
  }
  async agents(signal: AbortSignal) {
    this.ensure(signal)
    return [...this.roster]
  }
  async dispatches(signal: AbortSignal) {
    this.ensure(signal)
    return [...this.runs]
  }
  async dispatch(agentId: string, invitation: Invitation, budget: number, signal: AbortSignal) {
    this.ensure(signal)
    const agent = this.roster.find(agent => agent.id === agentId)
    if (!agent || agent.status !== 'idle') throw new Error('Agent 当前不可派遣')
    const seat = await this.join(invitation, signal)
    if (!seat.room.allowAgents || !agent.games.includes(seat.room.game.id)) throw new Error('Agent 与房间不兼容')
    const dispatch: Dispatch = { id: String(Date.now()), agentId, ...invitation, state: 'running', budget, turns: 0 }
    this.runs.push(dispatch)
    agent.status = 'playing'
    return dispatch
  }
  async withdraw(dispatch: Dispatch, signal: AbortSignal) {
    this.ensure(signal)
    this.runs = this.runs.map(run => run.id === dispatch.id ? { ...run, state: 'withdrawn' } : run)
    const agent = this.roster.find(agent => agent.id === dispatch.agentId)
    if (agent) agent.status = 'idle'
  }
  async balances(signal: AbortSignal) {
    this.ensure(signal)
    return [{ economyId: 'community-economy', label: '社区经济实例', available: 2400, reserved: 100 }, {
      economyId: 'friends-economy',
      label: '朋友经济实例',
      available: 800,
      reserved: 0,
    }]
  }
  async history(signal: AbortSignal): Promise<History[]> {
    this.ensure(signal)
    return [{
      id: 'h1',
      sourceId: 'friends',
      roomName: '周末练习',
      gameName: '五子棋',
      result: '胜利',
      mode: 'score',
      delta: 1,
      completedAt: '2026-09-08T18:30:00+08:00',
    }]
  }
  async replay(_record: History, signal: AbortSignal) {
    this.ensure(signal)
    return [{ turn: 1, description: '黑方落子：天元' }, { turn: 2, description: '白方落子：中心右侧' }, {
      turn: 23,
      description: '黑方五子连线，结束',
    }]
  }
  dispose() {}
}
