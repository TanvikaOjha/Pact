import { Router, type NextFunction, type Request, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore } from "../repos/engagements.js";
import type { ReputationEventRow, ReputationStore } from "../repos/reputation.js";
import { scoreForEvents } from "../services/reputation.js";

const RECENT_LIMIT = 10;

export interface ReputationRouteOptions {
  businesses: BusinessStore;
  reputation: ReputationStore;
  /** Absent in tests; without it every engagement reads as public (fail-open). */
  engagements?: EngagementStore;
}

interface RecentEngagement {
  templateType: number;
  totalValue: number;
  onTime: boolean;
  disputed: boolean;
  counterpartySubname: string | null;
  redacted: boolean;
  emittedAt: string;
  txHash: string | null;
}

async function counterpartySubnames(
  businesses: BusinessStore,
  events: ReputationEventRow[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const event of events) {
    ids.add(event.counterparty_id);
  }
  const subnames = new Map<string, string>();
  for (const id of ids) {
    const business = await businesses.findById(id);
    if (business !== null) subnames.set(id, business.ens_subname);
  }
  return subnames;
}

/**
 * GET /businesses/:subname/reputation — public track record. Aggregates the
 * reputation mirror (populated by completion recording + the PactCompleted
 * indexer); anyone can reproduce it from on-chain events. Commit-visibility
 * engagements redact the counterparty subname (the link plaintext, not the
 * API, is the reveal channel).
 */
export function createReputationRouter(options: ReputationRouteOptions): Router {
  const router = Router();
  router.get("/businesses/:subname/reputation", (req: Request, res: Response, next: NextFunction) => {
    void handleReputation(req, res, options).catch(next);
  });
  return router;
}

async function handleReputation(
  req: Request,
  res: Response,
  options: ReputationRouteOptions,
): Promise<void> {
  const subname = req.params.subname;
  if (subname === undefined || subname === "") {
    res.status(404).json({ error: "business_not_found" });
    return;
  }
  const business = await options.businesses.findBySubname(subname);
  if (business === null) {
    res.status(404).json({ error: "business_not_found" });
    return;
  }
  const events = await options.reputation.eventsForBusiness(business.id);
  const recentEvents = events.slice(0, RECENT_LIMIT);
  const subnames = await counterpartySubnames(options.businesses, recentEvents);
  const visibilities = await engagementVisibilities(options.engagements, recentEvents);
  const completedCount = events.length;
  const totalValue = events.reduce((sum, event) => sum + event.total_value, 0);
  const onTimeCount = events.filter((event) => event.on_time).length;
  const disputeCount = events.filter((event) => event.disputed).length;
  const score = scoreForEvents(
    events,
    business.world_verified_at !== null && business.world_verified_at !== "",
  );
  const recent: RecentEngagement[] = recentEvents.map((event) => {
    const redacted = visibilities.get(event.engagement_id) === "commit";
    return {
      templateType: event.template_type,
      totalValue: event.total_value,
      onTime: event.on_time,
      disputed: event.disputed,
      counterpartySubname: redacted ? null : (subnames.get(event.counterparty_id) ?? null),
      redacted,
      emittedAt: event.emitted_at,
      txHash: event.tx_hash,
    };
  });
  res.json({
    ensSubname: business.ens_subname,
    completedCount,
    totalValue,
    onTimeRate: completedCount === 0 ? null : onTimeCount / completedCount,
    disputeCount,
    score: score.score,
    tier: score.tier,
    scoreVersion: score.version,
    recent,
  });
}

async function engagementVisibilities(
  engagements: EngagementStore | undefined,
  events: ReputationEventRow[],
): Promise<Map<string, string>> {
  const visibilities = new Map<string, string>();
  if (engagements === undefined) return visibilities;
  const ids = new Set<string>();
  for (const event of events) {
    ids.add(event.engagement_id);
  }
  for (const id of ids) {
    const engagement = await engagements.findById(id);
    if (engagement !== null) {
      visibilities.set(id, engagement.visibility ?? "public");
    }
  }
  return visibilities;
}
