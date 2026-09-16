// Modest deterministic rules opponent. Only its own cards, public board and legal menu are inspected.
globalThis.bot = view => {
  if (view.betweenHands) return { type: 'next-hand' }
  const own = view.players[view.selfSeat]
  const ranks = own.hole.map(card => card % 13 + 2)
  const pair = ranks[0] === ranks[1]
  const connects = view.board.some(card => ranks.includes(card % 13 + 2))
  const strong = pair || connects || Math.min(...ranks) >= 11
  const menu = view.legalActions
  const raise = menu.find(action => action.type === 'raise')
  if (strong && raise && raise.minTo <= own.bet + Math.floor(own.stack / 4)) {
    return { type: 'raise', to: raise.minTo }
  }
  const check = menu.find(action => action.type === 'check')
  if (check) return { type: 'check' }
  const call = menu.find(action => action.type === 'call')
  if (call && (strong || call.amount <= Math.max(view.bigBlind * 2, Math.floor(own.stack / 8)))) {
    return { type: 'call' }
  }
  return { type: 'fold' }
}
