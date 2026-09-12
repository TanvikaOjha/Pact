import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import { runSweep, type AutoReleaseHandler } from "../services/scheduler.js";
import type { IndexerArchive } from "../services/indexer.js";
import type { Notifier } from "../services/notifications.js";

export interface SchedulerRouteOptions {
  milestones: MilestoneStore;
  engagements: EngagementStore;
  businesses: BusinessStore;
  notify: Notifier;
  /** Opt-in on-chain autoRelease attempts; absent keeps detect+notify default. */
  requestAutoRelease?: AutoReleaseHandler;
  /** Shared indexer skip archive surfaced read-only for ops. */
  archive?: IndexerArchive;
  /** Cron-or-user auth; absent leaves the route open (tests, apiRouter mount). */
  auth?: RequestHandler;
}

/**
 * POST /scheduler/sweep — manual trigger for the same sweep the cron loop
 * runs: due releases + closing-soon reminders + notifications. Detects by
 * default; attempts on-chain `autoRelease` only when requestAutoRelease is
 * wired (e.g. a Privy session-signer submission).
 *
 * GET /scheduler/archive — indexer skip archive (unknown wallets,
 * malformed logs). The watcher stays new-events-only; this is the backlog.
 */
export function createSchedulerRouter(options: SchedulerRouteOptions): Router {
  const router = Router();
  const guard = options.auth;
  if (guard === undefined) {
    router.post("/scheduler/sweep", (_req: Request, res: Response, next: NextFunction) => {
      void handleSweep(res, options).catch(next);
    });
    router.get("/scheduler/archive", (_req: Request, res: Response) => {
      res.json({ count: options.archive?.list().length ?? 0, skips: options.archive?.list() ?? [] });
    });
    return router;
  }
  router.post("/scheduler/sweep", guard, (_req: Request, res: Response, next: NextFunction) => {
    void handleSweep(res, options).catch(next);
  });
  router.get("/scheduler/archive", guard, (_req: Request, res: Response) => {
    res.json({ count: options.archive?.list().length ?? 0, skips: options.archive?.list() ?? [] });
  });
  return router;
}

async function handleSweep(res: Response, options: SchedulerRouteOptions): Promise<void> {
  res.json(
    await runSweep({
      milestones: options.milestones,
      engagements: options.engagements,
      businesses: options.businesses,
      notify: options.notify,
      requestAutoRelease: options.requestAutoRelease,
    }),
  );
}
