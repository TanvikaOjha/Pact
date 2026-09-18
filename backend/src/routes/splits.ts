import { Router, type NextFunction, type Request, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore } from "../repos/engagements.js";
import type { SplitStore } from "../repos/splits.js";
import { log } from "../services/log.js";

export interface SplitsRouteOptions {
  engagements: EngagementStore;
  businesses: BusinessStore;
  splits: SplitStore;
  /** Null when escrow reads are unavailable; claim recording proceeds unverified. */
  checkPendingShare: ((onChainId: string, wallet: string) => Promise<number | null>) | null;
}

/**
 * GET /engagements/:id/split — recipients (fixed at accept time) plus the
 * current pendingShares mirror, so the frontend can show "you have $X
 * waiting to be claimed" for Template 6 / M5 co-deliverers.
 *
 * POST /engagements/:id/split/claim — records a claimShare() the caller
 * just submitted directly on-chain (the FilePizza mechanic: no backend tx
 * required). When an escrow reader is wired, this re-reads pendingShares()
 * to confirm the claim actually zeroed the balance rather than trusting the
 * caller's say-so.
 */
export function createSplitsRouter(options: SplitsRouteOptions): Router {
  const router = Router();
  router.get("/engagements/:id/split", (req: Request, res: Response, next: NextFunction) => {
    void handleGetSplit(req, res, options).catch(next);
  });
  router.post("/engagements/:id/split/claim", (req: Request, res: Response, next: NextFunction) => {
    void handleClaim(req, res, options).catch(next);
  });
  return router;
}

async function handleGetSplit(
  req: Request,
  res: Response,
  options: SplitsRouteOptions,
): Promise<void> {
  const engagement = await options.engagements.findById(req.params.id ?? "");
  if (engagement === null) {
    res.status(404).json({ error: "engagement_not_found" });
    return;
  }
  const [recipients, pending] = await Promise.all([
    options.splits.listRecipients(engagement.id),
    options.splits.listPendingShares(engagement.id),
  ]);
  res.json({
    engagementId: engagement.id,
    recipients: recipients.map((recipient) => ({
      wallet: recipient.wallet_address,
      sharesBps: recipient.shares_bps,
      position: recipient.position,
    })),
    pendingShares: pending.map((share) => ({
      wallet: share.wallet_address,
      amount: share.amount,
      updatedAt: share.updated_at,
    })),
  });
}

async function handleClaim(
  req: Request,
  res: Response,
  options: SplitsRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const engagement = await options.engagements.findById(req.params.id ?? "");
  if (engagement === null) {
    res.status(404).json({ error: "engagement_not_found" });
    return;
  }
  const business = await options.businesses.findByWallet(identity.walletAddress);
  if (business === null) {
    res.status(403).json({ error: "business_required" });
    return;
  }
  if (options.checkPendingShare !== null) {
    const remaining = await options.checkPendingShare(engagement.on_chain_id, identity.walletAddress);
    if (remaining !== null) {
      await options.splits.setPendingShare(engagement.id, identity.walletAddress, remaining);
      res.json({ claimed: remaining === 0, pendingAmount: remaining, verified: true });
      return;
    }
  }
  log.info(
    `split claim recorded without chain verification: engagement ${engagement.id} wallet ${identity.walletAddress}`,
  );
  await options.splits.setPendingShare(engagement.id, identity.walletAddress, 0);
  res.json({ claimed: true, pendingAmount: 0, verified: false });
}