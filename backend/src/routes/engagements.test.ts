import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore } from "../repos/businesses.js";
import type {
  EngagementRow,
  EngagementStatus,
  EngagementStore,
  MilestoneRow,
  MilestoneStore,
  NewEngagement,
  NewMilestone,
} from "../repos/engagements.js";
import type { EmailMessage } from "../services/notifications.js";
import { createEngagementsRouter } from "./engagements.js";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OUTSIDER = "0xffffffffffffffffffffffffffffffffffffffff";

function businessRow(id: string, wallet: string, subname: string): BusinessRow {
  return {
    id,
    wallet_address: wallet,
    privy_wallet_id: "dev",
    ens_subname: subname,
    world_session_id: `session_dev_${id}`,
    world_verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    email: `${id}@example.com`,
  };
}

function createCapturingNotifier() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    notify: {
      send: async (message: EmailMessage): Promise<void> => {
        sent.push(message);
      },
    },
  };
}

function createMemoryBusinessStore(): BusinessStore {
  const rows: BusinessRow[] = [
    businessRow("biz-a", WALLET_A, "studio.pact-hack.eth"),
    businessRow("biz-b", WALLET_B, "agency.pact-hack.eth"),
  ];
  return {
    findById: async (id: string) => rows.find((row) => row.id === id) ?? null,
    findByWallet: async (walletAddress: string) =>
      rows.find((row) => row.wallet_address === walletAddress) ?? null,
    findBySubname: async (ensSubname: string) =>
      rows.find((row) => row.ens_subname === ensSubname) ?? null,
    findByWorldSession: async (worldSessionId: string) =>
      rows.find((row) => row.world_session_id === worldSessionId) ?? null,
    insert: async () => {
      throw new Error("not implemented in engagement tests");
    },
  };
}

function createMemoryEngagementStore(): EngagementStore {
  const rows: EngagementRow[] = [];
  return {
    findById: async (id: string) => rows.find((row) => row.id === id) ?? null,
    findByOnChainId: async (onChainId: string) =>
      rows.find((row) => row.on_chain_id === onChainId) ?? null,
    insert: async (engagement: NewEngagement) => {
      const row: EngagementRow = {
        id: `eng-${rows.length + 1}`,
        on_chain_id: engagement.onChainId,
        ens_subname: engagement.ensSubname,
        party_a_id: engagement.partyAId,
        party_b_id: engagement.partyBId,
        template_type: engagement.templateType,
        terms_hash: engagement.termsHash,
        total_amount: engagement.totalAmount,
        status: "PROPOSED",
        created_at: new Date().toISOString(),
        completed_at: null,
        visibility: engagement.visibility ?? "public",
        default_provider_bps: engagement.defaultProviderBps ?? null,
        challenge_window_seconds: engagement.challengeWindowSeconds ?? null,
      };
      rows.push(row);
      return row;
    },
    updateStatus: async (id: string, status: EngagementStatus) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.status = status;
      return row;
    },
  };
}

function createMemoryMilestoneStore(): MilestoneStore {
  const rows: MilestoneRow[] = [];
  return {
    listByEngagement: async (engagementId: string) =>
      rows.filter((row) => row.engagement_id === engagementId),
    findByIndex: async (engagementId: string, index: number) =>
      rows.find((row) => row.engagement_id === engagementId && row.index === index) ?? null,
    insertMany: async (milestones: NewMilestone[]) => {
      const created: MilestoneRow[] = milestones.map((milestone, position) => ({
        id: `ms-${rows.length + position + 1}`,
        engagement_id: milestone.engagementId,
        index: milestone.index,
        name: milestone.name,
        description: milestone.description,
        amount: milestone.amount,
        due_date: milestone.dueDate,
        submitted_at: null,
        released_at: null,
        disputed: false,
        world_session_id: null,
        evidence_hash: null,
        late: false,
      }));
      rows.push(...created);
      return created;
    },
    markSubmitted: async (
      id: string,
      submittedAt: string,
      evidenceHash?: string | null,
      late?: boolean,
    ) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.submitted_at = submittedAt;
        if (evidenceHash !== undefined) row.evidence_hash = evidenceHash;
        if (late !== undefined) row.late = late;
      }
      return row;
    },
    setDisputed: async (id: string, disputed: boolean) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.disputed = disputed;
        row.disputed_at = disputed ? new Date().toISOString() : null;
      }
      return row;
    },
    markResolved: async (id: string, releasedAt: string) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.disputed = false;
        row.released_at = releasedAt;
      }
      return row;
    },
    setWorldSession: async (id: string, worldSessionId: string) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.world_session_id = worldSessionId;
      return row;
    },
    findByWorldSession: async (worldSessionId: string) =>
      rows.find((row) => row.world_session_id === worldSessionId) ?? null,
    listSubmittedUnreleased: async () =>
      rows.filter(
        (row) => row.submitted_at !== null && row.released_at === null && !row.disputed,
      ),
    listDisputed: async () =>
      rows.filter((row) => row.disputed && row.released_at === null),
    markReleased: async (id: string, releasedAt: string) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.released_at = releasedAt;
      return row;
    },
  };
}

