import type { InputHTMLAttributes } from 'cordisx/react'
/** Business text entry; Host configuration continues to use its schema form. */
export function TextInput(
  { value, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string
    onChange: (value: string) => void
  },
) {
  return <input {...props} className='gr-input' value={value} onChange={event => onChange(event.target.value)} />
}
