import coin from '../assets/token-coin.png'
import '../styles/token-amount.css'
export function TokenIcon({ size = 'inline' }: { size?: 'inline' | 'balance' }) {
  return (
    <span className='gr-token-icon' data-size={size} aria-hidden='true'>
      <img src={coin} alt='' />
    </span>
  )
}
export function TokenAmount({ value, signed = false, size = 'inline' }: {
  value: number | undefined
  signed?: boolean
  size?: 'inline' | 'balance'
}) {
  const amount = value === undefined ? '—' : `${signed && value > 0 ? '+' : ''}${value.toLocaleString()}`
  return (
    <span
      className='gr-token-amount'
      role='img'
      aria-label={value === undefined ? 'Token 数量未知' : `${amount} Token`}
    >
      <span>
        {amount}
        <span className='gr-token-unit'>Token</span>
      </span>
      <TokenIcon size={size} />
    </span>
  )
}
