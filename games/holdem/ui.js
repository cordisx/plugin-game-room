// Shortcuts are total street bets: currentBet + a fraction of the current pot.
// Every selection is clamped to the server's legal raise-to interval, step 1.
globalThis.pokerAmount = (bounds, value) =>
  Math.min(
    bounds.maxTo,
    Math.max(bounds.minTo, Number.isFinite(value) ? Math.round(value) : bounds.minTo),
  )
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
  const v = state.observation
  const container = node('section', 'holdem')
  container.dataset.phase = v.phase === 'waiting' || v.phase === 'funding' ? v.phase : 'playing'
  container.setAttribute('aria-label', '德州扑克桌面')
  const stage = node('div', 'table-stage')
  const actions = node('div', 'actions')
  actions.setAttribute('aria-label', '游戏操作')
  container.append(stage, actions)
  if (v.phase === 'waiting' || v.phase === 'funding') {
    const identities = state.participants ?? v.participants
    const count = v.capacity ?? Math.max(v.minPlayers, v.participants.length)
    const selfPosition = identities[v.selfSeat]?.seatIndex ?? v.selfSeat ?? 0
    stage.dataset.players = count
    stage.append(node('div', 'table-felt'))
    const center = node('div', 'table-center')
    const status = node('h2', '', v.phase === 'funding' ? '等待投入确认' : '等待开局')
    status.setAttribute('role', 'status')
    center.append(status)
    if (v.phase === 'waiting') {
      center.append(node('span', 'muted', `至少 ${v.minPlayers} 人即可开局`))
    }
    stage.append(center)
    for (let i = 0; i < count; i++) {
      const ordinal = identities.findIndex((p, ordinal) => (p.seatIndex ?? ordinal) === i)
      const p = v.participants[ordinal]
      const identity = identities[ordinal]
      const relative = (i - selfPosition + count) % count
      const angle = Math.PI / 2 + relative * 2 * Math.PI / count
      const x = Math.cos(angle), y = Math.sin(angle)
      const seat = node('div', 'table-seat')
      seat.style.setProperty('--seat-x', `${50 + 48 * x}%`)
      seat.style.setProperty('--seat-y', `${50 + 47 * y}%`)
      seat.dataset.position = y > .5 ? 'bottom' : y < -.5 ? 'top' : 'side'
      const pill = node('div', 'seat-pill')
      const label = node('div', 'seat-label')
      const ready = ordinal === v.selfSeat && optimisticReady !== undefined
        ? optimisticReady
        : p?.ready
      label.append(
        node(
          'span',
          'player-name',
          p?.kind === 'bot'
            ? p.name
            : ordinal === v.selfSeat
            ? '你'
            : p
            ? `${i + 1} 号位玩家`
            : '空席',
        ),
        node('span', 'seat-stack', p ? ready ? '已准备' : '未准备' : '等待加入'),
      )
      label.querySelector('.player-name').title = p?.name ?? '空席'
      pill.append(
        playerAvatar(identity, i),
        label,
      )
      if (ordinal === v.selfSeat && p) {
        const operation = ready ? 'cancel-ready' : 'ready'
        if (state.roomActions?.includes(operation) || optimisticReady !== undefined) {
          pill.append(
            readinessButton(ready, () => roomAction(operation)),
          )
        }
      }
      seat.append(pill)
      stage.append(seat)
    }
    return container
  }

  const physicalLabel = ordinal =>
    (state.participants?.[ordinal]?.seatIndex ?? v.participants?.[ordinal]?.seatIndex
      ?? ordinal) + 1
  const card = (value, concealed = true) => {
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
    const suits = ['♠', '♥', '♦', '♣']
    const el = node(
      'span',
      `card ${
        value === null
          ? concealed ? 'back' : 'slot'
          : [1, 2].includes(Math.floor(value / 13))
          ? 'face red'
          : 'face'
      }`,
    )
    if (value !== null) {
      el.append(
        node('span', 'card-rank', ranks[value % 13]),
        node('span', 'card-suit', suits[Math.floor(value / 13)]),
      )
    }
    el.setAttribute(
      'aria-label',
      value === null
        ? concealed ? '未公开的手牌' : '尚未发出的公共牌'
        : `${['黑桃', '红桃', '方块', '梅花'][Math.floor(value / 13)]}${ranks[value % 13]}`,
    )
    return el
  }
  const title = node(
    'h2',
    'sr-only',
    v.result ? '本手结束' : state.canAct ? '轮到你行动' : `等待 ${physicalLabel(v.turn)} 号位`,
  )
  title.setAttribute('role', 'status')
  container.append(title)
  stage.dataset.players = v.players.length
  const felt = node('div', 'table-felt')
  stage.append(felt)
  const center = node('div', 'table-center')
  const pot = node('div', 'pot-pill')
  pot.append(
    node('span', 'muted', v.result ? '本手分配' : '底池'),
    node(
      'strong',
      '',
      String(
        v.result
          ? v.pots.reduce((sum, item) => sum + item.amount, 0)
          : v.pot,
      ),
    ),
  )
  const community = node('div', 'cards community')
  community.setAttribute('aria-label', '公共牌')
  Array.from({ length: 5 }, (_, i) => v.board[i] ?? null).forEach(c =>
    community.append(card(c, false))
  )
  center.append(pot, community)
  stage.append(center)
  const anchor = Number.isInteger(v.selfSeat) ? v.selfSeat : 0
  const positions = state.participants ?? []
  const seatCount = Math.max(v.players.length, ...positions.map(p => p.seatIndex + 1))
  const anchorPosition = positions[anchor]?.seatIndex ?? anchor
  v.players.forEach(p => {
    const identity = positions[p.seat] ?? v.participants?.[p.seat]
    const position = identity?.seatIndex ?? p.seat
    const relative = (position - anchorPosition + seatCount) % seatCount
    const angle = Math.PI / 2 + relative * 2 * Math.PI / seatCount
    const x = Math.cos(angle), y = Math.sin(angle)
    const self = p.seat === v.selfSeat
    const seat = node(
      'div',
      `table-seat ${p.seat === v.turn ? 'active' : ''} ${p.folded ? 'folded' : ''} ${
        self ? 'self' : ''
      }`,
    )
    seat.style.setProperty('--seat-x', `${50 + 48 * x}%`)
    seat.style.setProperty('--seat-y', `${50 + 47 * y}%`)
    seat.dataset.position = y > .5 ? 'bottom' : y < -.5 ? 'top' : 'side'
    seat.setAttribute(
      'aria-label',
      `${position + 1} 号位${self ? '，你' : ''}，筹码 ${p.stack}${
        p.seat === v.turn ? '，正在行动' : ''
      }`,
    )
    if (!p.folded) {
      const hand = node('div', `cards seat-cards ${self ? 'own-cards' : 'opponent-cards'}`)
      hand.setAttribute('aria-label', self ? '你的底牌' : `${position + 1} 号位手牌`)
      p.hole.forEach(value => hand.append(card(value)))
      seat.append(hand)
    }
    const pill = node('div', 'seat-pill')
    const avatar = playerAvatar(identity, p.seat)
    const label = node('div', 'seat-label')
    label.append(
      node(
        'span',
        'player-name',
        `${position + 1} 号位${
          v.participants?.[p.seat]?.kind === 'bot' ? ' · 规则电脑' : self ? ' · 你' : ''
        }`,
      ),
      node('span', 'seat-stack', `${p.stack} 筹码`),
    )
    label.querySelector('.player-name').title = identity?.name ?? `${position + 1} 号位`
    pill.append(avatar, label)
    if (p.seat === v.button) pill.append(node('span', 'dealer', 'D'))
    seat.append(pill)
    if (p.folded || p.allIn) seat.append(node('span', 'seat-status', p.folded ? '已弃牌' : '全下'))
    stage.append(seat)
    if (p.bet > 0) {
      const bet = node('span', 'seat-bet', String(p.bet))
      bet.style.left = `${50 + 30 * x + (y > .8 ? 25 : 0)}%`
      bet.style.top = `${50 + 24 * y}%`
      bet.setAttribute('aria-label', `${position + 1} 号位本轮下注 ${p.bet}`)
      stage.append(bet)
    }
  })
  if (state.readOnly) {
    actions.append(node('p', 'spectator-note muted', '只读观战 · 不展示私有底牌'))
  }
  if (v.betweenHands) {
    actions.append(node('span', 'muted', `第 ${v.handNo} / ${v.rounds} 手`))
    if (state.canAct && !state.readOnly) {
      actions.append(button('下一手', () => act({ type: 'next-hand' }), busy))
    }
  }
  if (state.canAct && !state.readOnly && !v.result) {
    const lower = node('div', 'action-bar')
    const raise = v.legalActions.find(action => action.type === 'raise')
    const allIn = v.legalActions.find(action => action.type === 'all-in')
    for (
      const action of v.legalActions.filter(action =>
        ['fold', 'call', 'check'].includes(action.type)
      )
    ) {
      const text = { fold: '弃牌', check: '过牌', call: `跟注 ${action.amount}` }[action.type]
      lower.append(button(text, () => act({ type: action.type }), busy))
    }
    if (raise) {
      let amount = raise.minTo
      let valid = true
      const upper = node('div', 'amount-bar')
      const shortcuts = node('div', 'bet-shortcuts')
      const slider = node('input', 'bet-slider')
      slider.type = 'range'
      slider.min = raise.minTo
      slider.max = raise.maxTo
      slider.step = 1
      slider.value = amount
      slider.disabled = busy
      slider.setAttribute('aria-label', '加注至金额')
      const label = node('label', 'bet-amount-label', '加注至')
      const input = node('input', 'bet-amount')
      input.type = 'number'
      input.min = raise.minTo
      input.max = raise.maxTo
      input.step = 1
      input.value = amount
      input.disabled = busy
      input.setAttribute('aria-label', `加注至，${raise.minTo} 到 ${raise.maxTo}`)
      label.append(input)
      const submit = button(
        `加注至 ${amount}`,
        () =>
          valid
            ? act(allIn && amount === allIn.to ? { type: 'all-in' } : { type: 'raise', to: amount })
            : Promise.resolve({ status: 'rejected' }),
        busy,
        'primary',
      )
      const update = value => {
        amount = pokerAmount(raise, value)
        valid = true
        input.value = amount
        slider.value = amount
        submit.disabled = busy
        submit.textContent = allIn && amount === allIn.to ? `全下 ${amount}` : `加注至 ${amount}`
        for (const preset of shortcuts.children) {
          preset.setAttribute('aria-pressed', String(Number(preset.dataset.amount) === amount))
        }
      }
      const options = [['最小', raise.minTo], ['½ 底池', v.currentBet + Math.round(v.pot / 2)], [
        '底池',
        v.currentBet + v.pot,
      ], [allIn ? '全下' : '最大', raise.maxTo]]
      for (const [text, value] of options) {
        const preset = node('button', '', text)
        preset.type = 'button'
        preset.disabled = busy
        preset.dataset.amount = pokerAmount(raise, value)
        preset.title = text.includes('底池')
          ? '本轮最高下注加对应底池比例，并限制在合法加注至范围内'
          : `加注至 ${preset.dataset.amount}`
        preset.addEventListener('click', () => update(value))
        shortcuts.append(preset)
      }
      slider.addEventListener('input', () => update(slider.valueAsNumber))
      input.addEventListener('input', () => {
        const value = input.valueAsNumber
        valid = Number.isSafeInteger(value) && value >= raise.minTo && value <= raise.maxTo
        submit.disabled = busy || !valid
        if (valid) {
          amount = value
          slider.value = amount
          submit.textContent = allIn && amount === allIn.to ? `全下 ${amount}` : `加注至 ${amount}`
        }
      })
      input.addEventListener('change', () => update(input.valueAsNumber))
      upper.append(shortcuts, slider, label)
      actions.append(upper)
      lower.append(submit)
      update(amount)
    } else if (allIn) {
      lower.append(button(`全下 ${allIn.to}`, () => act({ type: 'all-in' }), busy, 'primary'))
    }
    actions.append(lower)
  }
  if (v.result) {
    actions.append(node(
      'p',
      'muted',
      v.result.winners.length
        ? `获胜：${v.result.winners.map(i => `${physicalLabel(i)} 号位`).join('、')}`
        : '本手已结算',
    ))
  }
  return container
}