interface EngagementEnvelope {
  id?: string;
  status?: string;
  milestones?: number;
  error?: string;
  submittedAt?: string;
  releaseAfter?: string;
  releasedAt?: string;
  engagementCompleted?: boolean;
  evidenceHash?: string | null;
  late?: boolean;
}

async function api(
  port: number,
  method: string,
  path: string,
  wallet: string | null,
  payload?: string,
): Promise<{ status: number; body: EngagementEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: payload });
  // SAFETY: test-only decode of the engagement envelopes produced by this router.
  const body = (await res.json()) as EngagementEnvelope;
  return { status: res.status, body };
}

const MILESTONES = [
  { index: 0, name: "Design", description: "Mockups", amount: 2000, dueDate: "2026-10-15" },
  { index: 1, name: "Build", description: "Site", amount: 3000, dueDate: "2026-11-01" },
];

interface DraftMilestone {
  index: number;
  name: string;
  description: string;
  amount: number;
  dueDate: string;
}

interface DraftOverrides {
  counterpartyWallet?: string;
  totalAmount?: number;
  onChainId?: string;
  milestones?: DraftMilestone[];
  visibility?: string;
  defaultProviderBps?: number | null;
  challengeWindowSeconds?: number | null;
}

function draft(overrides: DraftOverrides = {}): string {
  return JSON.stringify({
    counterpartyWallet: WALLET_B,
    templateType: 2,
    termsHash: "0xabc123",
    totalAmount: 5000,
    onChainId: "0xeng1",
    ensSubname: "eng-a3f9.pact-hack.eth",
    milestones: MILESTONES,
    ...overrides,
  });
}

const WHALE_MILESTONES: DraftMilestone[] = [
  { index: 0, name: "Whale", description: "Big delivery", amount: 6000, dueDate: "2026-12-01" },
];

