;(() => {
  const invalid = () => {
    throw Error('invalid_action')
  }
  const sum = values => values.reduce((a, b) => a + b, 0)
  const active = player => !player.folded && player.stack > 0
  function next(state, after, predicate) {
    for (let n = 1; n <= state.players.length; n++) {
      const index = (after + n) % state.players.length
      if (predicate(state.players[index], index)) return index
    }
    return null
  }
  function pay(player, amount) {
    const paid = Math.min(player.stack, amount)
    player.stack -= paid
    player.bet += paid
    player.total += paid
  }
  function transition(state) {
    return state.result ? { state, turn: null, done: state.result } : { state, turn: state.turn }
  }
  function settle(state, uncontested) {
    const players = state.players
    const awards = players.map(() => 0)
    const levels = [...new Set(players.map(p => p.total).filter(Boolean))].sort((a, b) => a - b)
    const winners = new Set()
    const ranks = players.map(p =>
      !p.folded && !uncontested ? holdemEvaluate([...p.hole, ...state.board]) : 0
    )
    state.pots = []
    let previous = 0
    for (const level of levels) {
      const contributors = players.map((p, i) => p.total >= level ? i : -1).filter(i => i >= 0)
      const amount = (level - previous) * contributors.length
      previous = level
      // A one-contributor layer is an uncalled wager, returned even without showdown.
      const eligible = contributors.filter(i => !players[i].folded)
      if (!eligible.length && contributors.length !== 1) throw Error('invalid_pot')
      const best = Math.max(...eligible.map(i => ranks[i]))
      const recipients = contributors.length === 1
        ? contributors
        : eligible.filter(i => ranks[i] === best)
      const ordered = recipients.slice().sort((a, b) =>
        (a - state.button - 1 + players.length) % players.length
        - (b - state.button - 1 + players.length) % players.length
      )
      const share = Math.floor(amount / ordered.length)
      ordered.forEach((index, i) => {
        awards[index] += share + (i < amount % ordered.length ? 1 : 0)
        if (contributors.length > 1) winners.add(index)
      })
      state.pots.push({ amount, eligible, winners: ordered, refund: contributors.length === 1 })
    }
    players.forEach((p, i) => {
      p.stack += awards[i]
    })
    if (sum(players.map(p => p.stack)) !== state.initialStack * players.length) {
      throw Error('chip_conservation')
    }
    state.showdown = !uncontested
    state.street = 'finished'
    state.turn = null
    const payouts = players.map(p => p.stack)
    state.result = {
      winners: [...winners].sort((a, b) => a - b),
      scores: payouts.map(n => n - state.initialStack),
      payouts,
    }
    return transition(state)
  }
  function dealStreet(state) {
    state.burns.push(state.deck.pop())
    const count = state.street === 'preflop' ? 3 : 1
    for (let i = 0; i < count; i++) state.board.push(state.deck.pop())
    state.street = state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : 'river'
    state.currentBet = 0
    state.lastFullRaise = state.bigBlind
    state.players.forEach(p => {
      p.bet = 0
      p.actedAt = null
    })
    state.pending = state.players.map(active)
  }
  function advance(state, after) {
    if (state.players.filter(p => !p.folded).length === 1) return settle(state, true)
    const able = state.players.map((p, i) => active(p) ? i : -1).filter(i => i >= 0)
    // A lone player cannot bet into opponents who are all-in, but must face an outstanding call.
    if (able.length === 1 && state.players[able[0]].bet >= state.currentBet) {
      state.pending[able[0]] = false
    }
    const turn = next(state, after, (p, i) => active(p) && state.pending[i])
    if (turn !== null) {
      state.turn = turn
      return transition(state)
    }
    if (state.street === 'river') return settle(state, false)
    dealStreet(state)
    if (able.length < 2) {
      while (state.street !== 'river') dealStreet(state)
      return settle(state, false)
    }
    state.turn = next(state, state.button, active)
    return transition(state)
  }
  function legal(state, seat) {
    if (state.result || seat !== state.turn) return []
    const p = state.players[seat]
    const call = Math.max(0, state.currentBet - p.bet)
    const max = p.bet + p.stack
    const canRaise = (p.actedAt === null || state.currentBet - p.actedAt >= state.lastFullRaise)
      && state.players.some((other, i) => i !== seat && active(other))
    const result = [
      { type: 'fold' },
      call ? { type: 'call', amount: Math.min(call, p.stack) } : { type: 'check' },
    ]
    if (canRaise && max > state.currentBet) {
      const min = state.currentBet + state.lastFullRaise
      if (max >= min) result.push({ type: 'raise', minTo: min, maxTo: max })
      result.push({ type: 'all-in', to: max })
    } else if (max <= state.currentBet) result.push({ type: 'all-in', to: max })
    return result
  }
  function act(state, action, ctx) {
    if (!action || typeof action !== 'object' || state.result || ctx.seatIndex !== state.turn) {
      invalid()
    }
    const options = legal(state, ctx.seatIndex)
    const option = options.find(o => o.type === action.type)
    if (!option) invalid()
    const seat = state.turn, p = state.players[seat]
    let target = p.bet
    if (action.type === 'fold') p.folded = true
    else if (action.type === 'call') target = Math.min(state.currentBet, p.bet + p.stack)
    else if (action.type === 'all-in') target = p.bet + p.stack
    else if (action.type === 'raise') {
      if (
        !Number.isSafeInteger(action.to) || action.to < option.minTo || action.to > option.maxTo
      ) invalid()
      target = action.to
    }
    const increase = target - state.currentBet
    pay(p, target - p.bet)
    if (increase > 0) {
      if (increase >= state.lastFullRaise) state.lastFullRaise = increase
      state.currentBet = target
      state.players.forEach((other, i) => {
        if (i !== seat && active(other) && other.bet < target) state.pending[i] = true
      })
    }
    p.actedAt = state.currentBet
    state.pending[seat] = false
    state.lastAction = { seat, type: action.type, to: target }
    return advance(state, seat)
  }
  globalThis.game = {
    setup(ctx) {
      const config = ctx.config || {}
      const initialStack = ctx.mode === 'token' ? ctx.stake : (config.initialStack ?? 1000)
      const bigBlind = config.bigBlind ?? Math.max(2, Math.floor(initialStack / 50))
      const smallBlind = config.smallBlind ?? Math.max(1, Math.floor(bigBlind / 2))
      if (
        ctx.seats.length < 2 || ctx.seats.length > 8
        || !Number.isSafeInteger(initialStack) || initialStack < 2 || initialStack > 1000000000
        || !Number.isSafeInteger(bigBlind) || bigBlind < 2 || bigBlind > initialStack
        || !Number.isSafeInteger(smallBlind) || smallBlind < 1 || smallBlind >= bigBlind
        || (ctx.mode === 'token' && ctx.policy !== 'conserved-payouts-v1')
      ) throw Error('invalid_config')
      const count = ctx.seats.length
      const deck = Array.from({ length: 52 }, (_, i) => i)
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      const button = Math.floor(ctx.random() * count)
      const players = ctx.seats.map(() => ({
        stack: initialStack,
        bet: 0,
        total: 0,
        hole: [],
        folded: false,
        actedAt: null,
      }))
      for (let round = 0; round < 2; round++) {
        for (let offset = 1; offset <= count; offset++) {
          players[(button + offset) % count].hole.push(deck.pop())
        }
      }
      const sb = count === 2 ? button : (button + 1) % count
      const bb = (sb + 1) % count
      pay(players[sb], smallBlind)
      pay(players[bb], bigBlind)
      const state = {
        players,
        initialStack,
        bigBlind,
        smallBlind,
        button,
        smallBlindSeat: sb,
        bigBlindSeat: bb,
        deck,
        burns: [],
        board: [],
        street: 'preflop',
        currentBet: bigBlind,
        lastFullRaise: bigBlind,
        pending: players.map(active),
        turn: null,
        result: null,
        showdown: false,
        pots: [],
        lastAction: null,
      }
      return advance(state, bb)
    },
    act,
    timeout(state, ctx) {
      const options = legal(state, ctx.seatIndex)
      return act(state, { type: options.some(o => o.type === 'check') ? 'check' : 'fold' }, ctx)
    },
    observe(state, seatIndex) {
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.players.length) {
        throw Error('invalid_seat')
      }
      return {
        kind: 'holdem',
        selfSeat: seatIndex,
        turn: state.turn,
        street: state.street,
        button: state.button,
        smallBlindSeat: state.smallBlindSeat,
        bigBlindSeat: state.bigBlindSeat,
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        board: state.board,
        pot: state.result ? 0 : sum(state.players.map(p => p.total)),
        currentBet: state.currentBet,
        players: state.players.map((p, i) => ({
          seat: i,
          stack: p.stack,
          bet: p.bet,
          total: p.total,
          folded: p.folded,
          allIn: !p.folded && p.stack === 0 && !state.result,
          hole: i === seatIndex || (state.showdown && !p.folded) ? p.hole : [null, null],
        })),
        legalActions: legal(state, seatIndex),
        lastAction: state.lastAction,
        pots: state.pots,
        result: state.result,
      }
    },
  }
})()
