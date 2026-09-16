/** Local release switch. Preserve Agent implementation while human game flow is being validated. */
export const AGENT_DISPATCH_ENABLED = false
const agentPages = new Set(['agents', 'agent', 'dispatch'])
export function agentPageBlocked(page: string, enabled: boolean = AGENT_DISPATCH_ENABLED) {
  return !enabled && agentPages.has(page)
}