describe("engagements", () => {
  let server: Server | null = null;
  let port = 0;
  const notifier = createCapturingNotifier();

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const wallet = req.header("x-wallet-address");
      if (wallet !== undefined) {
        req.identity = { walletAddress: wallet, privyWalletId: "dev" };
      }
      next();
    });
    app.use(
      "/api",
      createEngagementsRouter({
        engagements: createMemoryEngagementStore(),
        milestones: createMemoryMilestoneStore(),
        businesses: createMemoryBusinessStore(),
        // Null chain readers + recording sinks: dev paths record without on-chain proof.
        checkReleased: null,
        highValueThreshold: 5000,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        votes: {
          hasVotesForEngagement: async () => false,
          findMatchingCounterVote: async () => null,
          recordVote: async () => {
            throw new Error("not implemented in engagement tests");
          },
        },
        reputation: { recordCompletion: async () => {}, eventsForBusiness: async () => [] },
        notify: notifier.notify,
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

  test("creates an engagement between registered businesses", async () => {
    const { status, body } = await api(port, "POST", "/api/engagements", WALLET_A, draft());
    expect(status).toBe(201);
    expect(body.status).toBe("PROPOSED");
    expect(body.milestones).toBe(2);
    expect(body.id ?? "").toMatch(/^eng-/);
  });

  test("rejects bad counterparties, self-dealing, and mismatched totals", async () => {
    const stranger = await api(port, "POST", "/api/engagements", OUTSIDER, draft());
    expect(stranger.status).toBe(403);

    const unknownPeer = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({ counterpartyWallet: OUTSIDER }),
    );
    expect(unknownPeer.status).toBe(404);

    const selfie = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({ counterpartyWallet: WALLET_A }),
    );
    expect(selfie.status).toBe(400);

    const mismatch = await api(port, "POST", "/api/engagements", WALLET_A, draft({ totalAmount: 1 }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("terms_mismatch");
  });

  test("submit starts the acceptance window; repeats and outsiders fail", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, draft({ onChainId: "0xeng2" }));
    const id = created.body.id ?? "";

    const outsider = await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, OUTSIDER);
    expect(outsider.status).toBe(403);

    const first = await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    expect(first.status).toBe(200);
    const submittedAt = Date.parse(first.body.submittedAt ?? "");
    const releaseAfter = Date.parse(first.body.releaseAfter ?? "");
    expect(releaseAfter - submittedAt).toBe(48 * 3600 * 1000);
    const submittedMail = notifier.sent.at(-1);
    expect(submittedMail?.to).toBe("biz-b@example.com");
    expect(submittedMail?.subject.includes("Completion submitted")).toBe(true);

    const repeat = await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_B);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toBe("already_submitted");

    const missing = await api(port, "POST", `/api/engagements/${id}/milestones/9/submit`, WALLET_A);
    expect(missing.status).toBe(404);

    const noEngagement = await api(port, "POST", "/api/engagements/nope/milestones/0/submit", WALLET_A);
    expect(noEngagement.status).toBe(404);
  });

  test("release requires submission and completes the engagement on the last one", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, draft({ onChainId: "0xeng3" }));
    const id = created.body.id ?? "";

    const unsubmitted = await api(port, "POST", `/api/engagements/${id}/milestones/1/release`, WALLET_A);
    expect(unsubmitted.status).toBe(409);
    expect(unsubmitted.body.error).toBe("not_submitted");

    await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    await api(port, "POST", `/api/engagements/${id}/milestones/1/submit`, WALLET_A);

    const first = await api(port, "POST", `/api/engagements/${id}/milestones/0/release`, WALLET_B);
    expect(first.status).toBe(200);
    expect(first.body.engagementCompleted).toBe(false);

    const repeat = await api(port, "POST", `/api/engagements/${id}/milestones/0/release`, WALLET_A);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toBe("already_released");

    const last = await api(port, "POST", `/api/engagements/${id}/milestones/1/release`, WALLET_A);
    expect(last.status).toBe(200);
    expect(last.body.engagementCompleted).toBe(true);
    const releaseMails = notifier.sent.filter((message) =>
      message.subject.includes("Milestone released"),
    );
    expect(releaseMails.map((message) => message.to).sort()).toEqual([
      "biz-a@example.com",
      "biz-a@example.com",
      "biz-b@example.com",
      "biz-b@example.com",
    ]);

    const outsider = await api(port, "POST", `/api/engagements/${id}/milestones/1/release`, OUTSIDER);
    expect(outsider.status).toBe(403);
  });

  test("high-value release requires a bound world session", async () => {
    const created = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({ onChainId: "0xeng-whale", totalAmount: 6000, milestones: WHALE_MILESTONES }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id ?? "";

    const submit = await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    expect(submit.status).toBe(200);

    const blocked = await api(port, "POST", `/api/engagements/${id}/milestones/0/release`, WALLET_A);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("world_attestation_required");

    const check = await api(
      port,
      "POST",
      `/api/engagements/${id}/milestones/0/world-check`,
      WALLET_A,
      JSON.stringify({ proof: { responses: [] } }),
    );
    expect(check.status).toBe(200);

    const released = await api(port, "POST", `/api/engagements/${id}/milestones/0/release`, WALLET_A);
    expect(released.status).toBe(200);
    expect(released.body.engagementCompleted).toBe(true);
  });

  test("submit stores evidence hash and echoes it with the late flag", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, draft({ onChainId: "0xeng-ev" }));
    const id = created.body.id ?? "";
    const good = `0x${"ab".repeat(32)}`;

    const first = await api(
      port,
      "POST",
      `/api/engagements/${id}/milestones/0/submit`,
      WALLET_A,
      JSON.stringify({ evidenceHash: good }),
    );
    expect(first.status).toBe(200);
    expect(first.body.evidenceHash).toBe(good);
    expect(first.body.late).toBe(false);

    const bad = await api(
      port,
      "POST",
      `/api/engagements/${id}/milestones/1/submit`,
      WALLET_A,
      JSON.stringify({ evidenceHash: "nope" }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_request");
  });

  test("submit marks past-due milestones late", async () => {
    const created = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({
        onChainId: "0xeng-late",
        totalAmount: 100,
        milestones: [{ index: 0, name: "Old", description: "Past due", amount: 100, dueDate: "2020-01-01" }],
      }),
    );
    const id = created.body.id ?? "";
    const res = await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    expect(res.status).toBe(200);
    expect(res.body.late).toBe(true);
    expect(res.body.evidenceHash).toBeNull();
  });

  test("create persists visibility and rejects unknown modes", async () => {
    const created = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({
        onChainId: "0xeng-vis",
        visibility: "commit",
        defaultProviderBps: 5000,
        challengeWindowSeconds: 604800,
      }),
    );
    expect(created.status).toBe(201);

    const bad = await api(
      port,
      "POST",
      "/api/engagements",
      WALLET_A,
      draft({ onChainId: "0xeng-vis2", visibility: "sealed" }),
    );
    expect(bad.status).toBe(400);
  });

  test("world-check is idempotent for the same milestone", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, draft({ onChainId: "0xeng-wc" }));
    const id = created.body.id ?? "";

    const first = await api(
      port,
      "POST",
      `/api/engagements/${id}/milestones/0/world-check`,
      WALLET_A,
      JSON.stringify({ proof: { responses: [] } }),
    );
    expect(first.status).toBe(200);

    const second = await api(
      port,
      "POST",
      `/api/engagements/${id}/milestones/0/world-check`,
      WALLET_A,
      JSON.stringify({ proof: { responses: [] } }),
    );
    expect(second.status).toBe(200);
  });
});
