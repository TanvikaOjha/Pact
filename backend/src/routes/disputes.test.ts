import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore } from "../repos/businesses.js";
import type {
  DisputeProposalRow,
  DisputeProposalStore,
  DisputeVoteRow,
  DisputeVoteStore,
  NewDisputeProposal,
  NewDisputeVote,
} from "../repos/disputes.js";
import type { EmailMessage } from "../services/notifications.js";import type {
  EngagementRow,
  EngagementStatus,
  EngagementStore,
  MilestoneRow,
  MilestoneStore,
  NewEngagement,
  NewMilestone,
} from "../repos/engagements.js";
import { createDisputesRouter } from "./disputes.js";
import { createEngagementsRouter } from "./engagements.js";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OUTSIDER = "0xffffffffffffffffffffffffffffffffffffffff";

function businessRow(id: string, wallet: string): BusinessRow {
  return {
    id,
    wallet_address: wallet,
    privy_wallet_id: "dev",
    ens_subname: `${id}.pact-hack.eth`,
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

function createStores() {
  const businesses: BusinessRow[] = [businessRow("biz-a", WALLET_A), businessRow("biz-b", WALLET_B)];
  const engagements: EngagementRow[] = [];
  const milestones: MilestoneRow[] = [];
  const votes: DisputeVoteRow[] = [];
  const proposals: DisputeProposalRow[] = [];

  const businessStore: BusinessStore = {
    findById: async (id: string) => businesses.find((row) => row.id === id) ?? null,
    findByWallet: async (walletAddress: string) =>
      businesses.find((row) => row.wallet_address === walletAddress) ?? null,
    findBySubname: async (ensSubname: string) =>
      businesses.find((row) => row.ens_subname === ensSubname) ?? null,
    findByWorldSession: async (worldSessionId: string) =>
      businesses.find((row) => row.world_session_id === worldSessionId) ?? null,
    insert: async () => {
      throw new Error("not implemented in dispute tests");
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
    listDisputed: async () => [],
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
      const existing = votes.find(
        (candidate) =>
          candidate.engagement_id === vote.engagementId &&
          candidate.milestone_index === vote.milestoneIndex &&
          candidate.wallet_address === vote.walletAddress,
      );
      if (existing !== undefined) {
        existing.provider_amount = vote.providerAmount;
        existing.client_refund = vote.clientRefund;
        return existing;
      }
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
  const proposalStore: DisputeProposalStore = {
    findProposal: async (engagementId: string, milestoneIndex: number) =>
      proposals.find(
        (proposal) =>
          proposal.engagement_id === engagementId && proposal.milestone_index === milestoneIndex,
      ) ?? null,
    upsertProposal: async (row: NewDisputeProposal) => {
      const existing = proposals.find(
        (proposal) =>
          proposal.engagement_id === row.engagementId && proposal.milestone_index === row.milestoneIndex,
      );
      if (existing !== undefined) {
        existing.provider_amount = row.providerAmount;
        existing.client_refund = row.clientRefund;
        existing.proposer_wallet = row.proposerWallet;
        existing.challenge_deadline = row.challengeDeadline;
        return existing;
      }
      const created: DisputeProposalRow = {
        engagement_id: row.engagementId,
        milestone_index: row.milestoneIndex,
        provider_amount: row.providerAmount,
        client_refund: row.clientRefund,
        proposer_wallet: row.proposerWallet,
        challenge_deadline: row.challengeDeadline,
        challenged: false,
        executed_at: null,
      };
      proposals.push(created);
      return created;
    },
    markChallenged: async (engagementId: string, milestoneIndex: number) => {
      const proposal = proposals.find(
        (candidate) =>
          candidate.engagement_id === engagementId && candidate.milestone_index === milestoneIndex,
      );
      if (proposal !== undefined) proposal.challenged = true;
    },
    markExecuted: async (engagementId: string, milestoneIndex: number, executedAt: string) => {
      const proposal = proposals.find(
        (candidate) =>
          candidate.engagement_id === engagementId && candidate.milestone_index === milestoneIndex,
      );
      if (proposal !== undefined) proposal.executed_at = executedAt;
    },
    listOpen: async () => proposals.filter((proposal) => proposal.executed_at === null),
  };
  return { businessStore, engagementStore, milestoneStore, voteStore, proposalStore, proposals };
}

interface DisputeEnvelope {
  error?: string;
  disputed?: boolean;
  resolved?: boolean;
  proposed?: boolean;
  challenged?: boolean;
  challengeDeadline?: string;
  releasedAt?: string;
  engagementCompleted?: boolean;
  id?: string;
}

async function api(
  port: number,
  path: string,
  wallet: string | null,
  payload?: string,
): Promise<{ status: number; body: DisputeEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: payload,
  });
  // SAFETY: test-only decode of the dispute envelopes produced by this router.
  const body = (await res.json()) as DisputeEnvelope;
  return { status: res.status, body };
}

const MILESTONE = {
  counterpartyWallet: WALLET_B,
  templateType: 1,
  termsHash: "0xabc123",
  totalAmount: 2000,
  onChainId: "offchain-dispute",
  ensSubname: "eng-dispute.pact-hack.eth",
  milestones: [{ index: 0, name: "Work", description: "Done", amount: 2000, dueDate: "2026-10-15" }],
};

describe("disputes", () => {
  let server: Server | null = null;
  let port = 0;
  const notifier = createCapturingNotifier();
  let proposals: DisputeProposalRow[] = [];

  beforeAll(async () => {
    const stores = createStores();
    proposals = stores.proposals;
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
        checkReleased: null,
        highValueThreshold: 5000,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        votes: stores.voteStore,
        reputation: { recordCompletion: async () => {}, eventsForBusiness: async () => [] },
        notify: notifier.notify,
      }),
    );
    app.use(
      "/api",
      createDisputesRouter({
        engagements: stores.engagementStore,
        milestones: stores.milestoneStore,
        businesses: stores.businessStore,
        votes: stores.voteStore,
        proposals: stores.proposalStore,
        reputation: { recordCompletion: async () => {}, eventsForBusiness: async () => [] },
        notify: notifier.notify,
        checkDisputed: null,
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

  test("raise freezes the milestone; double raise and outsiders fail", async () => {
    const created = await api(
      port,
      "/api/engagements",
      WALLET_A,
      JSON.stringify({ ...MILESTONE, onChainId: "offchain-dispute-1" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id ?? "";

    const submit = await api(
      port,
      `/api/engagements/${id}/milestones/0/submit`,
      WALLET_A,
    );
    expect(submit.status).toBe(200);

    const outsider = await api(
      port,
      `/api/engagements/${id}/milestones/0/dispute`,
      OUTSIDER,
    );
    expect(outsider.status).toBe(403);

    const raised = await api(
      port,
      `/api/engagements/${id}/milestones/0/dispute`,
      WALLET_B,
    );
    expect(raised.status).toBe(200);
    expect(raised.body.disputed).toBe(true);
    const raisedMail = notifier.sent.at(-1);
    expect(raisedMail?.to).toBe("biz-a@example.com");
    expect(raisedMail?.subject.includes("Dispute raised")).toBe(true);

    const repeat = await api(
      port,
      `/api/engagements/${id}/milestones/0/dispute`,
      WALLET_A,
    );
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toBe("already_disputed");

    const releaseBlocked = await api(
      port,
      `/api/engagements/${id}/milestones/0/release`,
      WALLET_A,
    );
    expect(releaseBlocked.status).toBe(409);
    expect(releaseBlocked.body.error).toBe("milestone_disputed");
  });

  test("matching co-signed votes resolve; mismatches stay pending", async () => {
    const created = await api(
      port,
      "/api/engagements",
      WALLET_A,
      JSON.stringify({ ...MILESTONE, onChainId: "offchain-dispute-2" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id ?? "";
    await api(port, `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    await api(port, `/api/engagements/${id}/milestones/0/dispute`, WALLET_A);

    const split = (providerAmount: number, clientRefund: number): string =>
      JSON.stringify({ providerAmount, clientRefund });

    const mismatch = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve`,
      WALLET_A,
      split(1000, 0),
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("amounts_mismatch");

    const firstVote = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve`,
      WALLET_A,
      split(1200, 800),
    );
    expect(firstVote.status).toBe(200);
    expect(firstVote.body.resolved).toBe(false);
    const cosignMail = notifier.sent.at(-1);
    expect(cosignMail?.to).toBe("biz-b@example.com");
    expect(cosignMail?.subject.includes("Co-sign needed")).toBe(true);

    const otherSplit = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve`,
      WALLET_B,
      split(2000, 0),
    );
    expect(otherSplit.status).toBe(200);
    expect(otherSplit.body.resolved).toBe(false);

    const match = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve`,
      WALLET_B,
      split(1200, 800),
    );
    expect(match.status).toBe(200);
    expect(match.body.resolved).toBe(true);
    expect(match.body.engagementCompleted).toBe(true);
    const resolvedMails = notifier.sent.filter((message) =>
      message.subject.includes("Dispute resolved"),
    );
    expect(resolvedMails.map((message) => message.to).sort()).toEqual([
      "biz-a@example.com",
      "biz-b@example.com",
    ]);

    const settled = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve`,
      WALLET_A,
      split(1200, 800),
    );
    expect(settled.status).toBe(409);
    expect(settled.body.error).toBe("not_disputed");
  });

  test("resolve-propose stores the proposal and notifies; rejects bad sums and undisputed", async () => {
    const created = await api(
      port,
      "/api/engagements",
      WALLET_A,
      JSON.stringify({ ...MILESTONE, onChainId: "offchain-dispute-3" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id ?? "";
    await api(port, `/api/engagements/${id}/milestones/0/submit`, WALLET_A);

    const undisputed = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-propose`,
      WALLET_A,
      JSON.stringify({ providerAmount: 1200, clientRefund: 800 }),
    );
    expect(undisputed.status).toBe(409);
    expect(undisputed.body.error).toBe("not_disputed");

    await api(port, `/api/engagements/${id}/milestones/0/dispute`, WALLET_A);

    const mismatch = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-propose`,
      WALLET_A,
      JSON.stringify({ providerAmount: 1000, clientRefund: 0 }),
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("amounts_mismatch");

    const outsider = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-propose`,
      OUTSIDER,
      JSON.stringify({ providerAmount: 1200, clientRefund: 800 }),
    );
    expect(outsider.status).toBe(403);

    const proposed = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-propose`,
      WALLET_A,
      JSON.stringify({ providerAmount: 1200, clientRefund: 800 }),
    );
    expect(proposed.status).toBe(200);
    expect(proposed.body.proposed).toBe(true);
    expect(proposed.body.challengeDeadline ?? "").not.toBe("");
    const stored = proposals.find(
      (proposal) => proposal.engagement_id === id && proposal.milestone_index === 0,
    );
    expect(stored?.provider_amount).toBe(1200);
    expect(stored?.proposer_wallet).toBe(WALLET_A);
    const proposeMail = notifier.sent.at(-1);
    expect(proposeMail?.to).toBe("biz-b@example.com");
    expect(proposeMail?.subject.includes("Resolution proposed")).toBe(true);
  });

  test("resolve-challenge rejects self-challenge, marks and notifies the proposer", async () => {
    const created = await api(
      port,
      "/api/engagements",
      WALLET_A,
      JSON.stringify({ ...MILESTONE, onChainId: "offchain-dispute-4" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id ?? "";
    await api(port, `/api/engagements/${id}/milestones/0/submit`, WALLET_A);
    await api(port, `/api/engagements/${id}/milestones/0/dispute`, WALLET_A);
    await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-propose`,
      WALLET_A,
      JSON.stringify({ providerAmount: 1500, clientRefund: 500 }),
    );

    const self = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-challenge`,
      WALLET_A,
    );
    expect(self.status).toBe(400);
    expect(self.body.error).toBe("self_challenge");

    const challenged = await api(
      port,
      `/api/engagements/${id}/milestones/0/resolve-challenge`,
      WALLET_B,
    );
    expect(challenged.status).toBe(200);
    expect(challenged.body.challenged).toBe(true);
    const stored = proposals.find(
      (proposal) => proposal.engagement_id === id && proposal.milestone_index === 0,
    );
    expect(stored?.challenged).toBe(true);
    const challengeMail = notifier.sent.at(-1);
    expect(challengeMail?.to).toBe("biz-a@example.com");
    expect(challengeMail?.subject.includes("Resolution challenged")).toBe(true);
  });
});
