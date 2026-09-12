import { Router, type NextFunction, type Request, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import { runSweep } from "../services/scheduler.js";
import type { Notifier } from "../services/notifications.js";

export interface SchedulerRouteOptions {
  milestones: MilestoneStore;
  engagements: EngagementStore;
  businesses: BusinessStore;
  notify: Notifier;
}

/**
 * POST /scheduler/sweep — manual trigger for the same sweep the cron loop
 * runs: due releases + closing-soon reminders + notifications. Automatic
 * `autoRelease` execution (via Privy session signer) is a later commit.
 */
export function createSchedulerRouter(options: SchedulerRouteOptions): Router {
  const router = Router();
  router.post("/scheduler/sweep", (_req: Request, res: Response, next: NextFunction) => {
    void handleSweep(res, options).catch(next);
  });
  return router;
}

async function handleSweep(res: Response, options: SchedulerRouteOptions): Promise<void> {
  res.json(await runSweep(options));
}
