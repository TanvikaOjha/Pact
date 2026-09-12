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
      }));
      rows.push(...created);
      return created;
    },
    markSubmitted: async (id: string, submittedAt: string) => {
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.submitted_at = submittedAt;
      return row;
    },
    listSubmittedUnreleased: async () =>
      rows.filter(
        (row) => row.submitted_at !== null && row.released_at === null && !row.disputed,
      ),
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

interface DraftOverrides {
  counterpartyWallet?: string;
  totalAmount?: number;
  onChainId?: string;
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

describe("engagements", () => {
  let server: Server | null = null;
  let port = 0;

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
        // Null chain reader: dev path records releases without on-chain proof.
        checkReleased: null,
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

    const outsider = await api(port, "POST", `/api/engagements/${id}/milestones/1/release`, OUTSIDER);
    expect(outsider.status).toBe(403);
  });
});
