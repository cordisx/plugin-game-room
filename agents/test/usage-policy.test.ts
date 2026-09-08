import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGameUsageExclusion, WORK_USAGE_POLICY } from '../usage-policy.ts';
import type { AdoptedWorkUsageLedger } from '../usage-policy.ts';

const adopted: AdoptedWorkUsageLedger = {
  schemaVersion: 2,
  policyId: WORK_USAGE_POLICY,
  scopeId: 'profile',
  sourceId: 'work-ledger',
  epoch: 'work-epoch',
};
const snapshot = {
  ...adopted,
  status: 'ready',
  revision: 1,
  eligibleTokens: 50,
  inputTokens: 40,
  outputTokens: 10,
  enabledAt: 100,
  observedThrough: 200,
  coverage: 'partial',
  diagnostics: [],
  classification: {
    version: 'host-game-cwd-v1',
    hostGameTasks: 'excluded',
    forksAndSubagents: 'excluded',
    unknownSources: 'excluded',
  },
};

test('work v2 exclusion requires both exact live policy and reward-owner adoption of its ledger', () => {
  assert.equal(checkGameUsageExclusion(snapshot).aggregateRewards, 'unknown');
  assert.deepEqual(checkGameUsageExclusion(snapshot, adopted), {
    aggregateRewards: 'disabled-or-game-excluded',
    reason: 'work-ledger-excludes-game-tasks',
  });
  assert.equal(snapshot.eligibleTokens, 50); // Verification never changes usage or credits anything.
});
test('v1, unsupported classification and unavailable work projection cannot establish an excluded game source', () => {
  for (
    const value of [
      null,
      { status: 'unavailable' },
      { ...snapshot, schemaVersion: 1 },
      { ...snapshot, policyId: 'codex-local-input-output-v1' },
      ...['hostGameTasks', 'forksAndSubagents', 'unknownSources'].map(key => ({
        ...snapshot,
        classification: { ...snapshot.classification, [key]: 'included' },
      })),
      { ...snapshot, classification: { ...snapshot.classification, version: 'unknown' } },
    ]
  ) {
    assert.equal(checkGameUsageExclusion(value, adopted).aggregateRewards, 'unknown');
  }
});
test('a changed work epoch, source or profile requires a new adopted baseline, never a v1 watermark', () => {
  for (const key of ['epoch', 'sourceId', 'scopeId']) {
    assert.equal(
      checkGameUsageExclusion({ ...snapshot, [key]: 'changed' }, adopted).reason,
      'work-usage-baseline-required',
    );
  }
  assert.equal(
    checkGameUsageExclusion(
      snapshot,
      { ...adopted, schemaVersion: 1 } as unknown as AdoptedWorkUsageLedger,
    ).reason,
    'work-usage-baseline-required',
  );
});
