import assert from 'node:assert/strict'
import test from 'node:test'
import { HostHttpTransport } from '../src/data/host-http.js'
import type { HttpClientV4 } from '@cordisx/protocol/plugin-http/v4'
test('Game transport exposes no local-wallet bearer login or signer', () => {
  const transport = new HostHttpTransport({ contract: 'cordisx.http-client/v4' } as HttpClientV4)
  assert.equal('connectEconomyAccount' in transport, false)
  assert.equal('reserve' in transport, false)
  assert.equal('applyDecision' in transport, false)
})
