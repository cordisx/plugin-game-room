/** Preserve the owned projection while making every author action read-only. */
export function readOnly(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const node = value as Record<string, unknown>
  if (node.type === 'number-action') return { type: 'text', text: `${node.label}: ${node.value}` }
  return {
    ...node,
    ...(node.type === 'button' ? { disabled: true } : {}),
    ...(Array.isArray(node.children) ? { children: node.children.map(readOnly) } : {}),
    ...(node.root ? { root: readOnly(node.root) } : {}),
  }
}
export function replayIndex(index: number, length: number) {
  return Math.max(0, Math.min(index, length - 1))
}
