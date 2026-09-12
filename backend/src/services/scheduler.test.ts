import { describe, expect, test } from "vitest";

import type { MilestoneRow } from "../repos/engagements.js";
import { findDueReleases } from "./scheduler.js";

const NOW = "2026-09-12T12:00:00.000Z";
const THREE_DAYS_AGO = "2026-09-09T12:00:00.000Z";
const ONE_HOUR_AGO = "2026-09-12T11:00:00.000Z";

function row(overrides: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    id: "ms-1",
    engagement_id: "eng-1",
    index: 0,
    name: "Design",
    description: null,
    amount: 2000,
    due_date: null,
    submitted_at: null,
    released_at: null,
    disputed: false,
    world_session_id: null,
    ...overrides,
  };
}

describe("findDueReleases", () => {
  test("reports only submitted, unreleased, undisputed milestones past the window", () => {
    const due = findDueReleases(
      [
        row({ id: "due", submitted_at: THREE_DAYS_AGO }),
        row({ id: "fresh", submitted_at: ONE_HOUR_AGO }),
        row({ id: "released", submitted_at: THREE_DAYS_AGO, released_at: THREE_DAYS_AGO }),
        row({ id: "disputed", submitted_at: THREE_DAYS_AGO, disputed: true }),
        row({ id: "draft" }),
      ],
      NOW,
    );
    expect(due).toEqual([
      {
        engagementId: "eng-1",
        milestoneIndex: 0,
        releaseAfter: "2026-09-11T12:00:00.000Z",
      },
    ]);
  });
});
