import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore } from "../repos/businesses.js";
import type { DisputeVoteRow, DisputeVoteStore, NewDisputeVote } from "../repos/disputes.js";
import type {
  EngagementRow,
  EngagementStatus,
  EngagementStore,
  MilestoneRow,
  MilestoneStore,
  NewEngagement,
  NewMilestone,
} from "../repos/engagements.js";
import type {
  NewReputationEvent,
  ReputationEventRow,
  ReputationStore,
} from "../repos/reputation.js";
import { createDisputesRouter } from "./disputes.js";
import { createEngagementsRouter } from "./engagements.js";
import { createReputationRouter } from "./reputation.js";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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

function createStores() {
  const businesses: BusinessRow[] = [
    businessRow("biz-a", WALLET_A, "studio.pact-hack.eth"),
    businessRow("biz-b", WALLET_B, "agency.pact-hack.eth"),
  ];
  const engagements: EngagementRow[] = [];
  const milestones: MilestoneRow[] = [];
  const votes: DisputeVoteRow[] = [];
  const events: ReputationEventRow[] = [];

  const businessStore: BusinessStore = {
    findById: async (id: string) => businesses.find((row) => row.id === id) ?? null,
    findByWallet: async (walletAddress: string) =>
      businesses.find((row) => row.wallet_address === walletAddress) ?? null,
    findBySubname: async (ensSubname: string) =>
      businesses.find((row) => row.ens_subname === ensSubname) ?? null,
    findByWorldSession: async (worldSessionId: string) =>
      businesses.find((row) => row.world_session_id === worldSessionId) ?? null,
    insert: async () => {
      throw new Error("not implemented in reputation tests");
    },
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
      if (row !== null) row.status = status;
      return row;
    },
  };
  const milestoneStore: MilestoneStore = {
    listByEngagement: async (engagementId: string) =>
      milestones.filter((row) => row.engagement_id === engagementId),
    listSubmittedUnreleased: async () => [],
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
      if (row !== null) row.disputed = disputed;
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
  const voteStore: DisputeVoteStore = {
    findMatchingCounterVote: async (
      engagementId: string,
      milestoneIndex: number,
      providerAmount: number,
      clientRefund: number,
      excludeWallet: string,
    ) =>
      votes.find(
        (vote) =>
          vote.engagement_id === engagementId &&
          vote.milestone_index === milestoneIndex &&
          vote.provider_amount === providerAmount &&
          vote.client_refund === clientRefund &&
          vote.wallet_address !== excludeWallet,
      ) ?? null,
    recordVote: async (vote: NewDisputeVote) => {
      const row: DisputeVoteRow = {
        id: `vote-${votes.length + 1}`,
        engagement_id: vote.engagementId,
        milestone_index: vote.milestoneIndex,
        wallet_address: vote.walletAddress,
        provider_amount: vote.providerAmount,
        client_refund: vote.clientRefund,
        created_at: new Date().toISOString(),
      };
      votes.push(row);
      return row;
    },
    hasVotesForEngagement: async (engagementId: string) =>
      votes.some((vote) => vote.engagement_id === engagementId),
  };
  const reputationStore: ReputationStore = {
    recordCompletion: async (entries: NewReputationEvent[]) => {
      for (const entry of entries) {
        events.push({
          id: `rep-${events.length + 1}`,
          engagement_id: entry.engagementId,
          business_id: entry.businessId,
          counterparty_id: entry.counterpartyId,
          template_type: entry.templateType,
          total_value: entry.totalValue,
          on_time: entry.onTime,
          disputed: entry.disputed,
          tx_hash: entry.txHash,
          emitted_at: entry.emittedAt,
        });
      }
    },
    eventsForBusiness: async (businessId: string) =>
      events.filter((event) => event.business_id === businessId),
  };
  return { businessStore, engagementStore, milestoneStore, voteStore, reputationStore };
}

interface ReputationEnvelope {
  error?: string;
  ensSubname?: string;
  completedCount?: number;
  totalValue?: number;
  onTimeRate?: number | null;
  disputeCount?: number;
  recent?: Array<{
    templateType?: number;
    totalValue?: number;
    onTime?: boolean;
    disputed?: boolean;
    counterpartySubname?: string | null;
  }>;
  engagementId?: string;
  id?: string;
  engagementCompleted?: boolean;
}

