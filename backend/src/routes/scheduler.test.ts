import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import type { EmailMessage } from "../services/notifications.js";
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
  const sent: EmailMessage[] = [];

  beforeAll(async () => {
    const rows: MilestoneRow[] = [
      seedRow("due", "2026-09-09T12:00:00.000Z", false),
      seedRow("fresh", new Date(Date.now() - 3600 * 1000).toISOString(), false),
    ];
    const engagement = {
      id: "eng-1",
      on_chain_id: "offchain",
      ens_subname: "eng-1.pact-hack.eth",
      party_a_id: "biz-a",
      party_b_id: "biz-b",
      template_type: 1,
      terms_hash: "0xabc",
      total_amount: 2000,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      completed_at: null,
    } as const;
    const businesses: BusinessStore = {
      findById: async (id: string) =>
        id === "biz-a" || id === "biz-b"
          ? {
              id,
              wallet_address: "0x00",
              privy_wallet_id: "dev",
              ens_subname: `${id}.pact-hack.eth`,
              world_session_id: null,
              world_verified_at: null,
              created_at: new Date().toISOString(),
              email: `${id}@example.com`,
            }
          : null,
      findByWallet: async () => null,
      findBySubname: async () => null,
      findByWorldSession: async () => null,
      insert: async () => {
        throw new Error("not implemented in scheduler tests");
      },
    };
    const engagements: EngagementStore = {
      findById: async (id: string) => (id === "eng-1" ? { ...engagement } : null),
      findByOnChainId: async () => null,
      insert: async () => {
        throw new Error("not implemented in scheduler tests");
      },
      updateStatus: async () => null,
    };
    const store: MilestoneStore = {
      listByEngagement: async () => [],
      listSubmittedUnreleased: async () =>
        rows.filter((row) => row.submitted_at !== null && row.released_at === null && !row.disputed),
      listDisputed: async () =>
        rows.filter((row) => row.disputed && row.released_at === null),
      findByIndex: async () => null,
      insertMany: async () => [],
      markSubmitted: async () => null,
      markReleased: async () => null,
      setDisputed: async () => null,
      markResolved: async () => null,
    setWorldSession: async () => null,
    findByWorldSession: async () => null,
    };
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createSchedulerRouter({
        milestones: store,
        engagements,
        businesses,
        notify: {
          send: async (message: EmailMessage): Promise<void> => {
            sent.push(message);
          },
        },
      }),
    );
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
    expect(sent.map((message) => message.to).sort()).toEqual([
      "biz-a@example.com",
      "biz-b@example.com",
    ]);
    expect(sent[0]?.subject.includes("Auto-release due")).toBe(true);
  });
});
