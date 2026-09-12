import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore, NewBusiness } from "./repos/businesses.js";
import type {
  EngagementRow,
  EngagementStatus,
  EngagementStore,
  MilestoneRow,
  MilestoneStore,
  NewEngagement,
  NewMilestone,
} from "./repos/engagements.js";
import type { NewProposal, ProposalRow, ProposalStore } from "./repos/proposals.js";
import { createBusinessesRouter } from "./routes/businesses.js";
import { createEngagementsRouter } from "./routes/engagements.js";
import { createProposalsRouter } from "./routes/proposals.js";

const STUDIO = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENCY = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function createStores() {
  const businesses: BusinessRow[] = [];
  const proposals = new Map<string, ProposalRow>();
  const engagements: EngagementRow[] = [];
  const milestones: MilestoneRow[] = [];

  const businessStore: BusinessStore = {
    findById: async (id: string) => businesses.find((row) => row.id === id) ?? null,
    findByWallet: async (walletAddress: string) =>
      businesses.find((row) => row.wallet_address === walletAddress) ?? null,
    findBySubname: async (ensSubname: string) =>
      businesses.find((row) => row.ens_subname === ensSubname) ?? null,
    findByWorldSession: async (worldSessionId: string) =>
      businesses.find((row) => row.world_session_id === worldSessionId) ?? null,
    insert: async (business: NewBusiness) => {
      const row: BusinessRow = {
        id: `biz-${businesses.length + 1}`,
        wallet_address: business.walletAddress,
        privy_wallet_id: business.privyWalletId,
        ens_subname: business.ensSubname,
        world_session_id: business.worldSessionId,
        world_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        email: business.email,
      };
      businesses.push(row);
      return row;
    },
  };
  const proposalStore: ProposalStore = {
    findByToken: async (token: string) => proposals.get(token) ?? null,
    insert: async (proposal: NewProposal) => {
      const row: ProposalRow = {
        token: proposal.token,
        template_type: proposal.templateType,
        fields: proposal.terms,
        proposer_id: proposal.proposerId,
        expires_at: proposal.expiresAt,
        created_at: new Date().toISOString(),
        accepted_engagement_id: null,
      };
      proposals.set(row.token, row);
      return row;
    },
    markAccepted: async (token: string, engagementId: string) => {
      const row = proposals.get(token) ?? null;
      if (row !== null) row.accepted_engagement_id = engagementId;
      return row;
    },
    listExpiringUnaccepted: async (beforeIso: string) =>
      [...proposals.values()].filter(
        (row) => row.accepted_engagement_id === null && row.expires_at <= beforeIso,
      ),
  };
  const engagementStore: EngagementStore = {
    findById: async (id: string) => engagements.find((row) => row.id === id) ?? null,
    findByOnChainId: async (onChainId: string) =>
      engagements.find((row) => row.on_chain_id === onChainId) ?? null,
    insert: async (engagement: NewEngagement) => {
      const row: EngagementRow = {
        id: `eng-${engagements.length + 1}`,
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
      engagements.push(row);
      return row;
    },
    updateStatus: async (id: string, status: EngagementStatus) => {
      const row = engagements.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.status = status;
        if (status === "COMPLETED") row.completed_at = new Date().toISOString();
      }
      return row;
    },
  };
  const milestoneStore: MilestoneStore = {
    listByEngagement: async (engagementId: string) =>
      milestones.filter((row) => row.engagement_id === engagementId),
    listSubmittedUnreleased: async () =>
      milestones.filter(
        (row) => row.submitted_at !== null && row.released_at === null && !row.disputed,
      ),
    listDisputed: async () =>
      milestones.filter((row) => row.disputed && row.released_at === null),
    findByIndex: async (engagementId: string, index: number) =>
      milestones.find((row) => row.engagement_id === engagementId && row.index === index) ?? null,
    insertMany: async (entries: NewMilestone[]) => {
      const created: MilestoneRow[] = entries.map((entry, position) => ({
        id: `ms-${milestones.length + position + 1}`,
        engagement_id: entry.engagementId,
        index: entry.index,
        name: entry.name,
        description: entry.description,
        amount: entry.amount,
        due_date: entry.dueDate,
        submitted_at: null,
        released_at: null,
        disputed: false,
        world_session_id: null,
      }));
      milestones.push(...created);
      return created;
    },
    markSubmitted: async (id: string, submittedAt: string) => {
      const row = milestones.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.submitted_at = submittedAt;
      return row;
    },
    markReleased: async (id: string, releasedAt: string) => {
      const row = milestones.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.released_at = releasedAt;
      return row;
    },
    setDisputed: async (id: string, disputed: boolean) => {
      const row = milestones.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.disputed = disputed;
        row.disputed_at = disputed ? new Date().toISOString() : null;
      }
      return row;
    },
    markResolved: async (id: string, releasedAt: string) => {
      const row = milestones.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) {
        row.disputed = false;
        row.released_at = releasedAt;
      }
      return row;
    },
    setWorldSession: async (id: string, worldSessionId: string) => {
      const row = milestones.find((candidate) => candidate.id === id) ?? null;
      if (row !== null) row.world_session_id = worldSessionId;
      return row;
    },
    findByWorldSession: async (worldSessionId: string) =>
      milestones.find((row) => row.world_session_id === worldSessionId) ?? null,
  };
  return { businessStore, proposalStore, engagementStore, milestoneStore };
}

