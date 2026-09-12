import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementRow, EngagementStore, MilestoneStore } from "../repos/engagements.js";
import { log } from "../services/log.js";

/** Default acceptance window (spec Q2 default). Per-engagement terms override later. */
export const ACCEPTANCE_WINDOW_HOURS = 48;

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
}

function isParty(engagement: EngagementRow, businessId: string): boolean {
  return engagement.party_a_id === businessId || engagement.party_b_id === businessId;
}

export function releaseAfter(submittedAt: string): string {
  return new Date(Date.parse(submittedAt) + ACCEPTANCE_WINDOW_HOURS * 3600 * 1000).toISOString();
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
