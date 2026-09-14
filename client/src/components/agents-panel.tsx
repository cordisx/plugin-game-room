import { useState } from 'cordisx/react'
import { AgentAvatar, Button } from 'cordisx/ui'
import type { Agent, Dispatch, Room } from '../data/model.js'
import type { PanelResource } from '../data/use-panel-resource.js'
import { PanelState } from './panel-state.js'
import { Symbol } from './icons.js'
import '../styles/agent-directory.css'
export function AgentsPanel({ resource, tasks, rooms, select, configure, unavailable }: {
  resource: PanelResource<Agent>
  tasks: PanelResource<Dispatch>
  rooms: Room[]
  select: (agent: Agent) => void
  configure: () => void
  unavailable?: string
}) {
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState('info')
  const agent = resource.data.find(agent => agent.id === selected) ?? resource.data[0]
  return (
    <section className='gr-agent-directory' aria-label='代理'>
      <PanelState
        resource={resource}
        empty='暂无代理'
        description='配置对局伙伴后可在这里查看。'
        action='配置代理'
        next={configure}
      >
        <div className='gr-agent-picker' aria-label='选择代理'>
          {resource.data.map(item => (
            <Button
              key={item.id}
              variant='ghost'
              className='gr-agent-choice'
              aria-pressed={item.id === agent?.id}
              onClick={() => {
                setSelected(item.id)
                setTab('info')
              }}
            >
              <span className='gr-panel-avatar'>
                <AgentAvatar participant={{ id: item.id, name: item.name }} fallback='initials' />
              </span>
              <span>{item.name}</span>
            </Button>
          ))}
        </div>
        {agent && (
          <div className='gr-agent-detail'>
            <div className='gr-agent-portrait'>
              <AgentAvatar
                style={{ width: '100%', height: 'auto', lineHeight: 1, textAlign: 'center' }}
                participant={{ id: agent.id, name: agent.name }}
                fallback='initials'
              />
            </div>
            <div
              className='gr-agent-information'
              role='tabpanel'
              id='gr-agent-detail-panel'
              aria-label={tab === 'info' ? '基础信息' : '参与对局'}
            >
              {tab === 'info'
                ? (
                  <>
                    <h2>基础信息</h2>
                    <dl className='gr-agent-facts'>
                      <div>
                        <dt>
                          <Symbol name='personal' size={15} />名称
                        </dt>
                        <dd>{agent.name}</dd>
                      </div>
                      <div>
                        <dt>
                          <Symbol name='document' size={15} />简介
                        </dt>
                        <dd>{agent.description || '暂无简介'}</dd>
                      </div>
                      <div>
                        <dt>
                          <Symbol name='clock' size={15} />状态
                        </dt>
                        <dd>{agent.status === 'playing' ? '对局中' : '空闲'}</dd>
                      </div>
                    </dl>
                    {unavailable && <p className='gr-muted'>{unavailable}</p>}
                    <Button
                      className='gr-agent-dispatch'
                      disabled={!!unavailable || agent.status === 'playing'}
                      onClick={() => select(agent)}
                    >
                      <Symbol name='dispatch' size={16} />派遣
                    </Button>
                  </>
                )
                : (
                  <>
                    <h2>参与对局</h2>
                    <PanelState
                      resource={{ ...tasks, data: tasks.data.filter(task => task.agentId === agent.id) }}
                      empty='暂无参与记录'
                      description='此代理尚无派遣记录。'
                      action='刷新记录'
                      next={tasks.retry}
                    >
                      {tasks.data.filter(task => task.agentId === agent.id).map(task => (
                        <div className='gr-agent-participation' key={task.id}>
                          <strong>
                            {rooms.find(room =>
                              room.sourceId === task.sourceId && room.id === task.roomId
                            )?.name
                              ?? '未加载房间'}
                          </strong>
                          <span className='gr-muted'>
                            {task.state === 'running'
                              ? '进行中'
                              : task.state === 'completed'
                              ? '已结束'
                              : task.state === 'withdrawn'
                              ? '已撤回'
                              : '失败'}
                          </span>
                        </div>
                      ))}
                    </PanelState>
                  </>
                )}
            </div>
            <div
              className='gr-agent-detail-tabs'
              role='tablist'
              aria-label='代理详情'
              aria-orientation='vertical'
              onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home'
                  ? 'info'
                  : event.key === 'End'
                  ? 'games'
                  : tab === 'info'
                  ? 'games'
                  : 'info'
                setTab(next)
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === 'info' ? 0 : 1]
                  ?.focus()
              }}
            >
              {([{ id: 'info', label: '基础信息', icon: 'personal' }, {
                id: 'games',
                label: '参与对局',
                icon: 'game',
              }] as const).map(item => (
                <Button
                  key={item.id}
                  variant='ghost'
                  className='gr-square-button'
                  role='tab'
                  aria-label={item.label}
                  title={item.label}
                  aria-selected={tab === item.id}
                  tabIndex={tab === item.id ? 0 : -1}
                  aria-controls='gr-agent-detail-panel'
                  onClick={() => setTab(item.id)}
                >
                  <Symbol name={item.icon} size={16} />
                </Button>
              ))}
            </div>
          </div>
        )}
      </PanelState>
    </section>
  )
}
