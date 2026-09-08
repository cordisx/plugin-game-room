import type { Json, Mode } from './index.js'

export type SceneNode =
  | { type: 'text'; text: string; tone?: 'default' | 'muted' | 'accent' }
  | { type: 'stack'; direction?: 'vertical' | 'horizontal'; children: SceneNode[] }
  | { type: 'grid'; columns: number; children: SceneNode[] }
  | { type: 'button'; label: string; action: Json; disabled?: boolean; ariaLabel?: string }
  | {
    type: 'number-action'
    label: string
    min: number
    max: number
    step: number
    value: number
    action: { [key: string]: Json }
    valueKey: string
  }
export interface Scene {
  version: 1
  root: SceneNode
}
export interface ViewContext {
  seatIndex: number
  seatCount: number
  mode: Mode
  canAct: boolean
}
export const sceneLimits = Object.freeze({
  bytes: 65536,
  nodes: 1024,
  depth: 16,
  children: 400,
  text: 2048,
  actionBytes: 4096,
  actionDepth: 16,
})
const encoder = new TextEncoder()
const dangerous = new Set(['__proto__', 'prototype', 'constructor'])
function ensure(value: unknown): asserts value {
  if (!value) throw new Error('invalid_scene')
}
function record(value: unknown): asserts value is Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value))
  const proto = Object.getPrototypeOf(value)
  ensure(proto === Object.prototype || proto === null)
  for (const key of Reflect.ownKeys(value)) {
    ensure(typeof key === 'string' && !dangerous.has(key))
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    ensure(Object.hasOwn(descriptor, 'value') && descriptor.enumerable)
  }
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  ensure(Object.keys(value).every(key => allowed.includes(key)))
}
function array(value: unknown): asserts value is unknown[] {
  ensure(Array.isArray(value))
  ensure(Reflect.ownKeys(value).length === value.length + 1)
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    ensure(descriptor && Object.hasOwn(descriptor, 'value'))
  }
}
function action(value: unknown, depth: number): void {
  ensure(depth <= sceneLimits.actionDepth)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    ensure(Number.isFinite(value))
    return
  }
  if (Array.isArray(value)) {
    array(value)
    for (const child of value) action(child, depth + 1)
    return
  }
  record(value)
  for (const child of Object.values(value)) action(child, depth + 1)
}
/** Validate at both server output and trusted renderer input. No HTML/CSS/URL primitives. */
export function parseScene(value: unknown): Scene {
  let nodes = 0
  function visit(node: unknown, depth: number): void {
    ensure(++nodes <= sceneLimits.nodes && depth <= sceneLimits.depth)
    record(node)
    if (node.type === 'text') {
      keys(node, ['type', 'text', 'tone'])
      ensure(typeof node.text === 'string' && node.text.length <= sceneLimits.text)
      ensure(node.tone === undefined || ['default', 'muted', 'accent'].includes(node.tone as string))
    } else if (node.type === 'button') {
      keys(node, ['type', 'label', 'action', 'disabled', 'ariaLabel'])
      ensure(typeof node.label === 'string' && node.label.length <= sceneLimits.text)
      ensure(node.disabled === undefined || typeof node.disabled === 'boolean')
      ensure(
        node.ariaLabel === undefined
          || (typeof node.ariaLabel === 'string' && node.ariaLabel.length <= sceneLimits.text),
      )
      ensure(Object.hasOwn(node, 'action'))
      action(node.action, 1)
      ensure(encoder.encode(JSON.stringify(node.action)).length <= sceneLimits.actionBytes)
    } else if (node.type === 'number-action') {
      keys(node, ['type', 'label', 'min', 'max', 'step', 'value', 'action', 'valueKey'])
      ensure(typeof node.label === 'string' && node.label.length <= sceneLimits.text)
      for (const key of ['min', 'max', 'step', 'value']) ensure(Number.isSafeInteger(node[key]))
      const { min, max, step, value } = node as { min: number; max: number; step: number; value: number }
      ensure(
        min <= value && value <= max && step > 0 && Number.isSafeInteger(max - min) && Number.isSafeInteger(value - min)
          && (value - min) % step === 0,
      )
      ensure(
        typeof node.valueKey === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(node.valueKey)
          && !dangerous.has(node.valueKey),
      )
      record(node.action)
      action(node.action, 1)
      ensure(encoder.encode(JSON.stringify(node.action)).length <= sceneLimits.actionBytes)
      for (const amount of [min, max, value]) {
        ensure(
          encoder.encode(JSON.stringify({ ...node.action, [node.valueKey]: amount })).length <= sceneLimits.actionBytes,
        )
      }
    } else if (node.type === 'stack' || node.type === 'grid') {
      keys(node, node.type === 'stack' ? ['type', 'direction', 'children'] : ['type', 'columns', 'children'])
      if (node.type === 'stack') {
        ensure(node.direction === undefined || ['vertical', 'horizontal'].includes(node.direction as string))
      } else ensure(Number.isInteger(node.columns) && (node.columns as number) >= 1 && (node.columns as number) <= 19)
      array(node.children)
      ensure(node.children.length <= sceneLimits.children)
      for (const child of node.children) visit(child, depth + 1)
    } else throw new Error('invalid_scene')
  }
  record(value)
  keys(value, ['version', 'root'])
  ensure(value.version === 1)
  visit(value.root, 1)
  ensure(encoder.encode(JSON.stringify(value)).length <= sceneLimits.bytes)
  return value as unknown as Scene
}
