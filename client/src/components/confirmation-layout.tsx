import type { ReactNode } from 'cordisx/react'
import '../styles/confirmation.css'
export function ConfirmationLayout({ children, summary, footer, label }: {
  children: ReactNode
  summary: ReactNode
  footer: ReactNode
  label: string
}) {
  return (
    <section className='gr-confirmation' aria-label={label}>
      <div className='gr-confirmation-workspace'>
        <div className='gr-confirmation-editor'>{children}</div>
        {summary}
      </div>
      <footer className='gr-confirmation-footer'>{footer}</footer>
    </section>
  )
}
