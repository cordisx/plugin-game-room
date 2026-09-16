import { useEffect, useMemo, useState } from 'cordisx/react'
import { AgentAvatar, Button, SchemaForm } from 'cordisx/ui'
import type { Agent, Room, Source } from '../data/model.js'
import { consentFor } from '../data/model.js'
import { agentDispatchSchema, compatibleAgentRooms, validActionBudget } from '../data/confirmation.js'
import { ConfirmationLayout } from './confirmation-layout.js'
import { RoomSummary, RoomTerms } from './room-summary.js'
import { Symbol } from './icons.js'
export function AgentPanel({ agent, rooms, dispatch, busy, initialRoomKey, sources, back, unavailable }: {
  agent: Agent
  rooms: Room[]
  dispatch: (room: Room, budget: number) => void
  busy: boolean
  initialRoomKey?: string
  sources: readonly Source[]
  back: () => void
  unavailable?: string
}) {
  const compatible = compatibleAgentRooms(agent, rooms)
  const [key, setKey] = useState(initialRoomKey ?? '')
  const [budget, setBudget] = useState(30)
  const [acceptedKey, setAcceptedKey] = useState('')
  const room = compatible.find(room => `${room.sourceId}/${room.id}` === key)
  const termsKey = JSON.stringify([agent.id, key, budget, room && consentFor(room)])
  useEffect(() => {
    setAcceptedKey('')
  }, [termsKey])
  const accepted = acceptedKey === termsKey
  const schema = useMemo(() => agentDispatchSchema(compatible), [
    JSON.stringify(compatible.map(room => [room.sourceId, room.id, room.name])),
  ])
  const disabled = busy || !!unavailable || !room || agent.status !== 'idle' || !accepted || !validActionBudget(budget)
  return (
    <ConfirmationLayout
      label='Agent 授权'
      summary={<RoomSummary room={room} sources={sources} />}
      footer={
        <>
          <span className='gr-muted'>
            {agent.status === 'playing'
              ? 'Agent 正在对局中'
              : room
              ? `新增独立席位 · 最多 ${budget} 次动作`
              : '请选择兼容房间'}
          </span>
          <div className='gr-confirmation-actions'>
            <Button
              variant='ghost'
              className='gr-square-button'
              aria-label='返回调度中心'
              title='返回调度中心'
              disabled={busy}
              onClick={back}
            >
              <Symbol name='back' />
            </Button>
            <Button
              variant='primary'
              className='gr-confirmation-submit'
              disabled={disabled}
              onClick={() => {
                if (!disabled && room) dispatch(room, budget)
              }}
            >
              确认派遣
            </Button>
          </div>
        </>
      }
    >
      <div className='gr-confirmation-heading'>
        <span className='gr-panel-avatar'>
          <AgentAvatar participant={{ id: agent.id, name: agent.name }} fallback='initials' />
        </span>
        <div>
          <strong>{agent.name}</strong>
          <p className='gr-muted'>{agent.description}</p>
        </div>
      </div>
      {unavailable && <p role='status'>{unavailable}</p>}
      <div className='gr-confirmation-form'>
        <SchemaForm
          identity={`agent-dispatch-${agent.id}`}
          schema={schema}
          value={{ roomKey: key, budget }}
          locale='zh-CN'
          disabled={busy || !!unavailable || agent.status !== 'idle' || !compatible.length}
          onChange={({ value }) => {
            setKey(String(value.roomKey))
            setBudget(Number(value.budget))
          }}
        />
      </div>
      {!compatible.length && <p role='status' className='gr-muted'>暂无兼容且有空位的房间，可返回大厅选择其他房间。</p>}
      <p className='gr-muted'>为 Agent 新增独立席位，只向模型提供该席位观察；达到动作预算后停止派遣。</p>
      {room && <RoomTerms room={room} />}
      <label className='gr-confirmation-consent'>
        <input
          type='checkbox'
          disabled={busy || !room || !!unavailable || agent.status !== 'idle'}
          checked={accepted}
          onChange={event => setAcceptedKey(event.target.checked ? termsKey : '')}
        />我授权新增此 Agent 席位并同意上述版本规则与投入
      </label>
    </ConfirmationLayout>
  )
}