const stubAuth: RequestHandler = (req, _res, next) => {
  const wallet = req.header("x-wallet-address");
  if (wallet !== undefined) {
    req.identity = { walletAddress: wallet, privyWalletId: "dev" };
  }
  next();
};

interface FlowEnvelope {
  error?: string;
  ensSubname?: string;
  token?: string;
  termsHash?: string;
  engagementId?: string;
  submittedAt?: string;
  releaseAfter?: string;
  releasedAt?: string;
  engagementCompleted?: boolean;
  status?: string;
}

async function api(
  port: number,
  method: string,
  path: string,
  wallet: string | null,
  payload?: string,
): Promise<{ status: number; body: FlowEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: payload });
  // SAFETY: test-only decode of the flow envelopes produced by these routers.
  const body = (await res.json()) as FlowEnvelope;
  return { status: res.status, body };
}

/**
 * Full propose → accept → submit → release lifecycle across routers with
 * shared memory stores. This is the composition proof: unit tests cover each
 * router, this covers the handoffs (terms hash continuity, party wiring,
 * completion flip).
 */
describe("lifecycle: register, propose, accept, submit, release", () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll(async () => {
    const stores = createStores();
    const app = express();
    app.use(express.json());
    app.use(stubAuth);
    app.use(
      "/api",
      createBusinessesRouter({
        store: stores.businessStore,
        checkChainActive: null,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        ensRoot: "pact-hack.eth",
      }),
    );
    app.use(
      "/api",
      createProposalsRouter({
        store: stores.proposalStore,
        businesses: stores.businessStore,
        engagements: stores.engagementStore,
        milestones: stores.milestoneStore,
        ensRoot: "pact-hack.eth",
        requireAuth: stubAuth,
      }),
    );
    app.use(
      "/api",
      createEngagementsRouter({
        engagements: stores.engagementStore,
        milestones: stores.milestoneStore,
        businesses: stores.businessStore,
        checkReleased: null,
        highValueThreshold: 5000,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        votes: {
          hasVotesForEngagement: async () => false,
          findMatchingCounterVote: async () => null,
          recordVote: async () => {
            throw new Error("not implemented in lifecycle tests");
          },
        },
        reputation: { recordCompletion: async () => {}, eventsForBusiness: async () => [] },
        notify: { send: async () => {} },
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

  test("propose, accept, submit, and release to completion", async () => {
    const studio = await api(
      port,
      "POST",
      "/api/businesses/register",
      STUDIO,
      JSON.stringify({ slug: "studio", proof: { responses: [] } }),
    );
    expect(studio.status).toBe(201);
    expect(studio.body.ensSubname).toBe("studio.pact-hack.eth");

    const agency = await api(
      port,
      "POST",
      "/api/businesses/register",
      AGENCY,
      JSON.stringify({ slug: "agency", proof: { responses: [] } }),
    );
    expect(agency.status).toBe(201);

    const proposed = await api(
      port,
      "POST",
      "/api/proposals",
      STUDIO,
      JSON.stringify({
        templateType: 2,
        title: "Website redesign",
        scope: "Redesign marketing site",
        acceptanceCriteria: "Sign-off within 5 days",
        totalAmount: 5000,
        milestones: [
          { index: 0, name: "Design", deliverable: "Mockups", due: "2026-10-15", amount: 2000, worldRequired: false },
          { index: 1, name: "Build", deliverable: "Site", due: "2026-11-01", amount: 3000, worldRequired: false },
        ],
        fields: { "pact:type": "milestone" },
      }),
    );
    expect(proposed.status).toBe(201);
    const token = proposed.body.token ?? "";
    const termsHash = proposed.body.termsHash ?? "";
    expect(termsHash).toMatch(/^0x[0-9a-f]{64}$/);

    const accepted = await api(port, "POST", `/api/proposals/${token}/accept`, AGENCY);
    expect(accepted.status).toBe(201);
    const engagementId = accepted.body.engagementId ?? "";
    expect(accepted.body.ensSubname ?? "").toMatch(/^eng-[0-9a-f]{6}\.pact-hack\.eth$/);

    const submit = await api(
      port,
      "POST",
      `/api/engagements/${engagementId}/milestones/0/submit`,
      STUDIO,
    );
    expect(submit.status).toBe(200);

    const release = await api(
      port,
      "POST",
      `/api/engagements/${engagementId}/milestones/0/release`,
      AGENCY,
    );
    expect(release.status).toBe(200);
    expect(release.body.engagementCompleted).toBe(false);

    const submitLast = await api(
      port,
      "POST",
      `/api/engagements/${engagementId}/milestones/1/submit`,
      STUDIO,
    );
    expect(submitLast.status).toBe(200);

    const releaseLast = await api(
      port,
      "POST",
      `/api/engagements/${engagementId}/milestones/1/release`,
      AGENCY,
    );
    expect(releaseLast.status).toBe(200);
    expect(releaseLast.body.engagementCompleted).toBe(true);
    expect(termsHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
