import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import type {
  EngagementRow,
  EngagementStore,
  MilestoneRow,
  MilestoneStore,
} from "../repos/engagements.js";
import { log } from "../services/log.js";
import { releaseAfter } from "../services/scheduler.js";

const milestoneInputSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().min(1).max(200).nullable().default(null),
  description: z.string().max(2000).nullable().default(null),
  amount: z.number().positive(),
  dueDate: z.string().nullable().default(null),
});

const createEngagementSchema = z.object({
  counterpartyWallet: z.string().min(1),
  templateType: z.number().int().min(1).max(6),
  termsHash: z.string().min(1),
  totalAmount: z.number().positive(),
  onChainId: z.string().min(1).default("offchain"),
  ensSubname: z.string().min(1).default("pending.pact-hack.eth"),
  milestones: z.array(milestoneInputSchema).max(5).default([]),
});

export interface EngagementsRouteOptions {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  businesses: BusinessStore;
  /** Null when escrow reads are unavailable; recording proceeds (dev/offchain path). */
  checkReleased: ((onChainId: string, index: number) => Promise<boolean | null>) | null;
}

export function isParty(engagement: EngagementRow, businessId: string): boolean {
  return engagement.party_a_id === businessId || engagement.party_b_id === businessId;
}

export interface MilestoneContextDeps {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  businesses: BusinessStore;
}

/**
 * POST /engagements — record engagement intent between two registered
 * businesses (mirror row; funding/activation is confirmed on-chain later).
 *
 * POST /engagements/:id/milestones/:index/submit — provider completion
 * notice. Starts the acceptance window; the counterparty accepts on-chain
 * (releaseMilestone) and the backend records the release separately.
 */
export function createEngagementsRouter(options: EngagementsRouteOptions): Router {
  const router = Router();
  router.post("/engagements", (req: Request, res: Response, next: NextFunction) => {
    void handleCreate(req, res, options).catch(next);
  });
  router.post("/engagements/:id/milestones/:index/submit", (req: Request, res: Response, next: NextFunction) => {
    void handleSubmit(req, res, options).catch(next);
  });
  router.post("/engagements/:id/milestones/:index/release", (req: Request, res: Response, next: NextFunction) => {
    void handleRelease(req, res, options).catch(next);
  });
  return router;
}

async function handleCreate(
  req: Request,
  res: Response,
  options: EngagementsRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const parsed = createEngagementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const draft = parsed.data;
  const proposer = await options.businesses.findByWallet(identity.walletAddress);
  if (proposer === null) {
    res.status(403).json({ error: "business_required" });
    return;
  }
  const counterparty = await options.businesses.findByWallet(draft.counterpartyWallet);
  if (counterparty === null) {
    res.status(404).json({ error: "counterparty_not_registered" });
    return;
  }
  if (counterparty.id === proposer.id) {
    res.status(400).json({ error: "self_engagement" });
    return;
  }
  if (draft.milestones.length > 0) {
    const sum = draft.milestones.reduce((total, milestone) => total + milestone.amount, 0);
    if (sum !== draft.totalAmount) {
      res.status(400).json({ error: "terms_mismatch" });
      return;
    }
  }
  const engagement = await options.engagements.insert({
    onChainId: draft.onChainId,
    ensSubname: draft.ensSubname,
    partyAId: proposer.id,
    partyBId: counterparty.id,
    templateType: draft.templateType,
    termsHash: draft.termsHash,
    totalAmount: draft.totalAmount,
  });
  await options.milestones.insertMany(
    draft.milestones.map((milestone) => ({
      engagementId: engagement.id,
      index: milestone.index,
      name: milestone.name,
      description: milestone.description,
      amount: milestone.amount,
      dueDate: milestone.dueDate,
    })),
  );
  res.status(201).json({
    id: engagement.id,
    status: engagement.status,
    milestones: draft.milestones.length,
  });
}

