import type { DisputeVoteStore } from "../repos/disputes.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import type { ReputationStore } from "../repos/reputation.js";
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
