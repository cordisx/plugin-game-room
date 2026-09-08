globalThis.render = (view, context) => {
  const text = (value, tone = 'default') => ({ type: 'text', text: value, tone })
  const stack = children => ({ type: 'stack', children })
  const scene = children => ({ version: 1, root: stack(children) })
  const grid = (columns, children) => ({ type: 'grid', columns, children })
  const row = children => ({ type: 'stack', direction: 'horizontal', children })
  const button = (label, action) => ({ type: 'button', label, action, disabled: !context.canAct })
  const card = value =>
    value === null ? '◆' : `${'23456789TJQKA'[value % 13]}${'♠♥♦♣'[Math.floor(value / 13)]}`
  if (!view || view.kind !== 'holdem') return scene([text('等待本手开始', 'muted')])
  const streets = {
    preflop: '翻牌前',
    flop: '翻牌',
    turn: '转牌',
    river: '河牌',
    finished: '本手结束',
  }
  const controls = []
  if (context.canAct) {
    for (const action of view.legalActions) {
      if (action.type === 'raise') {
        controls.push({
          type: 'number-action',
          label: '加注至',
          min: action.minTo,
          max: action.maxTo,
          step: 1,
          value: action.minTo,
          action: { type: 'raise' },
          valueKey: 'to',
        })
      } else {controls.push(
          button(
            ({
              fold: '弃牌',
              check: '过牌',
              call: `跟注 ${action.amount}`,
              'all-in': `全下至 ${action.to}`,
            })[action.type],
            { type: action.type },
          ),
        )}
    }
  }
  const player = view.players[view.selfSeat]
  return scene([
    text(
      view.result
        ? `本手结束 · 你的筹码 ${player.stack}`
        : view.turn === view.selfSeat && context.canAct
        ? '轮到你行动'
        : `等待 ${view.turn + 1} 号位`,
      'accent',
    ),
    text(`${streets[view.street]} · 盲注 ${view.smallBlind} / ${view.bigBlind}`, 'muted'),
    grid(
      Math.min(4, view.players.length),
      view.players.map(p =>
        stack([
          text(
            `${p.seat + 1} 号位${p.seat === view.selfSeat ? ' · 你' : ''}${
              p.seat === view.button ? ' · D' : ''
            }`,
            p.seat === view.turn ? 'accent' : 'default',
          ),
          text(`筹码 ${p.stack} · 本轮 ${p.bet}`),
          text(p.folded ? '已弃牌' : p.allIn ? '全下' : '在局中', 'muted'),
          ...(view.result && p.seat !== view.selfSeat ? [text(p.hole.map(card).join('  '))] : []),
        ])
      ),
    ),
    text(
      view.result
        ? `已分配 ${view.pots.reduce((sum, pot) => sum + pot.amount, 0)} 筹码`
        : `底池 ${view.pot}`,
    ),
    row(
      (view.board.length ? view.board : [null, null, null, null, null]).map(value =>
        text(card(value), 'accent')
      ),
    ),
    text('你的底牌', 'muted'),
    row(player.hole.map(value => text(card(value), 'accent'))),
    { type: 'stack', direction: 'horizontal', children: controls },
    text('单手无限注 · 超时自动过牌或弃牌 · 筹码总额守恒', 'muted'),
  ])
}
