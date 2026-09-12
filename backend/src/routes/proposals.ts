import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import type { NewProposal, ProposalStore, StoredProposalTerms } from "../repos/proposals.js";
import { hashEngagementTerms, type EngagementTermsInput } from "../ens/pact-terms.js";

const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const TEMPLATE_NAMES = new Map<number, string>([
  [1, "fixed"],
  [2, "milestone"],
  [3, "retainer"],
  [4, "t-and-m"],
  [5, "recurring"],
  [6, "split"],
]);

const milestoneSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().min(1).max(200),
  deliverable: z.string().min(1).max(500),
  due: z.string().min(1),
  amount: z.number().positive(),
  worldRequired: z.boolean(),
});

const proposalRequestSchema = z.object({
  templateType: z.number().int().min(1).max(6),
  title: z.string().min(1).max(200),
  scope: z.string().min(1).max(2000),
  acceptanceCriteria: z.string().min(1).max(1000),
  totalAmount: z.number().positive(),
  acceptanceWindowHours: z.number().int().positive().default(48),
  milestones: z.array(milestoneSchema).max(5).default([]),
  fields: z.record(z.string(), z.string()).default({}),
  splitShareA: z.number().min(0).optional(),
  splitShareB: z.number().min(0).optional(),
});

export interface ProposalsRouteOptions {
  store: ProposalStore;
  businesses: BusinessStore;
  /** Applied to POST only — GET serves the counterparty link, pre-signup. */
  requireAuth: RequestHandler;
}

function milestoneTotal(milestones: z.infer<typeof milestoneSchema>[]): number {
  return milestones.reduce((sum, milestone) => sum + milestone.amount, 0);
}

/**
 * POST /proposals — authed proposer drafts terms; backend canonicalizes and
 * hashes exactly as the counterparty (and chain) will verify. The milestone
 * sum check mirrors PactEscrow funding (sum must equal total).
 *
 * GET /proposals/:token — public counterparty link view. 410 past expiry.
 */
export function createProposalsRouter(options: ProposalsRouteOptions): Router {
  const router = Router();
  router.post("/proposals", options.requireAuth, (req: Request, res: Response, next: NextFunction) => {
    void handleCreate(req, res, options).catch(next);
  });
  router.get("/proposals/:token", (req: Request, res: Response, next: NextFunction) => {
    void handleGet(req, res, options).catch(next);
  });
  return router;
}

async function handleCreate(
  req: Request,
  res: Response,
  options: ProposalsRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const parsed = proposalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const draft = parsed.data;
  if (draft.milestones.length > 0 && milestoneTotal(draft.milestones) !== draft.totalAmount) {
    res.status(400).json({ error: "terms_mismatch" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null) {
    res.status(403).json({ error: "business_required" });
    return;
  }
  const templateName = TEMPLATE_NAMES.get(draft.templateType);
  if (templateName === undefined) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const hashInput: EngagementTermsInput = {
    templateType: templateName,
    title: draft.title,
    scope: draft.scope,
    acceptanceCriteria: draft.acceptanceCriteria,
    totalAmount: draft.totalAmount,
    acceptanceWindowHours: draft.acceptanceWindowHours,
    milestones: draft.milestones,
    fields: draft.fields,
  };
  if (draft.splitShareA !== undefined) hashInput.splitShareA = draft.splitShareA;
  if (draft.splitShareB !== undefined) hashInput.splitShareB = draft.splitShareB;
  const terms: StoredProposalTerms = {
    templateType: draft.templateType,
    title: draft.title,
    scope: draft.scope,
    acceptanceCriteria: draft.acceptanceCriteria,
    totalAmount: draft.totalAmount,
    acceptanceWindowHours: draft.acceptanceWindowHours,
    milestones: draft.milestones,
    fields: draft.fields,
    termsHash: hashEngagementTerms(hashInput),
  };
  if (draft.splitShareA !== undefined) terms.splitShareA = draft.splitShareA;
  if (draft.splitShareB !== undefined) terms.splitShareB = draft.splitShareB;
  const proposal: NewProposal = {
    token: randomUUID(),
    templateType: draft.templateType,
    terms,
    proposerId: business.id,
    expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
  };
  const row = await options.store.insert(proposal);
  res.status(201).json({ token: row.token, expiresAt: row.expires_at, termsHash: terms.termsHash });
}

async function handleGet(
  req: Request,
  res: Response,
  options: ProposalsRouteOptions,
): Promise<void> {
  const token = req.params.token;
  if (token === undefined || token === "") {
    res.status(404).json({ error: "proposal_not_found" });
    return;
  }
  const row = await options.store.findByToken(token);
  if (row === null) {
    res.status(404).json({ error: "proposal_not_found" });
    return;
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    res.status(410).json({ error: "proposal_expired" });
    return;
  }
  const proposer =
    row.proposer_id === null ? null : await options.businesses.findById(row.proposer_id);
  res.json({
    token: row.token,
    templateType: row.template_type,
    terms: row.fields,
    proposer: proposer === null ? null : { ensSubname: proposer.ens_subname },
    expiresAt: row.expires_at,
  });
}
