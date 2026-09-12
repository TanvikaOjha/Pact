import { Router, type NextFunction, type Request, type Response } from "express";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import type { DueRelease } from "../services/scheduler.js";
import { findDueReleases } from "../services/scheduler.js";
import { log } from "../services/log.js";
import {
  notifyAll,
  recipientEmails,
  releaseDueEmail,
  type Notifier,
} from "../services/notifications.js";

export interface SchedulerRouteOptions {
  milestones: MilestoneStore;
  engagements: EngagementStore;
  businesses: BusinessStore;
  notify: Notifier;
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
  await notifyDueParties(options, due);
  res.json({ checkedAt, due });
}

async function notifyDueParties(
  options: SchedulerRouteOptions,
  due: DueRelease[],
): Promise<void> {
  for (const item of due) {
    const engagement = await options.engagements.findById(item.engagementId);
    if (engagement === null) continue;
    const milestone = await options.milestones.findByIndex(item.engagementId, item.milestoneIndex);
    await notifyAll(
      options.notify,
      await recipientEmails(options.businesses, engagement),
      releaseDueEmail(
        engagement.ens_subname,
        milestone?.name ?? null,
        item.milestoneIndex,
        item.releaseAfter,
      ),
    );
  }
}
