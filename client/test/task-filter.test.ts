import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterTasks } from '../src/data/task-filter.js'
import type { Agent, Dispatch, Room } from '../src/data/model.js'
test('task search uses agent and source-scoped room names and keeps active/history separate', () => {
  const agents = [{ id: 'a', name: 'Mochi' }] as Agent[]
  const rooms = [{ id: 'same', sourceId: 'one', name: '朋友来一局' }, {
    id: 'same',
    sourceId: 'two',
    name: '周末房间',
  }] as Room[]
  const tasks = [
    { id: '1', agentId: 'a', sourceId: 'one', roomId: 'same', state: 'running' },
    { id: '2', agentId: 'a', sourceId: 'two', roomId: 'same', state: 'completed' },
    { id: '3', agentId: 'a', sourceId: 'one', roomId: 'same', state: 'withdrawn' },
  ] as Dispatch[]
  assert.deepEqual(filterTasks(tasks, agents, rooms, ' MOCHI ', 'active').map(t => t.id), ['1'])
  assert.deepEqual(filterTasks(tasks, agents, rooms, '朋友', 'history').map(t => t.id), ['3'])
  assert.deepEqual(filterTasks(tasks, agents, rooms, '周末', 'active'), [])
  assert.deepEqual(filterTasks(tasks, agents, rooms, '', 'history').map(t => t.id), ['2', '3'])
  assert.equal(filterTasks(tasks, [], [], 'a', 'active').length, 1)
})
