import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import type { DisputeProposalStore, DisputeVoteStore } from "../repos/disputes.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import type { ReputationStore } from "../repos/reputation.js";
import { log } from "../services/log.js";
import {
  disputeRaisedEmail,
  disputeResolvedEmail,
  disputeVoteEmail,
  notifyAll,
  recipientEmails,
  resolutionChallengedEmail,
  resolutionProposedEmail,
  type Notifier,
} from "../services/notifications.js";
import { recordCompletionIfNeeded } from "../services/reputation.js";
import {
  isParty,
  loadMilestoneContext,
} from "./engagements.js";

const resolveRequestSchema = z.object({
  providerAmount: z.number().int().min(0),
  clientRefund: z.number().int().min(0),
});

export interface DisputesRouteOptions {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  businesses: BusinessStore;
  votes: DisputeVoteStore;
  proposals: DisputeProposalStore;
  reputation: ReputationStore;
  notify: Notifier;
  /** Null when escrow reads are unavailable; raise recording proceeds (dev/offchain path). */
  checkDisputed: ((onChainId: string, index: number) => Promise<boolean | null>) | null;
}

/** Fallback challenge window (spec M3 default: 7 days) when terms omit one. */
const DEFAULT_CHALLENGE_WINDOW_SECONDS = 7 * 24 * 3600;

/**
 * POST .../dispute — record a raised dispute (freezes the milestone in the
 * mirror; funds stay in escrow until co-signed resolution, per contract).
 *
 * POST .../resolve — record one party's split proposal. When the counterparty
 * has voted identical amounts (the quorum rule in resolveDispute), the mirror
 * resolves: undisputed, released, engagement ACTIVE-or-COMPLETED.
 *
 * POST .../resolve-propose — mirror an on-chain optimistic resolution
 * proposal (proposeResolution). Requires the milestone to be disputed.
 *
 * POST .../resolve-challenge — mirror an on-chain challenge of the open
 * proposal (challengeResolution). The proposer cannot challenge their own.
 */
export function createDisputesRouter(options: DisputesRouteOptions): Router {
  const router = Router();
  router.post("/engagements/:id/milestones/:index/dispute", (req: Request, res: Response, next: NextFunction) => {
    void handleRaise(req, res, options).catch(next);
  });
  router.post("/engagements/:id/milestones/:index/resolve", (req: Request, res: Response, next: NextFunction) => {
    void handleResolve(req, res, options).catch(next);
  });
  router.post("/engagements/:id/milestones/:index/resolve-propose", (req: Request, res: Response, next: NextFunction) => {
    void handleResolvePropose(req, res, options).catch(next);
  });
  router.post("/engagements/:id/milestones/:index/resolve-challenge", (req: Request, res: Response, next: NextFunction) => {
    void handleResolveChallenge(req, res, options).catch(next);
  });
  return router;
}

async function handleRaise(
  req: Request,
  res: Response,
  options: DisputesRouteOptions,
): Promise<void> {
  const context = await loadMilestoneContext(req, res, options);
  if (!context.ok) return;
  const { engagement, milestone, index } = context;
  if (milestone.released_at !== null) {
    res.status(409).json({ error: "already_released" });
    return;
  }
  if (milestone.disputed) {
    res.status(409).json({ error: "already_disputed" });
    return;
  }
  if (options.checkDisputed !== null) {
    const disputed = await options.checkDisputed(engagement.on_chain_id, index);
    if (disputed === false) {
      res.status(409).json({ error: "not_disputed_onchain" });
      return;
    }
  }
  await options.milestones.setDisputed(milestone.id, true);
  await options.engagements.updateStatus(engagement.id, "DISPUTED");
  log.info(`dispute raised: engagement ${engagement.id} milestone ${index}`);
  const raiser =
    req.identity === undefined
      ? null
      : await options.businesses.findByWallet(req.identity.walletAddress);
  await notifyAll(
    options.notify,
    await recipientEmails(options.businesses, engagement, raiser?.id),
    disputeRaisedEmail(engagement.ens_subname, milestone.name, index),
  );
  res.json({ disputed: true });
}

