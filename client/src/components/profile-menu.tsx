import tokenCoin from '../assets/token-coin-128.png?inline'
import type { CordisXPageHeaderActionV4 } from 'cordisx/contracts'
import { type CurrentUserState, safeCurrentUserAvatar } from '../data/current-user-sync.js'
export const headerDestinations = ['invite', 'create', 'personal', 'settings', 'configuration'] as const
export function accountHeaderLabel(currentUser?: CurrentUserState) {
  const profile = currentUser?.status === 'available' ? currentUser : undefined
  return profile?.displayName
    ? { key: 'header.current-user-account', fallback: `${profile.displayName} · 个人菜单` }
    : { key: 'header.account', fallback: '个人菜单' }
}
/** Immutable public metadata. The Host owns avatar fallback, menu, focus and command dispatch. */
export function pageHeaderActions(page: string, currentUser?: CurrentUserState): readonly CordisXPageHeaderActionV4[] {
  const profile = currentUser?.status === 'available' ? currentUser : undefined
  const avatar = safeCurrentUserAvatar(profile?.avatar)
  return [
    ...(page === 'lobby'
      ? [
        {
          id: 'invite',
          label: { key: 'header.invite', fallback: '邀请加入' },
          icon: 'host:link' as const,
          command: { id: 'open-invite' },
        },
        {
          id: 'create',
          presentation: 'primary' as const,
          variant: 'outlined' as const,
          label: { key: 'header.create', fallback: '开一局' },
          icon: 'host:new' as const,
          command: { id: 'open-create' },
        },
      ]
      : []),
    ...(page === 'prepare'
      ? [
        {
          id: 'room-details',
          presentation: 'icon' as const,
          label: { key: 'header.room-details', fallback: '房间详情' },
          icon: 'host:info' as const,
          command: { id: 'room-details' },
        },
        {
          id: 'room-leave',
          presentation: 'icon' as const,
          label: { key: 'header.room-leave', fallback: '离开房间' },
          icon: 'host:log-out' as const,
          command: { id: 'room-leave' },
        },
      ]
      : []),
    {
      id: 'balance',
      presentation: 'text' as const,
      visual: { kind: 'image' as const, src: tokenCoin, position: 'trailing' as const },
      label: { key: 'header.balance', fallback: '—' },
      ariaLabel: { key: 'header.balance-unknown', fallback: 'Token 余额未知' },
      tooltip: { key: 'header.balance-action', fallback: '查看收支明细' },
      command: { id: 'open-ledger' },
    },
    {
      id: 'account',
      label: accountHeaderLabel(currentUser),
      visual: { kind: 'avatar', ...(avatar ? { src: avatar } : {}) },
      menu: [
        {
          id: 'personal',
          icon: 'host:people',
          label: { key: 'header.personal', fallback: '个人中心' },
          command: { id: 'open-personal' },
        },
        {
          id: 'settings',
          icon: 'host:link',
          label: { key: 'header.settings', fallback: '服务器来源' },
          command: { id: 'open-settings' },
        },
        {
          id: 'configuration',
          icon: 'host:settings',
          label: { key: 'header.configuration', fallback: '配置' },
          command: { id: 'open-configuration' },
        },
      ],
    },
  ]
}
