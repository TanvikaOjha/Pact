import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import { createSchedulerRouter } from "./scheduler.js";

interface SweepEnvelope {
  checkedAt?: string;
  error?: string;
  due?: Array<{ engagementId: string; milestoneIndex: number; releaseAfter: string }>;
}

function seedRow(id: string, submittedAt: string | null, released: boolean): MilestoneRow {
  return {
    id,
    engagement_id: "eng-1",
    index: 0,
    name: "Design",
    description: null,
    amount: 2000,
    due_date: null,
    submitted_at: submittedAt,
    released_at: released ? submittedAt : null,
    disputed: false,
    world_session_id: null,
  };
}

describe("POST /api/scheduler/sweep", () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll(async () => {
    const rows: MilestoneRow[] = [
      seedRow("due", "2026-09-09T12:00:00.000Z", false),
      seedRow("fresh", new Date(Date.now() - 3600 * 1000).toISOString(), false),
    ];
    const store: MilestoneStore = {
      listByEngagement: async () => [],
      listSubmittedUnreleased: async () =>
        rows.filter((row) => row.submitted_at !== null && row.released_at === null && !row.disputed),
      findByIndex: async () => null,
      insertMany: async () => [],
      markSubmitted: async () => null,
      markReleased: async () => null,
    };
    const app = express();
    app.use(express.json());
    app.use("/api", createSchedulerRouter({ milestones: store }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        resolve();
      });
    });
    const current = server;
    if (current === null) {
      throw new Error("test server did not start");
    }
    // SAFETY: listen(0) binds TCP and beforeAll awaits listening, so this is AddressInfo.
    port = (current.address() as AddressInfo).port;
  });

  afterAll(async () => {
    const active = server;
    if (active === null) return;
    await new Promise<void>((resolve) => {
      active.close(() => {
        resolve();
      });
    });
  });

  test("reports due milestones for the sweep", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduler/sweep`, { method: "POST" });
    expect(res.status).toBe(200);
    // SAFETY: test-only decode of the sweep envelope produced by this router.
    const body = (await res.json()) as SweepEnvelope;
    expect(body.due?.length).toBe(1);
    expect(body.due?.[0]?.engagementId).toBe("eng-1");
  });
});
