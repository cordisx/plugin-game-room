/* Game UI code runs only in the sandboxed frame. Authority stays with the server. */
globalThis.ui = (() => {
  const root = document.querySelector('main')
  let current, busy = false, notice = '', optimisticReady
  const node = (tag, className = '', text = '') => {
    const el = document.createElement(tag)
    el.className = className
    el.textContent = text
    return el
  }
  const button = (label, action, disabled = false, className = '') => {
    const el = node('button', className, label)
    el.type = 'button'
    el.disabled = disabled || busy
    el.addEventListener('click', async () => {
      const requestedSequence = current?.sequence
      busy = true
      paint()
      const result = await action()
      if (result.status === 'rejected') notice = '操作未执行，请按最新局面重试'
      else if (result.status === 'uncertain') notice = '连接待确认，请重新同步'
      else notice = ''
      busy = result.status === 'uncertain' && current?.sequence === requestedSequence
      paint()
    })
    return el
  }
  const readinessButton = (ready, action) => {
    const label = ready ? '取消准备' : '准备'
    const el = button('', action, false, 'seat-ready-action')
    el.title = label
    el.setAttribute('aria-label', label)
    el.setAttribute('aria-pressed', String(Boolean(ready)))
    el.setAttribute('aria-busy', String(busy))
    el.dataset.ready = String(Boolean(ready))
    el.dataset.busy = String(busy)
    const icon = node('span', 'seat-ready-icon')
    icon.setAttribute('aria-hidden', 'true')
    el.append(icon)
    return el
  }
  const playerAvatar = (participant, seat) => {
    const avatar = node(
      'span',
      `seat-avatar avatar-${seat % 4}`,
      participant?.kind === 'bot'
        ? ''
        : participant?.name?.startsWith('guest_')
        ? '人'
        : participant?.name?.slice(0, 1).toUpperCase() || '人',
    )
    avatar.setAttribute('aria-label', participant?.kind === 'bot' ? '规则电脑头像' : '玩家头像')
    if (participant?.kind === 'bot') {
      const icon = node('span', 'seat-avatar-icon')
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3m-2 0h4M4 12H2m18 0h2M9 16h6"/><circle cx="8.5" cy="12" r=".75"/><circle cx="15.5" cy="12" r=".75"/></svg>'
      avatar.append(icon)
    }
    if (
      typeof participant?.avatar === 'string' && participant.avatar.length <= 65536
      && /^data:image\/(?:png|jpeg|webp);base64,(?=[A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\s\S])/
        .test(participant.avatar)
    ) {
      const image = node('img')
      image.src = participant.avatar
      image.alt = ''
      image.referrerPolicy = 'no-referrer'
      image.addEventListener('error', () => image.remove(), { once: true })
      avatar.append(image)
    }
    const owner = ownerBadge(participant)
    if (owner) avatar.append(owner)
    return avatar
  }
  const ownerBadge = participant => {
    if (!participant?.isOwner) return null
    const badge = node('span', 'room-owner')
    badge.innerHTML = roomOwnerSvg
    badge.title = '房主'
    badge.setAttribute('aria-label', '房主')
    return badge
  }
  function paint() {
    root.replaceChildren()
    if (!current) {
      root.append(node('p', 'muted', '正在连接对局…'))
      return
    }
    root.dataset.state = current.status
    root.dataset.actionable = String(current.canAct && !current.readOnly && !busy)
    root.dataset.readOnly = String(current.readOnly)
    const phase = node(
      'span',
      'sr-only',
      current.readOnly
        ? '只读观战'
        : current.status === 'finished'
        ? '本局结束'
        : current.canAct
        ? '你的回合'
        : '等待其他玩家',
    )
    phase.setAttribute('role', 'status')
    root.append(phase)
    const roomAction = async operation => {
      if (operation === 'ready') optimisticReady = true
      if (operation === 'cancel-ready') optimisticReady = false
      if (operation === 'ready' || operation === 'cancel-ready') paint()
      const result = await GameUI.requestRoomAction(operation)
      if (result.status !== 'accepted') optimisticReady = undefined
      return result
    }
    if (current.observation) {
      root.append(
        renderGame(current, {
          node,
          button,
          readinessButton,
          playerAvatar,
          act: payload => GameUI.action(payload),
          roomAction,
          optimisticReady,
          busy,
        }),
      )
    } else root.append(node('p', 'muted', '等待对局开始'))
    const roomActions = current.roomActions ?? []
    const lifecycle = node('div', 'room-lifecycle')
    lifecycle.setAttribute('aria-label', '房间流程')
    if (roomActions.includes('funding')) {
      lifecycle.append(button('确认本局投入', () => roomAction('funding'), false, 'primary'))
    }
    if (roomActions.includes('start')) {
      lifecycle.append(button('开始对局', () => roomAction('start'), false, 'primary'))
    }
    if (roomActions.includes('next-round')) {
      lifecycle.append(button('下一局准备', () => GameUI.requestNextRound(), false, 'primary'))
    }
    if (lifecycle.children.length) root.append(lifecycle)
    if (notice) {
      const el = node('p', 'notice', notice)
      el.setAttribute('role', 'status')
      root.append(el)
    }
  }
  GameUI.subscribe(value => {
    if (!current || value.sequence > current.sequence) {
      busy = false
      optimisticReady = undefined
    }
    current = value
    paint()
  })
  return { node, button }
})()
