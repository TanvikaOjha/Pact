import { Router, type NextFunction, type Request, type Response } from "express";

import type { MilestoneStore } from "../repos/engagements.js";
import { log } from "../services/log.js";
import { findDueReleases } from "../services/scheduler.js";

export interface SchedulerRouteOptions {
  milestones: MilestoneStore;
}

/**
 * POST /scheduler/sweep — ops/cron trigger reporting milestones past their
 * acceptance window. Detection only: automatic `autoRelease` execution (via
 * Privy session signer) is a later commit; until then this feeds reminders.
 */
export function createSchedulerRouter(options: SchedulerRouteOptions): Router {
  const router = Router();
  router.post("/scheduler/sweep", (_req: Request, res: Response, next: NextFunction) => {
    void handleSweep(res, options).catch(next);
  });
  return router;
}

async function handleSweep(res: Response, options: SchedulerRouteOptions): Promise<void> {
  const checkedAt = new Date().toISOString();
  const candidates = await options.milestones.listSubmittedUnreleased();
  const due = findDueReleases(candidates, checkedAt);
  log.info(`scheduler sweep: ${due.length} due of ${candidates.length} open milestones`);
  res.json({ checkedAt, due });
}