async function handleResolve(
  req: Request,
  res: Response,
  options: DisputesRouteOptions,
): Promise<void> {
  const context = await loadMilestoneContext(req, res, options);
  if (!context.ok) return;
  const { engagement, milestone, index } = context;
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  if (!milestone.disputed) {
    res.status(409).json({ error: "not_disputed" });
    return;
  }
  if (milestone.released_at !== null) {
    res.status(409).json({ error: "already_released" });
    return;
  }
  const parsed = resolveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { providerAmount, clientRefund } = parsed.data;
  if (providerAmount + clientRefund !== milestone.amount) {
    res.status(400).json({ error: "amounts_mismatch" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null || !isParty(engagement, business.id)) {
    res.status(403).json({ error: "not_a_party" });
    return;
  }
  await options.votes.recordVote({
    engagementId: engagement.id,
    milestoneIndex: index,
    walletAddress: identity.walletAddress,
    providerAmount,
    clientRefund,
  });
  const counterpartyId =
    engagement.party_a_id === business.id ? engagement.party_b_id : engagement.party_a_id;
  const counterparty = counterpartyId === null ? null : await options.businesses.findById(counterpartyId);
  if (counterparty === null) {
    throw new Error(`engagement ${engagement.id} is missing a counterparty row`);
  }
  const match = await options.votes.findMatchingCounterVote(
    engagement.id,
    index,
    providerAmount,
    clientRefund,
    identity.walletAddress,
  );
  if (match === null || match.wallet_address !== counterparty.wallet_address) {
    log.info(`dispute vote recorded (awaiting counterparty): engagement ${engagement.id} milestone ${index}`);
    await notifyAll(
      options.notify,
      await recipientEmails(options.businesses, engagement, business.id),
      disputeVoteEmail(engagement.ens_subname, milestone.name, index, providerAmount, clientRefund),
    );
    res.json({ resolved: false });
    return;
  }
  const releasedAt = new Date().toISOString();
  await options.milestones.markResolved(milestone.id, releasedAt);
  await options.engagements.updateStatus(engagement.id, "ACTIVE");
  const engagementCompleted = await recordCompletionIfNeeded(
    {
      engagements: options.engagements,
      milestones: options.milestones,
      votes: options.votes,
      reputation: options.reputation,
    },
    engagement.id,
  );
  log.info(`dispute resolved: engagement ${engagement.id} milestone ${index}`);
  await notifyAll(
    options.notify,
    await recipientEmails(options.businesses, engagement),
    disputeResolvedEmail(engagement.ens_subname, milestone.name, index),
  );
  res.json({ resolved: true, releasedAt, engagementCompleted });
}

async function handleResolvePropose(
  req: Request,
  res: Response,
  options: DisputesRouteOptions,
): Promise<void> {
  const context = await loadMilestoneContext(req, res, options);
  if (!context.ok) return;
  const { engagement, milestone, index } = context;
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  if (!milestone.disputed) {
    res.status(409).json({ error: "not_disputed" });
    return;
  }
  if (milestone.released_at !== null) {
    res.status(409).json({ error: "already_released" });
    return;
  }
  const parsed = resolveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { providerAmount, clientRefund } = parsed.data;
  if (providerAmount + clientRefund !== milestone.amount) {
    res.status(400).json({ error: "amounts_mismatch" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null || !isParty(engagement, business.id)) {
    res.status(403).json({ error: "not_a_party" });
    return;
  }
  const windowSeconds = engagement.challenge_window_seconds ?? DEFAULT_CHALLENGE_WINDOW_SECONDS;
  const challengeDeadline = new Date(Date.now() + windowSeconds * 1000).toISOString();
  await options.proposals.upsertProposal({
    engagementId: engagement.id,
    milestoneIndex: index,
    providerAmount,
    clientRefund,
    proposerWallet: identity.walletAddress,
    challengeDeadline,
  });
  log.info(`resolution proposed: engagement ${engagement.id} milestone ${index}`);
  await notifyAll(
    options.notify,
    await recipientEmails(options.businesses, engagement, business.id),
    resolutionProposedEmail(engagement.ens_subname, milestone.name, index, providerAmount, clientRefund),
  );
  res.json({ proposed: true, challengeDeadline });
}

async function handleResolveChallenge(
  req: Request,
  res: Response,
  options: DisputesRouteOptions,
): Promise<void> {
  const context = await loadMilestoneContext(req, res, options);
  if (!context.ok) return;
  const { engagement, milestone, index } = context;
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const proposal = await options.proposals.findProposal(engagement.id, index);
  if (proposal === null) {
    res.status(404).json({ error: "proposal_not_found" });
    return;
  }
  if (proposal.proposer_wallet === identity.walletAddress) {
    res.status(400).json({ error: "self_challenge" });
    return;
  }
  await options.proposals.markChallenged(engagement.id, index);
  log.info(`resolution challenged: engagement ${engagement.id} milestone ${index}`);
  const proposer = await options.businesses.findByWallet(proposal.proposer_wallet);
  const proposerEmail = proposer?.email ?? null;
  const recipients: string[] = [];
  if (proposerEmail !== null && proposerEmail !== "") {
    recipients.push(proposerEmail);
  }
  await notifyAll(
    options.notify,
    recipients,
    resolutionChallengedEmail(engagement.ens_subname, milestone.name, index),
  );
  res.json({ challenged: true });
}
