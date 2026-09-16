import { lstatSync, readFileSync } from 'node:fs'
import { ApiError, object, requireThat } from './errors.js'
import type { ManagedAccountTrust } from './managed-auth.js'
/** Launcher-provisioned server keys remain a private server input, never plugin configuration. */
export function loadManagedAccountTrust(path: string): ManagedAccountTrust {
  const stat = lstatSync(path)
  requireThat(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.size <= 65536, 'invalid_managed_trust')
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new ApiError(400, 'invalid_managed_trust')
  }
  object(value)
  requireThat(
    Object.keys(value).length === 3 && ['binding', 'hostPublicKey', 'serverPrivateKey'].every(key => key in value),
    'invalid_managed_trust',
  )
  object(value.binding)
  const binding = value.binding
  requireThat(
    Object.keys(binding).length === 4
      && ['origin', 'sourceId', 'instanceId', 'audience'].every(key => key in binding)
      && typeof binding.origin === 'string' && typeof binding.sourceId === 'string'
      && typeof binding.instanceId === 'string' && binding.audience === 'source-account'
      && typeof value.hostPublicKey === 'string' && value.hostPublicKey.length <= 16384
      && typeof value.serverPrivateKey === 'string' && value.serverPrivateKey.length <= 16384,
    'invalid_managed_trust',
  )
  return {
    binding: {
      origin: binding.origin,
      sourceId: binding.sourceId,
      instanceId: binding.instanceId,
      audience: 'source-account',
    },
    hostPublicKey: value.hostPublicKey,
    serverPrivateKey: value.serverPrivateKey,
  }
}
