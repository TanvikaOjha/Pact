import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementStore, MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import { createIndexerArchive } from "../services/indexer.js";
import type { EmailMessage } from "../services/notifications.js";
import type { AutoReleaseRequest } from "../services/scheduler.js";
import { createSchedulerRouter } from "./scheduler.js";

interface SweepEnvelope {
  checkedAt?: string;
  error?: string;
  due?: Array<{ engagementId: string; milestoneIndex: number; releaseAfter: string }>;
  closingSoon?: number;
  autoRelease?: { attempted: number; succeeded: number; failed: number };
}

interface ArchiveEnvelope {
  count?: number;
  skips?: Array<{ reason: string; engagementId: string }>;
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

function seedDueRow(): MilestoneRow {
  return {
    id: "due",
    engagement_id: "eng-1",
    index: 0,
    name: "Design",
    description: null,
    amount: 2000,
    due_date: null,
    submitted_at: "2026-09-09T12:00:00.000Z",
    released_at: null,
    disputed: false,
    world_session_id: null,
  };
}

function hookMemoryStores() {
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
      throw new Error("not implemented in scheduler hook tests");
    },
  };
  const engagements: EngagementStore = {
    findById: async (id: string) =>
      id === "eng-1"
        ? {
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
          }
        : null,
    findByOnChainId: async () => null,
    insert: async () => {
      throw new Error("not implemented in scheduler hook tests");
    },
    updateStatus: async () => null,
  };
  const milestones: MilestoneStore = {
    listByEngagement: async () => [],
    listSubmittedUnreleased: async () => [seedDueRow()],
    listDisputed: async () => [],
    findByIndex: async () => null,
    insertMany: async () => [],
    markSubmitted: async () => null,
    markReleased: async () => null,
    setDisputed: async () => null,
    markResolved: async () => null,
    setWorldSession: async () => null,
    findByWorldSession: async () => null,
  };
  return { businesses, engagements, milestones };
}

describe("scheduler opt-in autoRelease + archive + guard", () => {
  let server: Server | null = null;
  let port = 0;
  const hookCalls: AutoReleaseRequest[] = [];

  beforeAll(async () => {
    const { businesses, engagements, milestones } = hookMemoryStores();
    const archive = createIndexerArchive();
    archive.archive({
      reason: "unknown_party_wallets",
      engagementId: "0xskip",
      partyA: "0xaaa",
      partyB: "0xbbb",
      txHash: null,
      archivedAt: new Date().toISOString(),
    });
    const guard: RequestHandler = (req, res, next) => {
      if (req.header("authorization") === "Bearer ops-secret") {
        next();
        return;
      }
      res.status(401).json({ error: "missing_token" });
    };
    const app = express();
    app.use(express.json());
    app.use(
      "/open",
      createSchedulerRouter({
        milestones,
        engagements,
        businesses,
        notify: { send: async (): Promise<void> => {} },
        requestAutoRelease: async (request: AutoReleaseRequest) => {
          hookCalls.push(request);
          return { attempted: true, ok: true, error: null };
        },
        archive,
      }),
    );
    app.use(
      "/guarded",
      createSchedulerRouter({
        milestones,
        engagements,
        businesses,
        notify: { send: async (): Promise<void> => {} },
        archive,
        auth: guard,
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

  test("hook runs for due milestones and is counted", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/open/scheduler/sweep`, { method: "POST" });
    expect(res.status).toBe(200);
    // SAFETY: test-only decode of the sweep envelope produced by this router.
    const body = (await res.json()) as SweepEnvelope;
    expect(body.due?.length).toBe(1);
    expect(body.autoRelease).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(hookCalls).toEqual([
      { engagementId: "eng-1", milestoneIndex: 0, releaseAfter: body.due?.[0]?.releaseAfter },
    ]);
  });

  test("archive lists skipped logs", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/open/scheduler/archive`);
    expect(res.status).toBe(200);
    // SAFETY: test-only decode of the archive envelope produced by this router.
    const body = (await res.json()) as ArchiveEnvelope;
    expect(body.count).toBe(1);
    expect(body.skips?.[0]).toMatchObject({ reason: "unknown_party_wallets", engagementId: "0xskip" });
  });

  test("guard rejects without the cron secret and passes with it", async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/guarded/scheduler/sweep`, { method: "POST" });
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/guarded/scheduler/sweep`, {
      method: "POST",
      headers: { authorization: "Bearer ops-secret" },
    });
    expect(allowed.status).toBe(200);
    // SAFETY: test-only decode of the sweep envelope produced by this router.
    const body = (await allowed.json()) as SweepEnvelope;
    expect(body.autoRelease).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });
});
