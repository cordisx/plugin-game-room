globalThis.renderGame = (
  state,
  {
    node,
    button,
    readinessButton,
    playerAvatar,
    act,
    roomAction,
    optimisticReady,
    busy,
  },
) => {
  const waiting = state.observation.phase === 'waiting' || state.observation.phase === 'funding'
  const initial = state.observation
  const size = initial.config?.boardSize ?? 15
  const v = waiting
    ? {
      ...initial,
      size,
      board: Array(size * size).fill(null),
      selfSeat: initial.selfSeat,
      turn: null,
    }
    : initial
  const container = node('section', 'gomoku')
  container.setAttribute('aria-label', '五子棋棋盘')
  const self = v.selfSeat
  const result = v.result
  const heading = waiting ? initial.phase === 'funding' ? '等待投入确认' : '等待开局' : result
    ? result.winners.length ? `${result.winners[0] === 0 ? '黑' : '白'}方获胜` : '平局'
    : state.readOnly
    ? `轮到${v.turn === 0 ? '黑' : '白'}方`
    : state.canAct
    ? `轮到你 · ${self === 0 ? '黑' : '白'}方`
    : '等待对手落子'
  const status = node(
    'h2',
    initial.phase === 'funding' || result ? 'gomoku-result' : 'sr-only',
    heading,
  )
  status.setAttribute('role', 'status')
  container.append(status)
  const layout = node('div', 'gomoku-layout')
  layout.style.setProperty('--size', v.size)
  const bottomSeat = self === 1 ? 1 : 0
  const topPlayers = node('div', 'gomoku-players gomoku-players-top')
  const bottomPlayers = node('div', 'gomoku-players gomoku-players-bottom')
  for (const seat of [1 - bottomSeat, bottomSeat]) {
    const player = node('div', `gomoku-player ${!result && v.turn === seat ? 'active' : ''}`)
    const participant = state.participants?.[seat]
      ?? v.participants?.[seat]
    const ready = seat === self && optimisticReady !== undefined
      ? optimisticReady
      : v.participants[seat]?.ready
    const marker = node('span', `player-stone ${seat === 0 ? 'black' : 'white'}`)
    marker.setAttribute('aria-hidden', 'true')
    const name = participant?.name?.startsWith('guest_') ? '匿名玩家' : participant?.name
    const copy = node('span', 'gomoku-player-copy')
    copy.append(
      node('span', 'gomoku-player-name', `${seat === self ? '你 · ' : ''}${name ?? '空席'}`),
      node(
        'span',
        'gomoku-player-status',
        `${seat === 0 ? '黑方' : '白方'} · ${
          waiting
            ? v.participants[seat] ? ready ? '已准备' : '未准备' : '等待加入'
            : result
            ? '本局结束'
            : v.turn === seat
            ? '当前行动'
            : '等待落子'
        }`,
      ),
    )
    copy.querySelector('.gomoku-player-name').title = `${seat === self ? '你 · ' : ''}${
      name ?? '空席'
    }`
    player.append(playerAvatar(participant, seat), marker, copy)
    if (waiting && seat === self && v.participants[seat]) {
      const operation = ready ? 'cancel-ready' : 'ready'
      if (state.roomActions?.includes(operation) || optimisticReady !== undefined) {
        player.append(
          readinessButton(ready, () => roomAction(operation)),
        )
      }
    }
    player.setAttribute(
      'aria-label',
      `${name ?? '空席'}，${seat === 0 ? '黑方' : '白方'}${seat === self ? '，你' : ''}${
        !result && v.turn === seat ? '，当前行动' : ''
      }`,
    )
    player.dataset.seat = seat
    const players = seat === bottomSeat ? bottomPlayers : topPlayers
    players.append(player)
  }
  const board = node('div', 'board')
  board.style.setProperty('--size', v.size)
  board.setAttribute('role', 'group')
  board.setAttribute('aria-label', `${v.size} 路五子棋，选择交叉点落子`)
  const firstEmpty = v.board.indexOf(null)
  v.board.forEach((stone, i) => {
    const x = i % v.size, y = Math.floor(i / v.size)
    const last = v.lastMove?.x === x && v.lastMove?.y === y
    const enabled = state.canAct && !state.readOnly && !result && stone === null && !v.undo && !busy
    const cell = button('', () => act({ type: 'place', x, y }), !enabled, 'intersection')
    cell.setAttribute(
      'aria-label',
      `${x + 1} 列 ${y + 1} 行，${stone === null ? '空位' : stone === 0 ? '黑子' : '白子'}${
        last ? '，最后落点' : ''
      }`,
    )
    cell.tabIndex = enabled && i === firstEmpty ? 0 : -1
    cell.addEventListener('keydown', event => {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -v.size, ArrowDown: v.size }[event.key]
      if (delta === undefined) return
      event.preventDefault()
      let next = i + delta
      while (next >= 0 && next < v.board.length && v.board[next] !== null) next += delta
      const target = board.children[next]
      if (target && !target.disabled) {
        cell.tabIndex = -1
        target.tabIndex = 0
        target.focus()
      }
    })
    cell.dataset.x = x
    cell.dataset.y = y
    if (x === 0) cell.classList.add('left')
    if (x === v.size - 1) cell.classList.add('right')
    if (y === 0) cell.classList.add('top')
    if (y === v.size - 1) cell.classList.add('bottom')
    if (stone !== null) {
      cell.append(node('span', `stone ${stone === 0 ? 'black' : 'white'}${last ? ' last' : ''}`))
    } else if (
      (x === Math.floor(v.size / 2) && y === x)
      || ([2, v.size - 3].includes(x) && [2, v.size - 3].includes(y))
    ) cell.classList.add('star')
    board.append(cell)
  })
  layout.append(topPlayers, board, bottomPlayers)
  container.append(layout)
  if (!waiting && !result && !state.readOnly) {
    const controls = node('div', 'gomoku-undo')
    if (v.undo) {
      controls.append(
        node('span', '', v.undo.requester === self ? '等待对方同意悔棋' : '对方申请悔棋'),
      )
      if (state.canAct && v.undo.requester !== self) {
        controls.append(button('同意', () => act({ type: 'approve-undo' }), busy))
        controls.append(button('拒绝', () => act({ type: 'reject-undo' }), busy))
      }
    } else if (v.canUndo) {
      controls.append(button('悔棋', () => act({ type: 'request-undo' }), busy || !state.canAct))
    }
    container.append(controls)
  }
  return container
}
