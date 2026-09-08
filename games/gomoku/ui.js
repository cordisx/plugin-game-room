;(() => {
  let observation = null
  let pending = false
  const board = document.getElementById('board')
  const error = document.getElementById('error')
  const cells = Array.from({ length: 225 }, (_, index) => {
    const button = document.createElement('button')
    button.className = 'point'
    button.disabled = true
    button.onclick = async () => {
      if (!observation || pending) return
      pending = true
      draw(observation)
      error.textContent = ''
      try {
        await gameAdapter.send({ type: 'place', x: index % 15, y: Math.floor(index / 15) })
      } catch (e) {
        error.textContent = e.message
      } finally {
        pending = false
        draw(observation)
      }
    }
    board.append(button)
    return button
  })
  function draw(view) {
    observation = view
    if (!view || view.kind !== 'gomoku') {
      document.getElementById('status').textContent = '等待本手开始'
      document.getElementById('moves').textContent = '15 × 15'
      cells.forEach(button => {
        button.disabled = true
        button.dataset.stone = ''
        button.dataset.last = 'false'
      })
      return
    }
    document.getElementById('status').textContent = view.result
      ? view.result.winners.length
        ? `${view.result.winners[0] === 0 ? '黑' : '白'}方获胜${
          view.reason === 'timeout' ? '（对手超时）' : ''
        }`
        : '平局'
      : view.turn === view.selfSeat
      ? `轮到你（${view.selfSeat === 0 ? '黑' : '白'}方）`
      : '等待对手落子'
    document.getElementById('moves').textContent = `第 ${view.moves} 手`
    cells.forEach((button, index) => {
      const stone = view.board[index]
      button.dataset.stone = stone === null ? '' : String(stone)
      button.dataset.last = String(view.lastMove?.y * 15 + view.lastMove?.x === index)
      button.disabled = pending || view.turn !== view.selfSeat || stone !== null || !!view.result
      button.setAttribute(
        'aria-label',
        `${index % 15 + 1} 列 ${Math.floor(index / 15) + 1} 行，${
          stone === null ? '空位' : stone === 0 ? '黑子' : '白子'
        }`,
      )
    })
  }
  draw(null)
  gameAdapter.subscribe(draw)
})()
