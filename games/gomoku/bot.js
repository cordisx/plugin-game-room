// Deterministic, observation-only: win, block, then extend open lines near the centre.
globalThis.bot = view => {
  const { board, size, selfSeat, legalActions } = view
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
  function strength(x, y, seat) {
    let score = 0
    for (const [dx, dy] of dirs) {
      let count = 1, open = 0
      for (const sign of [-1, 1]) {
        let xx = x + dx * sign, yy = y + dy * sign
        while (xx >= 0 && xx < size && yy >= 0 && yy < size && board[yy * size + xx] === seat) {
          count++
          xx += dx * sign
          yy += dy * sign
        }
        if (xx >= 0 && xx < size && yy >= 0 && yy < size && board[yy * size + xx] === null) open++
      }
      if (count >= 5) return 1000000
      score += open ? 10 ** count * open : 0
    }
    return score
  }
  let best = null, bestScore = -Infinity
  for (const action of legalActions) {
    const own = strength(action.x, action.y, selfSeat)
    const other = strength(action.x, action.y, 1 - selfSeat)
    const score = own >= 1000000 ? 100000000 : other >= 1000000
      ? 10000000
      : own + other * .9 - Math.abs(action.x - (size - 1) / 2) - Math.abs(action.y - (size - 1) / 2)
    if (score > bestScore) {
      best = action
      bestScore = score
    }
  }
  if (!best) throw Error('no_legal_action')
  return best
}
