// Offline author feedback. The server and trusted Host independently validate the protocol.
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const fail = () => {
  throw Error('Invalid scene-v1')
}
function keys(value, allowed) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))
  ) fail()
}
function json(value, depth = 1) {
  if (depth > 16) fail()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(item => json(item, depth + 1))
    return
  }
  if (typeof value !== 'object') fail()
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail()
    json(item, depth + 1)
  }
}
function action(value) {
  json(value)
  if (bytes(value) > 4096) fail()
}
function label(value) {
  if (typeof value !== 'string' || value.length > 2048) fail()
}
export function validateScene(scene) {
  keys(scene, ['version', 'root'])
  if (scene.version !== 1 || bytes(scene) > 64 * 1024) fail()
  let nodes = 0
  function walk(node, depth) {
    if (++nodes > 1024 || depth > 16) fail()
    if (node?.type === 'text') {
      keys(node, ['type', 'text', 'tone'])
      label(node.text)
      if (node.tone !== undefined && !['default', 'muted', 'accent'].includes(node.tone)) fail()
    } else if (node?.type === 'button') {
      keys(node, ['type', 'label', 'ariaLabel', 'action', 'disabled'])
      label(node.label)
      if (node.ariaLabel !== undefined) label(node.ariaLabel)
      if (node.disabled !== undefined && typeof node.disabled !== 'boolean') fail()
      action(node.action)
    } else if (node?.type === 'number-action') {
      keys(node, ['type', 'label', 'min', 'max', 'step', 'value', 'action', 'valueKey'])
      label(node.label)
      if (
        ![node.min, node.max, node.step, node.value, node.max - node.min, node.value - node.min]
          .every(Number.isSafeInteger)
        || node.min > node.value || node.value > node.max || node.step <= 0
        || (node.value - node.min) % node.step !== 0
        || typeof node.valueKey !== 'string' || node.valueKey.length > 64
        || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.valueKey)
        || ['__proto__', 'prototype', 'constructor'].includes(node.valueKey) || !node.action
        || typeof node.action !== 'object' || Array.isArray(node.action)
      ) fail()
      action(node.action)
      for (const amount of [node.min, node.max, node.value]) {
        action({ ...node.action, [node.valueKey]: amount })
      }
    } else if (node?.type === 'stack' || node?.type === 'grid') {
      keys(
        node,
        node.type === 'stack' ? ['type', 'direction', 'children'] : ['type', 'columns', 'children'],
      )
      if (
        node.type === 'stack' && node.direction !== undefined
        && !['vertical', 'horizontal'].includes(node.direction)
      ) fail()
      if (
        node.type === 'grid'
        && (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > 19)
      ) fail()
      if (!Array.isArray(node.children) || node.children.length > 400) fail()
      node.children.forEach(child => walk(child, depth + 1))
    } else fail()
  }
  walk(scene.root, 1)
  return scene
}
