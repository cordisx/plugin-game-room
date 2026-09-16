import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_DISPATCH_ENABLED, agentPageBlocked } from '../src/data/features.js'
test('Agent entry switch defaults closed, protects direct pages, preserves human game pages', () => {
  assert.equal(AGENT_DISPATCH_ENABLED, false)
  for (const page of ['agents', 'agent', 'dispatch']) {
    assert.equal(agentPageBlocked(page), true)
    assert.equal(agentPageBlocked(page, true), false)
  }
  for (
    const page of [
      'lobby',
      'create',
      'invite',
      'prepare',
      'funding',
      'settings',
      'personal',
      'replay',
      'publish',
      'configuration',
    ]
  ) {
    assert.equal(agentPageBlocked(page), false)
  }
})
