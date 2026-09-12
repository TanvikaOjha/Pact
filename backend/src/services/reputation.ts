import type { DisputeVoteStore } from "../repos/disputes.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import type { ReputationEventRow, ReputationStore } from "../repos/reputation.js";
import { log } from "./log.js";

export interface CompletionDeps {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  votes: DisputeVoteStore;
  reputation: ReputationStore;
}

/**
 * Mirror of the escrow's guarded finalization: once every milestone carries a
 * release timestamp, flip the engagement to COMPLETED (idempotent — a second
 * call is a no-op, like the contract's completedEmitted guard) and append one
 * reputation row per party perspective. Disputed follows the contract's MVP
 * rule: any co-sign votes on the engagement taint it permanently.
 */
export async function recordCompletionIfNeeded(
  deps: CompletionDeps,
  engagementId: string,
): Promise<boolean> {
  const engagement = await deps.engagements.findById(engagementId);
  if (engagement === null || engagement.status === "COMPLETED") return false;
  const remaining = await deps.milestones.listByEngagement(engagementId);
  const completed =
    remaining.length > 0 && remaining.every((candidate) => candidate.released_at !== null);
  if (!completed) return false;
  if (engagement.party_a_id === null || engagement.party_b_id === null) {
    log.error(`engagement ${engagementId} completed without both parties; reputation skipped`);
    return false;
  }
  await deps.engagements.updateStatus(engagementId, "COMPLETED");
  const disputed = await deps.votes.hasVotesForEngagement(engagementId);
  const emittedAt = new Date().toISOString();
  await deps.reputation.recordCompletion([
    {
      engagementId,
      businessId: engagement.party_a_id,
      counterpartyId: engagement.party_b_id,
      templateType: engagement.template_type,
      totalValue: engagement.total_amount,
      onTime: !disputed,
      disputed,
      txHash: null,
      emittedAt,
    },
    {
      engagementId,
      businessId: engagement.party_b_id,
      counterpartyId: engagement.party_a_id,
      templateType: engagement.template_type,
      totalValue: engagement.total_amount,
      onTime: !disputed,
      disputed,
      txHash: null,
      emittedAt,
    },
  ]);
  log.info(`reputation recorded: engagement ${engagementId} disputed=${disputed}`);
  return true;
}

/** Score formula version. Bump when weights change; attested on-chain alongside. */
export const SCORE_VERSION = 1;

/** Tier cutoffs on score. Tier 0 additionally covers <3 completed engagements. */
export const TIER_NEW_CUTOFF = 200;
export const TIER_ESTABLISHED_CUTOFF = 550;
export const TIER_TRUSTED_CUTOFF = 800;

export interface PactScore {
  score: number;
  tier: number;
  version: number;
}

export function tierForScore(score: number, completedCount: number): number {
  if (completedCount < 3 || score < TIER_NEW_CUTOFF) return 0;
  if (score < TIER_ESTABLISHED_CUTOFF) return 1;
  if (score < TIER_TRUSTED_CUTOFF) return 2;
  return 3;
}

/**
 * Pact Score v1 from mirrored reputation events (deterministic, integer math).
 * Weights: history depth 40/engagement (cap 400) + settled value $250/point
 * (cap 200) + punctuality share (cap 200) − dispute share (cap 150) + 50 for
 * World-verified identity. Wash-trade dampening and default flags arrive with
 * the bonds mirror; until then the dispute penalty is the gaming backstop.
 */
export function scoreForEvents(events: ReputationEventRow[], worldVerified: boolean): PactScore {
  const completedCount = events.length;
  let totalValue = 0;
  let onTimeCount = 0;
  let disputeCount = 0;
  for (const event of events) {
    totalValue += event.total_value;
    if (event.on_time) onTimeCount += 1;
    if (event.disputed) disputeCount += 1;
  }
  const countPoints = Math.min(400, 40 * completedCount);
  const valuePoints = Math.min(200, Math.floor(totalValue / 250));
  const punctualityPoints =
    completedCount === 0 ? 0 : Math.round((200 * onTimeCount) / completedCount);
  const disputePenalty =
    completedCount === 0 ? 0 : Math.round((150 * disputeCount) / completedCount);
  const worldBonus = worldVerified ? 50 : 0;
  const score = Math.min(
    1000,
    Math.max(0, countPoints + valuePoints + punctualityPoints - disputePenalty + worldBonus),
  );
  return { score, tier: tierForScore(score, completedCount), version: SCORE_VERSION };
}
