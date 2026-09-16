import type { Agent, Dispatch, Room } from './model.js'
export function filterTasks(
  tasks: Dispatch[],
  agents: Agent[],
  rooms: Room[],
  search: string,
  period: 'active' | 'history',
) {
  const query = search.trim().toLocaleLowerCase()
  return tasks.filter(task => {
    if ((task.state === 'running') !== (period === 'active')) return false
    const agent = agents.find(agent => agent.id === task.agentId)
    const room = rooms.find(room => room.sourceId === task.sourceId && room.id === task.roomId)
    return !query
      || [agent?.name, room?.name, task.agentId, task.roomId].some(value => value?.toLocaleLowerCase().includes(query))
  })
}
