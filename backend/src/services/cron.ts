import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneStore } from "../repos/engagements.js";
import type { ProposalStore } from "../repos/proposals.js";
import { log } from "./log.js";
import {
  disputeStaleEmail,
  notifyAll,
  proposalExpiringEmail,
  recipientEmails,
  type Notifier,
} from "./notifications.js";
import { findStaleDisputes, runSweep } from "./scheduler.js";

export interface CronDeps {
  milestones: MilestoneStore;
  engagements: EngagementStore;
  businesses: BusinessStore;
  proposals: ProposalStore;
  notify: Notifier;
}

export interface CronJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

const PROPOSAL_EXPIRY_NOTICE_MS = 24 * 60 * 60 * 1000;

async function sweepTick(deps: CronDeps): Promise<void> {
  await runSweep({
    milestones: deps.milestones,
    engagements: deps.engagements,
    businesses: deps.businesses,
    notify: deps.notify,
  });
}

async function proposalExpiryTick(deps: CronDeps): Promise<void> {
  const horizon = new Date(Date.now() + PROPOSAL_EXPIRY_NOTICE_MS).toISOString();
  const expiring = await deps.proposals.listExpiringUnaccepted(horizon);
  for (const proposal of expiring) {
    if (proposal.proposer_id === null) continue;
    const proposer = await deps.businesses.findById(proposal.proposer_id);
    const email = proposer?.email ?? null;
    if (email === null || email === "") continue;
    await deps.notify.send({
      to: email,
      ...proposalExpiringEmail(proposal.token, proposal.expires_at),
    });
  }
  if (expiring.length > 0) {
    log.info(`cron proposals: ${expiring.length} expiring noticed`);
  }
}

async function disputeEscalationTick(deps: CronDeps): Promise<void> {
  const now = new Date().toISOString();
  const disputed = await deps.milestones.listDisputed();
  const stale = findStaleDisputes(disputed, now);
  for (const item of stale) {
    const engagement = await deps.engagements.findById(item.engagementId);
    if (engagement === null) continue;
    const milestone = await deps.milestones.findByIndex(item.engagementId, item.milestoneIndex);
    await notifyAll(
      deps.notify,
      await recipientEmails(deps.businesses, engagement),
      disputeStaleEmail(engagement.ens_subname, milestone?.name ?? null, item.milestoneIndex),
    );
  }
  if (stale.length > 0) {
    log.info(`cron disputes: ${stale.length} stale escalated`);
  }
}

export function buildCronJobs(deps: CronDeps): CronJob[] {
  return [
    { name: "sweep", intervalMs: SWEEP_INTERVAL_MS, run: () => sweepTick(deps) },
    { name: "proposal-expiry", intervalMs: HOURLY_INTERVAL_MS, run: () => proposalExpiryTick(deps) },
    { name: "dispute-escalation", intervalMs: DAILY_INTERVAL_MS, run: () => disputeEscalationTick(deps) },
  ];
}

/**
 * In-process cron loop. Each tick isolates failures (one bad job never kills
 * the loop) and an immediate first tick validates wiring loudly at startup.
 * External cron platforms can hit the HTTP endpoints instead; both feed the
 * same service cores.
 */
export function startCron(jobs: CronJob[]): () => void {
  const timers: Array<ReturnType<typeof setInterval>> = [];
  for (const job of jobs) {
    const tick = (): void => {
      void job
        .run()
        .catch(() => {
          log.error(`cron ${job.name} failed`);
        });
    };
    tick();
    timers.push(setInterval(tick, job.intervalMs));
  }
  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
}