async function handleSubmit(
  req: Request,
  res: Response,
  options: EngagementsRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    res.status(404).json({ error: "milestone_not_found" });
    return;
  }
  const engagement = await options.engagements.findById(req.params.id ?? "");
  if (engagement === null) {
    res.status(404).json({ error: "engagement_not_found" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null || !isParty(engagement, business.id)) {
    res.status(403).json({ error: "not_a_party" });
    return;
  }
  if (engagement.status !== "PROPOSED" && engagement.status !== "ACTIVE") {
    res.status(409).json({ error: "engagement_closed", status: engagement.status });
    return;
  }
  const milestone = await options.milestones.findByIndex(engagement.id, index);
  if (milestone === null) {
    res.status(404).json({ error: "milestone_not_found" });
    return;
  }
  if (milestone.released_at !== null) {
    res.status(409).json({ error: "already_released" });
    return;
  }
  if (milestone.disputed) {
    res.status(409).json({ error: "milestone_disputed" });
    return;
  }
  if (milestone.submitted_at !== null) {
    res.status(409).json({ error: "already_submitted", releaseAfter: releaseAfter(milestone.submitted_at) });
    return;
  }
  const submittedAt = new Date().toISOString();
  await options.milestones.markSubmitted(milestone.id, submittedAt);
  log.info(`completion submitted: engagement ${engagement.id} milestone ${index}`);
  res.json({ submittedAt, releaseAfter: releaseAfter(submittedAt) });
}

export async function loadMilestoneContext(
  req: Request,
  res: Response,
  options: MilestoneContextDeps,
): Promise<
  | { ok: false }
  | { ok: true; engagement: EngagementRow; milestone: MilestoneRow; index: number }
> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return { ok: false };
  }
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    res.status(404).json({ error: "milestone_not_found" });
    return { ok: false };
  }
  const engagement = await options.engagements.findById(req.params.id ?? "");
  if (engagement === null) {
    res.status(404).json({ error: "engagement_not_found" });
    return { ok: false };
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null || !isParty(engagement, business.id)) {
    res.status(403).json({ error: "not_a_party" });
    return { ok: false };
  }
  const milestone = await options.milestones.findByIndex(engagement.id, index);
  if (milestone === null) {
    res.status(404).json({ error: "milestone_not_found" });
    return { ok: false };
  }
  return { ok: true, engagement, milestone, index };
}

/**
 * Shared mirror logic: flip the engagement to COMPLETED once every milestone
 * carries a release timestamp. Used by both release recording and dispute
 * resolution (both end with funds moved).
 */
export async function completeEngagementIfReleased(
  engagements: EngagementStore,
  milestones: MilestoneStore,
  engagementId: string,
): Promise<boolean> {
  const remaining = await milestones.listByEngagement(engagementId);
  const completed = remaining.length > 0 && remaining.every((candidate) => candidate.released_at !== null);
  if (completed) {
    await engagements.updateStatus(engagementId, "COMPLETED");
  }
  return completed;
}

/**
 * Record an on-chain milestone release in the mirror. When escrow reads are
 * available the chain must confirm `released`, otherwise nothing is recorded.
 * Completes the engagement once every milestone is released.
 */
async function handleRelease(
  req: Request,
  res: Response,
  options: EngagementsRouteOptions,
): Promise<void> {
  const context = await loadMilestoneContext(req, res, options);
  if (!context.ok) return;
  const { engagement, milestone, index } = context;
  if (milestone.disputed) {
    res.status(409).json({ error: "milestone_disputed" });
    return;
  }
  if (milestone.released_at !== null) {
    res.status(409).json({ error: "already_released" });
    return;
  }
  if (milestone.submitted_at === null) {
    res.status(409).json({ error: "not_submitted" });
    return;
  }
  if (options.checkReleased !== null) {
    const released = await options.checkReleased(engagement.on_chain_id, index);
    if (released === false) {
      res.status(409).json({ error: "not_released_onchain" });
      return;
    }
  }
  const releasedAt = new Date().toISOString();
  await options.milestones.markReleased(milestone.id, releasedAt);
  const engagementCompleted = await completeEngagementIfReleased(
    options.engagements,
    options.milestones,
    engagement.id,
  );
  log.info(`milestone released: engagement ${engagement.id} milestone ${index}`);
  res.json({ releasedAt, engagementCompleted });
}
