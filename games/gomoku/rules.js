;(() => {
  const SIZE = 15
  const invalid = () => {
    throw Error('invalid_action')
  }
  function transition(state) {
    return state.result ? { state, turn: null, done: state.result } : { state, turn: state.turn }
  }
  globalThis.game = {
    setup(ctx) {
      if (ctx.seats.length !== 2) throw Error('invalid_config')
      return transition({
        board: Array(SIZE * SIZE).fill(null),
        turn: 0,
        moves: 0,
        lastMove: null,
        result: null,
      })
    },
    act(state, action, ctx) {
      if (
        state.result || ctx.seatIndex !== state.turn || !action || action.type !== 'place'
        || !Number.isInteger(action.x) || !Number.isInteger(action.y)
        || action.x < 0 || action.x >= SIZE || action.y < 0 || action.y >= SIZE
        || state.board[action.y * SIZE + action.x] !== null
      ) invalid()
      const seat = state.turn
      state.board[action.y * SIZE + action.x] = seat
      state.moves++
      state.lastMove = { x: action.x, y: action.y, seat }
      const win = [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => {
        let count = 1
        for (const sign of [-1, 1]) {
          let x = action.x + dx * sign, y = action.y + dy * sign
          while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && state.board[y * SIZE + x] === seat) {
            count++
            x += dx * sign
            y += dy * sign
          }
        }
        return count >= 5
      })
      if (win) state.result = { winners: [seat], scores: [seat === 0 ? 1 : 0, seat === 1 ? 1 : 0] }
      else if (state.moves === SIZE * SIZE) state.result = { winners: [], scores: [0, 0] }
      else state.turn = 1 - seat
      return transition(state)
    },
    timeout(state, ctx) {
      if (state.result || ctx.seatIndex !== state.turn) invalid()
      const winner = 1 - state.turn
      state.result = { winners: [winner], scores: [winner === 0 ? 1 : 0, winner === 1 ? 1 : 0] }
      state.reason = 'timeout'
      return transition(state)
    },
    observe(state, seatIndex) {
      if (seatIndex !== 0 && seatIndex !== 1) throw Error('invalid_seat')
      return {
        kind: 'gomoku',
        size: SIZE,
        selfSeat: seatIndex,
        board: state.board,
        turn: state.result ? null : state.turn,
        legalActions: !state.result && seatIndex === state.turn
          ? state.board.flatMap((cell, i) =>
            cell === null ? [{ type: 'place', x: i % SIZE, y: Math.floor(i / SIZE) }] : []
          )
          : [],
        moves: state.moves,
        lastMove: state.lastMove,
        result: state.result,
        reason: state.reason || null,
      }
    },
  }
})()