async function api(
  port: number,
  method: string,
  path: string,
  wallet: string | null,
  payload?: string,
): Promise<{ status: number; body: ReputationEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: payload });
  // SAFETY: test-only decode of the envelopes produced by these routers.
  const body = (await res.json()) as ReputationEnvelope;
  return { status: res.status, body };
}

function engagementDraft(onChainId: string): string {
  return JSON.stringify({
    counterpartyWallet: WALLET_B,
    templateType: 1,
    termsHash: "0xabc123",
    totalAmount: 2000,
    onChainId,
    ensSubname: `eng-${onChainId}.pact-hack.eth`,
    milestones: [{ index: 0, name: "Work", description: "Done", amount: 2000, dueDate: "2026-10-15" }],
  });
}

describe("reputation", () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll(async () => {
    const stores = createStores();
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
        engagements: stores.engagementStore,
        milestones: stores.milestoneStore,
        businesses: stores.businessStore,
        votes: stores.voteStore,
        reputation: stores.reputationStore,
        checkReleased: null,
        highValueThreshold: 5000,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        notify: { send: async () => {} },
      }),
    );
    app.use(
      "/api",
      createDisputesRouter({
        engagements: stores.engagementStore,
        milestones: stores.milestoneStore,
        businesses: stores.businessStore,
        votes: stores.voteStore,
        reputation: stores.reputationStore,
        notify: { send: async () => {} },
        checkDisputed: null,
      }),
    );
    app.use(
      "/api",
      createReputationRouter({
        businesses: stores.businessStore,
        reputation: stores.reputationStore,
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

  test("clean completion records on-time reputation for both parties", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, engagementDraft("offchain-rep-1"));
    const id = created.body.id ?? "";
    await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    const released = await api(port, "POST", `/api/engagements/${id}/milestones/0/release`, WALLET_B);
    expect(released.body.engagementCompleted).toBe(true);

    const profile = await api(port, "GET", "/api/businesses/studio.pact-hack.eth/reputation", null);
    expect(profile.status).toBe(200);
    expect(profile.body.completedCount).toBe(1);
    expect(profile.body.totalValue).toBe(2000);
    expect(profile.body.onTimeRate).toBe(1);
    expect(profile.body.disputeCount).toBe(0);
    expect(profile.body.recent?.length).toBe(1);
    expect(profile.body.recent?.[0]).toMatchObject({
      templateType: 1,
      totalValue: 2000,
      onTime: true,
      disputed: false,
      counterpartySubname: "agency.pact-hack.eth",
    });

    const counterparty = await api(port, "GET", "/api/businesses/agency.pact-hack.eth/reputation", null);
    expect(counterparty.body.completedCount).toBe(1);
    expect(counterparty.body.recent?.[0]?.counterpartySubname).toBe("studio.pact-hack.eth");
  });

  test("disputed completion taints reputation permanently", async () => {
    const created = await api(port, "POST", "/api/engagements", WALLET_A, engagementDraft("offchain-rep-2"));
    const id = created.body.id ?? "";
    await api(port, "POST", `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    await api(port, "POST", `/api/engagements/${id}/milestones/0/dispute`, WALLET_B);
    const split = JSON.stringify({ providerAmount: 1500, clientRefund: 500 });
    await api(port, "POST", `/api/engagements/${id}/milestones/0/resolve`, WALLET_A, split);
    const resolved = await api(port, "POST", `/api/engagements/${id}/milestones/0/resolve`, WALLET_B, split);
    expect(resolved.body.engagementCompleted).toBe(true);

    const profile = await api(port, "GET", "/api/businesses/studio.pact-hack.eth/reputation", null);
    expect(profile.body.completedCount).toBe(2);
    expect(profile.body.disputeCount).toBe(1);
    expect(profile.body.onTimeRate).toBe(0.5);
  });

  test("unknown subnames 404", async () => {
    const missing = await api(port, "GET", "/api/businesses/ghost.pact-hack.eth/reputation", null);
    expect(missing.status).toBe(404);
  });
});
