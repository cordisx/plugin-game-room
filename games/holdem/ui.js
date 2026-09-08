;(() => {
  let view = null
  let pending = false
  const labels = {
    preflop: '翻牌前',
    flop: '翻牌',
    turn: '转牌',
    river: '河牌',
    finished: '本手结束',
  }
  function cards(element, values) {
    element.replaceChildren()
    for (const value of values) {
      const card = document.createElement('span')
      const suit = value === null ? null : Math.floor(value / 13)
      card.className = `card${value === null ? ' hidden' : suit === 1 || suit === 2 ? ' red' : ''}`
      card.textContent = value === null ? '◆' : `${'23456789TJQKA'[value % 13]}${'♠♥♦♣'[suit]}`
      card.setAttribute('aria-label', value === null ? '未公开的牌' : card.textContent)
      element.append(card)
    }
  }
  async function send(action) {
    if (pending) return
    pending = true
    draw(view)
    document.getElementById('error').textContent = ''
    try {
      await gameAdapter.send(action)
    } catch (error) {
      document.getElementById('error').textContent = error.message
    } finally {
      pending = false
      draw(view)
    }
  }
  function draw(observation) {
    view = observation
    if (!view || view.kind !== 'holdem') return
    document.getElementById('status').textContent = view.result
      ? `本手结束 · 你的筹码 ${view.players[view.selfSeat].stack}`
      : view.turn === view.selfSeat
      ? '轮到你行动'
      : `等待 ${view.turn + 1} 号位`
    document.getElementById('blinds').textContent = `盲注 ${view.smallBlind} / ${view.bigBlind}`
    document.getElementById('street').textContent = labels[view.street]
    document.getElementById('pot').textContent = view.result
      ? `已分配 ${view.pots.reduce((sum, pot) => sum + pot.amount, 0)} 筹码`
      : `底池 ${view.pot}`
    cards(
      document.getElementById('board'),
      view.board.length ? view.board : [null, null, null, null, null],
    )
    cards(document.getElementById('hole'), view.players[view.selfSeat].hole)
    const seats = document.getElementById('seats')
    seats.replaceChildren()
    for (const player of view.players) {
      const element = document.createElement('section')
      element.className = `seat${view.turn === player.seat ? ' active' : ''}${
        player.folded ? ' folded' : ''
      }`
      const name = document.createElement('strong')
      name.textContent = `${player.seat + 1} 号位${player.seat === view.selfSeat ? ' · 你' : ''}${
        player.seat === view.button ? ' · D' : ''
      }`
      const stack = document.createElement('span')
      stack.textContent = `筹码 ${player.stack} · 本轮 ${player.bet}`
      const state = document.createElement('span')
      state.className = 'note'
      state.textContent = player.folded ? '已弃牌' : player.allIn ? '全下' : '在局中'
      element.append(name, stack, state)
      if (view.result && player.seat !== view.selfSeat) {
        const reveal = document.createElement('div')
        reveal.className = 'cards'
        cards(reveal, player.hole)
        element.append(reveal)
      }
      seats.append(element)
    }
    const actions = document.getElementById('actions')
    actions.replaceChildren()
    for (const action of view.legalActions) {
      const button = document.createElement('button')
      button.disabled = pending
      if (action.type === 'raise') {
        const input = document.createElement('input')
        input.type = 'number'
        input.min = String(action.minTo)
        input.max = String(action.maxTo)
        input.step = '1'
        input.value = String(action.minTo)
        input.disabled = pending
        input.setAttribute('aria-label', `本轮加注至，总额 ${action.minTo} 到 ${action.maxTo}`)
        button.textContent = '加注至'
        button.onclick = () => {
          if (!input.checkValidity()) {
            input.reportValidity()
            return
          }
          void send({ type: 'raise', to: Number(input.value) })
        }
        actions.append(input)
      } else {
        button.textContent = ({
          fold: '弃牌',
          check: '过牌',
          call: `跟注 ${action.amount}`,
          'all-in': `全下至 ${action.to}`,
        })[action.type]
        button.onclick = () => void send({ type: action.type })
      }
      actions.append(button)
    }
  }
  gameAdapter.subscribe(draw)
})()
