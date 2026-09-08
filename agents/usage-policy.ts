import type { WorkUsageSnapshotV2 } from '@cordisx/protocol/usage/v2';

type ReadyWorkUsage = Extract<WorkUsageSnapshotV2, { status: 'ready'; }>;
export const WORK_USAGE_POLICY =
  'codex-local-work-input-output-v2' as const satisfies ReadyWorkUsage['policyId'];
/** Supplied by the trusted reward owner only after adopting a new v2 ledger baseline. */
export type AdoptedWorkUsageLedger = Pick<
  ReadyWorkUsage,
  'schemaVersion' | 'policyId' | 'scopeId' | 'sourceId' | 'epoch'
>;
export type GameUsageExclusionCheck =
  | { aggregateRewards: 'disabled-or-game-excluded'; reason: 'work-ledger-excludes-game-tasks'; }
  | {
    aggregateRewards: 'unknown';
    reason:
      | 'work-usage-unavailable'
      | 'work-usage-policy-mismatch'
      | 'work-usage-baseline-required';
  };

/**
 * Validates the live projection and the reward owner's adopted ledger identity.
 * Presence of readWork alone does not prove that a separate reward source uses it.
 * This helper never creates a baseline, computes token deltas or issues rewards.
 */
export function checkGameUsageExclusion(
  snapshot: unknown,
  adopted?: AdoptedWorkUsageLedger,
): GameUsageExclusionCheck {
  const unknown = (
    reason: Extract<GameUsageExclusionCheck, { aggregateRewards: 'unknown'; }>['reason'],
  ): GameUsageExclusionCheck => ({ aggregateRewards: 'unknown', reason });
  if (
    !snapshot || typeof snapshot !== 'object' || !('status' in snapshot)
    || snapshot.status !== 'ready'
  ) {
    return unknown('work-usage-unavailable');
  }
  const value = snapshot as Record<string, unknown>;
  const classification = value.classification as Record<string, unknown> | undefined;
  if (
    value.schemaVersion !== 2 || value.policyId !== WORK_USAGE_POLICY
    || !classification || classification.version !== 'host-game-cwd-v1'
    || classification.hostGameTasks !== 'excluded'
    || classification.forksAndSubagents !== 'excluded'
    || classification.unknownSources !== 'excluded' || value.coverage !== 'partial'
    || !['scopeId', 'sourceId', 'epoch'].every(key =>
      typeof value[key] === 'string' && value[key] !== ''
    )
  ) {
    return unknown('work-usage-policy-mismatch');
  }
  if (
    !adopted || adopted.schemaVersion !== 2 || adopted.policyId !== WORK_USAGE_POLICY
    || adopted.scopeId !== value.scopeId || adopted.sourceId !== value.sourceId
    || adopted.epoch !== value.epoch
  ) {
    return unknown('work-usage-baseline-required');
  }
  return {
    aggregateRewards: 'disabled-or-game-excluded',
    reason: 'work-ledger-excludes-game-tasks',
  };
}
