import type { MilestoneRow } from "../repos/engagements.js";

/** Default acceptance window (spec Q2 default). Per-engagement terms override later. */
export const ACCEPTANCE_WINDOW_HOURS = 48;

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
