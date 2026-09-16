;(() => {
  const invalid = () => {
    throw Error('invalid_action')
  }
  function transition(state) {
    return state.result ? { state, turn: null, done: state.result } : { state, turn: state.turn }
  }
  function finishRound(state) {
    state.scores ??= [0, 0]
    state.result.winners.forEach(i => {
      state.scores[i] += 1
    })
    if ((state.roundNo ?? 1) < (state.rounds ?? 1)) {
      state.roundResult = state.result
      state.result = null
      state.betweenRounds = true
      state.turn = state.roundNo % 2
    } else {
      const best = Math.max(...state.scores)
      state.result = {
        winners: best ? state.scores.flatMap((n, i) => n === best ? [i] : []) : [],
        scores: state.scores,
      }
    }
    return transition(state)
  }
  function nextRound(state) {
    state.roundNo++
    state.board.fill(null)
    state.moves = 0
    state.lastMove = null
    state.history = []
    state.undo = null
    state.rejectedUndoAt = null
    state.reason = null
    state.betweenRounds = false
    state.roundResult = null
    state.turn = (state.roundNo - 1) % 2
    return transition(state)
  }
  function canUndo(state, seat) {
    return !state.result && !state.betweenRounds && !state.undo && state.turn === seat
      && state.rejectedUndoAt !== state.moves
      && (state.history ?? []).some(move => move.seat === seat)
  }
  function undo(state, seat) {
    let move
    do {
      move = state.history.pop()
      state.board[move.y * state.size + move.x] = null
    } while (move.seat !== seat)
    state.moves = state.history.length
    state.lastMove = state.history.at(-1) ?? null
    state.turn = seat
    state.undo = null
    state.rejectedUndoAt = null
    return transition(state)
  }
  globalThis.game = {
    setup(ctx) {
      const SIZE = ctx.config?.boardSize ?? 15
      if (![9, 13, 15].includes(SIZE)) throw Error('invalid_config')
      if (ctx.seats.length !== 2) throw Error('invalid_config')
      const rounds = ctx.config?.rounds ?? 1
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000) throw Error('invalid_config')
      return transition({
        rounds,
        roundNo: 1,
        scores: [0, 0],
        betweenRounds: false,
        roundResult: null,
        size: SIZE,
        board: Array(SIZE * SIZE).fill(null),
        turn: 0,
        moves: 0,
        lastMove: null,
        history: [],
        undo: null,
        result: null,
      })
    },
    act(state, action, ctx) {
      const SIZE = state.size ?? 15
      if (state.betweenRounds) {
        if (ctx.seatIndex !== state.turn || action?.type !== 'next-round') invalid()
        return nextRound(state)
      }
      if (!state.result && ctx.seatIndex === state.turn && state.undo) {
        if (action?.type === 'approve-undo') return undo(state, state.undo.requester)
        if (action?.type !== 'reject-undo') invalid()
        state.turn = state.undo.requester
        state.undo = null
        state.rejectedUndoAt = state.moves
        return transition(state)
      }
      if (action?.type === 'request-undo') {
        if (!canUndo(state, ctx.seatIndex)) invalid()
        const opponent = ctx.participants?.[1 - ctx.seatIndex]?.kind
        if (opponent === 'bot' || opponent === 'agent') return undo(state, ctx.seatIndex)
        state.undo = { requester: ctx.seatIndex }
        state.turn = 1 - ctx.seatIndex
        return transition(state)
      }
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
      state.history ??= []
      state.history.push(state.lastMove)
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
      return state.result ? finishRound(state) : transition(state)
    },
    exit(state, ctx) {
      if (state.result) return transition(state)
      if (ctx.seatIndex !== 0 && ctx.seatIndex !== 1) invalid()
      const winner = 1 - ctx.seatIndex
      state.result = { winners: [winner], scores: [winner === 0 ? 1 : 0, winner === 1 ? 1 : 0] }
      state.betweenRounds = false
      state.reason = 'resigned'
      return transition(state)
    },
    timeout(state, ctx) {
      if (state.result || ctx.seatIndex !== state.turn) invalid()
      if (state.betweenRounds) return nextRound(state)
      if (state.undo) {
        state.turn = state.undo.requester
        state.undo = null
        state.rejectedUndoAt = state.moves
        return transition(state)
      }
      const winner = 1 - state.turn
      state.result = { winners: [winner], scores: [winner === 0 ? 1 : 0, winner === 1 ? 1 : 0] }
      state.reason = 'timeout'
      return finishRound(state)
    },
    observe(state, seatIndex, ctx) {
      const SIZE = state.size ?? 15
      if (seatIndex !== null && seatIndex !== 0 && seatIndex !== 1) throw Error('invalid_seat')
      return {
        kind: 'gomoku',
        roundNo: state.roundNo ?? 1,
        rounds: state.rounds ?? 1,
        scores: state.scores,
        betweenRounds: !!state.betweenRounds,
        participants: ctx?.participants ?? [],
        size: SIZE,
        selfSeat: seatIndex,
        board: state.board,
        turn: state.result ? null : state.turn,
        undo: state.undo ?? null,
        canUndo: canUndo(state, seatIndex),
        legalActions: !state.result && seatIndex === state.turn
          ? state.betweenRounds ? [{ type: 'next-round' }] : state.undo
            ? [{ type: 'approve-undo' }, { type: 'reject-undo' }]
            : [
              ...state.board.flatMap((cell, i) =>
                cell === null ? [{ type: 'place', x: i % SIZE, y: Math.floor(i / SIZE) }] : []
              ),
              ...(canUndo(state, seatIndex) ? [{ type: 'request-undo' }] : []),
            ]
          : [],
        moves: state.moves,
        lastMove: state.lastMove,
        result: state.result ?? state.roundResult,
        reason: state.reason || null,
      }
    },
  }
})()
