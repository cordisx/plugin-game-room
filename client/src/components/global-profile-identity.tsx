import { useState } from 'cordisx/react'
import { Symbol } from './icons.js'
import { type CurrentUserState, safeCurrentUserAvatar } from '../data/current-user-sync.js'
export function GlobalProfileIdentity({ currentUser }: { currentUser?: CurrentUserState }) {
  const profile = currentUser?.status === 'available' ? currentUser : undefined
  const avatar = safeCurrentUserAvatar(profile?.avatar)
  const [failed, setFailed] = useState<string>()
  return (
    <div className='gr-personal-identity'>
      <span className='gr-personal-avatar'>
        {avatar && failed !== avatar
          ? <img src={avatar} alt='' onError={() => setFailed(avatar)} />
          : <Symbol name='personal' size={28} />}
      </span>
      <div>
        <h1>{profile?.displayName ?? '个人中心'}</h1>
      </div>
    </div>
  )
}
