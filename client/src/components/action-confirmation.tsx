import { useRef, useState } from 'cordisx/react'
import { Dialog } from 'cordisx/ui'
import type { DialogsV1 } from '@cordisx/protocol/dialogs/v1'

/** Shared compact confirmation; the Host owns focus, chrome and overlay placement. */
export function ActionConfirmation(props: {
  service?: DialogsV1
  kind: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  disabled?: boolean
  close: () => void
  confirm: (signal: AbortSignal) => void | Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  if (!props.service) return <p role='status'>暂时无法打开确认弹窗，请重新加载插件。</p>
  return (
    <Dialog
      service={props.service}
      open
      kind={props.kind}
      title={props.title}
      size='small'
      beforeClose={() => !submitting.current}
      onOpenChange={open => {
        if (!open) props.close()
      }}
      footer={{
        status: error || undefined,
        secondaryActions: [{
          id: 'cancel',
          label: props.cancelLabel ?? '取消',
          disabled: pending,
          onAction: props.close,
        }],
        primaryAction: {
          id: 'confirm',
          label: props.confirmLabel,
          tone: props.danger ? 'danger' : 'neutral',
          disabled: props.disabled,
          pending,
          closeOnSuccess: true,
          onAction: async signal => {
            if (submitting.current || props.disabled) throw new Error('操作正在处理中')
            submitting.current = true
            setPending(true)
            setError('')
            try {
              await props.confirm(signal)
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '操作失败，请重试。')
              throw reason
            } finally {
              submitting.current = false
              setPending(false)
            }
          },
        },
      }}
    >
      <p>{props.description}</p>
    </Dialog>
  )
}
