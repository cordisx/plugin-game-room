import { requireThat } from './errors.js'
export type AccessPolicy = 'guest-allowed' | 'login-required'
export function accessPolicy(options: { accessPolicy?: AccessPolicy; requireLogin?: boolean }): AccessPolicy {
  if (options.accessPolicy !== undefined) {
    requireThat(['guest-allowed', 'login-required'].includes(options.accessPolicy), 'invalid_access_policy')
    requireThat(
      options.requireLogin === undefined || options.requireLogin === (options.accessPolicy === 'login-required'),
      'conflicting_access_policy',
    )
    return options.accessPolicy
  }
  return options.requireLogin ? 'login-required' : 'guest-allowed'
}
/** Normal local launch requires login by default; deployed hosts may explicitly opt into guests. */
export function configuredAccessPolicy(environment: Record<string, string | undefined>): AccessPolicy {
  const configured = environment.AUTH_POLICY
  requireThat(
    configured === undefined || configured === 'guest-allowed' || configured === 'login-required',
    'invalid_access_policy',
  )
  requireThat(
    environment.REQUIRE_LOGIN === undefined || ['true', 'false'].includes(environment.REQUIRE_LOGIN),
    'invalid_access_policy',
  )
  return accessPolicy({
    ...(configured ? { accessPolicy: configured as AccessPolicy } : {}),
    ...(environment.REQUIRE_LOGIN !== undefined ? { requireLogin: environment.REQUIRE_LOGIN === 'true' } : {}),
    ...(configured === undefined && environment.REQUIRE_LOGIN === undefined ? { accessPolicy: 'login-required' } : {}),
  })
}
