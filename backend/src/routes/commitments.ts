import { Router, type NextFunction, type Request, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type {
  EngagementRow,
  EngagementStore,
  MilestoneStore,
} from "../repos/engagements.js";

export interface CommitmentsRouteOptions {
  businesses: BusinessStore;
  engagements: EngagementStore;
  milestones: MilestoneStore;
}

interface CommitmentMilestone {
  index: number;
  name: string | null;
  description: string | null;
  amount: number;
  dueDate: string | null;
  submittedAt: string | null;
  releasedAt: string | null;
  disputed: boolean;
  late: boolean;
}

function latestDeadline(
  milestones: CommitmentMilestone[],
): string | null {
  const dates = milestones
    .flatMap((milestone) => milestone.dueDate === null ? [] : [milestone.dueDate])
    .sort();
  return dates.at(-1) ?? null;
}

function commitmentStatus(row: EngagementRow): string {
  return row.status;
}

export function createCommitmentsRouter(options: CommitmentsRouteOptions): Router {
  const router = Router();
  router.get("/me/commitments", (req: Request, res: Response, next: NextFunction) => {
    void handleCommitments(req, res, options).catch(next);
  });
  return router;
}

async function handleCommitments(
  req: Request,
  res: Response,
  options: CommitmentsRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null) {
    res.status(403).json({ error: "business_required" });
    return;
  }

  const listByBusiness = options.engagements.listByBusiness;
  if (listByBusiness === undefined) {
    throw new Error("commitments store is not configured");
  }
  const rows = await listByBusiness(business.id);
  const commitments = await Promise.all(
    rows.map(async (row) => {
      const [partyA, partyB, milestones] = await Promise.all([
        row.party_a_id === null ? Promise.resolve(null) : options.businesses.findById(row.party_a_id),
        row.party_b_id === null ? Promise.resolve(null) : options.businesses.findById(row.party_b_id),
        options.milestones.listByEngagement(row.id),
      ]);
      const mappedMilestones = milestones.map((milestone) => ({
        index: milestone.index,
        name: milestone.name,
        description: milestone.description,
        amount: milestone.amount,
        dueDate: milestone.due_date,
        submittedAt: milestone.submitted_at,
        releasedAt: milestone.released_at,
        disputed: milestone.disputed,
        late: milestone.late ?? false,
      }));
      const counterparty = row.party_a_id === business.id ? partyB : partyA;
      return {
        id: row.id,
        onChainId: row.on_chain_id,
        ensSubname: row.ens_subname,
        templateType: row.template_type,
        termsHash: row.terms_hash,
        totalAmount: row.total_amount,
        status: commitmentStatus(row),
        createdAt: row.created_at,
        completedAt: row.completed_at,
        role: row.party_a_id === business.id ? "provider" : "counterparty",
        counterparty: counterparty?.ens_subname ?? null,
        deadline: latestDeadline(mappedMilestones),
        milestones: mappedMilestones,
      };
    }),
  );
  res.json({ business: business.ens_subname, commitments });
}
