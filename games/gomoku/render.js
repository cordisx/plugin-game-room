globalThis.render = (view, context) => {
  const text = (value, tone = 'default') => ({ type: 'text', text: value, tone })
  const stack = children => ({ type: 'stack', children })
  const scene = children => ({ version: 1, root: stack(children) })
  if (!view || view.kind !== 'gomoku') return scene([text('等待本手开始', 'muted')])
  const turn = !view.result && view.turn === view.selfSeat && context.canAct
  const status = view.result
    ? view.result.winners.length
      ? `${view.result.winners[0] === 0 ? '黑' : '白'}方获胜${
        view.reason === 'timeout' ? '（对手超时）' : ''
      }`
      : '平局'
    : turn
    ? `轮到你（${view.selfSeat === 0 ? '黑' : '白'}方）`
    : '等待对手落子'
  const last = view.lastMove ? view.lastMove.y * view.size + view.lastMove.x : -1
  return scene([
    text(status, turn || view.result ? 'accent' : 'default'),
    text(`第 ${view.moves} 手 · 黑 ● / 白 ○`, 'muted'),
    {
      type: 'grid',
      columns: view.size,
      children: view.board.map((stone, index) => ({
        type: 'button',
        label: stone === null
          ? '·'
          : stone === 0
          ? index === last ? '◉' : '●'
          : index === last
          ? '◎'
          : '○',
        ariaLabel: `${index % view.size + 1} 列 ${Math.floor(index / view.size) + 1} 行，${
          stone === null ? '空位' : stone === 0 ? '黑子' : '白子'
        }`,
        action: { type: 'place', x: index % view.size, y: Math.floor(index / view.size) },
        disabled: !turn || stone !== null,
      })),
    },
    text(
      view.lastMove
        ? `最后落子：${view.lastMove.x + 1} 列 ${view.lastMove.y + 1} 行`
        : '选择空位落子',
      'muted',
    ),
    text('连成至少五子获胜 · 超时判负', 'muted'),
  ])
}
