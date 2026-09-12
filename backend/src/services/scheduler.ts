import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import { log } from "./log.js";
import { notifyAll, recipientEmails, releaseDueEmail, windowClosingEmail, type Notifier } from "./notifications.js";

/** Default acceptance window (spec Q2 default). Per-engagement terms override later. */
export const ACCEPTANCE_WINDOW_HOURS = 48;

/** Closing-soon reminder horizon (guide: windows closing in ~6h). */
export const CLOSING_SOON_MS = 6 * 3600 * 1000;

/** Stale-dispute escalation age (spec: 30 days without co-signature). */
export const STALE_DISPUTE_MS = 30 * 24 * 3600 * 1000;

export function releaseAfter(submittedAt: string): string {
  return new Date(Date.parse(submittedAt) + ACCEPTANCE_WINDOW_HOURS * 3600 * 1000).toISOString();
}

export interface DueRelease {
  engagementId: string;
  milestoneIndex: number;
  releaseAfter: string;
}

/**
 * Pure due-detection: submitted, window elapsed, neither released nor
 * disputed. Execution (session-signer autoRelease tx) is a later commit;
 * sweep results feed notifications and the ops trigger until then.
 */
export function findDueReleases(milestones: MilestoneRow[], now: string): DueRelease[] {
  const nowMs = Date.parse(now);
  const due: DueRelease[] = [];
  for (const milestone of milestones) {
    if (milestone.submitted_at === null) continue;
    if (milestone.released_at !== null || milestone.disputed) continue;
    const releaseAfterAt = releaseAfter(milestone.submitted_at);
    if (Date.parse(releaseAfterAt) <= nowMs) {
      due.push({
        engagementId: milestone.engagement_id,
        milestoneIndex: milestone.index,
        releaseAfter: releaseAfterAt,
      });
    }
  }
  return due;
}

/** Submitted, unreleased, undisputed, window closing within the horizon. */
export function findClosingSoon(milestones: MilestoneRow[], now: string): DueRelease[] {
  const nowMs = Date.parse(now);
  const closing: DueRelease[] = [];
  for (const milestone of milestones) {
    if (milestone.submitted_at === null) continue;
    if (milestone.released_at !== null || milestone.disputed) continue;
    const releaseAfterAt = releaseAfter(milestone.submitted_at);
    const releaseMs = Date.parse(releaseAfterAt);
    if (releaseMs > nowMs && releaseMs - nowMs <= CLOSING_SOON_MS) {
      closing.push({
        engagementId: milestone.engagement_id,
        milestoneIndex: milestone.index,
        releaseAfter: releaseAfterAt,
      });
    }
  }
  return closing;
}

/** Disputed past the escalation age (checked daily; the 30–31d band fires once). */
export function findStaleDisputes(milestones: MilestoneRow[], now: string): DueRelease[] {
  const nowMs = Date.parse(now);
  const stale: DueRelease[] = [];
  for (const milestone of milestones) {
    if (!milestone.disputed || milestone.released_at !== null) continue;
    if (milestone.disputed_at === undefined || milestone.disputed_at === null) continue;
    const ageMs = nowMs - Date.parse(milestone.disputed_at);
    if (ageMs >= STALE_DISPUTE_MS && ageMs < STALE_DISPUTE_MS + 24 * 3600 * 1000) {
      stale.push({
        engagementId: milestone.engagement_id,
        milestoneIndex: milestone.index,
        releaseAfter: milestone.disputed_at,
      });
    }
  }
  return stale;
}

export interface SweepDeps {
  milestones: MilestoneStore;
  engagements: EngagementStore;
  businesses: BusinessStore;
  notify: Notifier;
}

export interface SweepResult {
  checkedAt: string;
  due: DueRelease[];
  closingSoon: number;
}

/**
 * Shared sweep core: due releases + closing-soon reminders + notifications.
 * Used by the manual POST /scheduler/sweep trigger and the cron loop alike.
 */
export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  const checkedAt = new Date().toISOString();
  const candidates = await deps.milestones.listSubmittedUnreleased();
  const due = findDueReleases(candidates, checkedAt);
  const closing = findClosingSoon(candidates, checkedAt);
  log.info(`scheduler sweep: ${due.length} due, ${closing.length} closing of ${candidates.length} open`);
  await notifyDueParties(deps, due);
  await notifyClosingParties(deps, closing);
  return { checkedAt, due, closingSoon: closing.length };
}

async function notifyDueParties(deps: SweepDeps, due: DueRelease[]): Promise<void> {
  for (const item of due) {
    const engagement = await deps.engagements.findById(item.engagementId);
    if (engagement === null) continue;
    const milestone = await deps.milestones.findByIndex(item.engagementId, item.milestoneIndex);
    await notifyAll(
      deps.notify,
      await recipientEmails(deps.businesses, engagement),
      releaseDueEmail(
        engagement.ens_subname,
        milestone?.name ?? null,
        item.milestoneIndex,
        item.releaseAfter,
      ),
    );
  }
}

async function notifyClosingParties(deps: SweepDeps, closing: DueRelease[]): Promise<void> {
  for (const item of closing) {
    const engagement = await deps.engagements.findById(item.engagementId);
    if (engagement === null) continue;
    const milestone = await deps.milestones.findByIndex(item.engagementId, item.milestoneIndex);
    await notifyAll(
      deps.notify,
      await recipientEmails(deps.businesses, engagement),
      windowClosingEmail(
        engagement.ens_subname,
        milestone?.name ?? null,
        item.milestoneIndex,
        item.releaseAfter,
      ),
    );
  }
}
