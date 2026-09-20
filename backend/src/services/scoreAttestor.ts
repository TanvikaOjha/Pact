import type { ScoreAttestor } from "../chain/score.js";
import type { BusinessStore } from "../repos/businesses.js";
import type { ReputationStore } from "../repos/reputation.js";
import { log } from "./log.js";
import { scoreForEvents } from "./reputation.js";

export interface AttestDeps {
  businesses: BusinessStore;
  reputation: ReputationStore;
  attestor: ScoreAttestor;
}

export interface AttestResult {
  subname: string;
  score: number;
  tier: number;
  version: number;
  txHash: `0x${string}` | null;
}

/**
 * Computes Pact Score v1 from the mirrored reputation_events (the same
 * formula the reputation API already surfaces via scoreForEvents) and
 * submits it to PactScore.attestScore. This is the piece that keeps the
 * on-chain score contract and the backend's computed score from drifting
 * apart: the backend is the only score formula, PactScore is just where it
 * gets published for PactEscrow's bond-tier read (_tierOf) to see.
 */
export async function attestBusinessScore(
  deps: AttestDeps,
  businessId: string,
): Promise<AttestResult | null> {
  const business = await deps.businesses.findById(businessId);
  if (business === null) {
    log.error(`attestBusinessScore: unknown business ${businessId}`);
    return null;
  }
  const events = await deps.reputation.eventsForBusiness(businessId);
  const worldVerified = business.world_verified_at !== null && business.world_verified_at !== "";
  const computed = scoreForEvents(events, worldVerified);
  const txHash = await deps.attestor.attestScore(
    business.ens_subname,
    computed.score,
    computed.version,
  );
  if (txHash === null) {
    log.error(`attestBusinessScore: attestScore skipped/failed for ${business.ens_subname}`);
  } else {
    log.info(
      `attestBusinessScore: ${business.ens_subname} score=${computed.score} tier=${computed.tier} tx=${txHash}`,
    );
  }
  return {
    subname: business.ens_subname,
    score: computed.score,
    tier: computed.tier,
    version: computed.version,
    txHash,
  };
}

/**
 * Attests both parties of a just-completed engagement. Best-effort: a
 * failed attestation is logged, never thrown — an on-chain tier hiccup
 * must never block the release/dispute-resolution response that triggered
 * it, since attestScore is a downstream side-effect, not part of the
 * release itself.
 */
export async function attestEngagementParties(
  deps: AttestDeps,
  businessIds: (string | null)[],
): Promise<void> {
  for (const id of businessIds) {
    if (id === null) continue;
    try {
      await attestBusinessScore(deps, id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error(`attestEngagementParties threw for ${id}: ${detail.slice(0, 300)}`);
    }
  }
}