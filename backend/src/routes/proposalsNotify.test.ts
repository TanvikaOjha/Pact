import express, { type RequestHandler } from "express";
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
import type { NewProposal, ProposalRow, ProposalStore } from "../repos/proposals.js";
import type { EmailMessage, Notifier } from "../services/notifications.js";
import { createProposalsRouter } from "./proposals.js";

const WALLET = "0xdddddddddddddddddddddddddddddddddddddddd";
const WALLET_B = "0xcccccccccccccccccccccccccccccccccccccccc";

const PROPOSER_EMAIL = "proposer@example.com";
const COUNTERPARTY_EMAIL = "counterparty@example.com";

function businessRow(id: string, wallet: string, subname: string, email: string): BusinessRow {
  return {
    id,
    wallet_address: wallet,
    privy_wallet_id: "dev",
    ens_subname: subname,
    world_session_id: `session_dev_${id}`,
    world_verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    email,
  };
}

function createMemoryBusinessStore(): BusinessStore {
  const rows: BusinessRow[] = [
    businessRow("biz-1", WALLET, "studio.pact-hack.eth", PROPOSER_EMAIL),
    businessRow("biz-2", WALLET_B, "agency.pact-hack.eth", COUNTERPARTY_EMAIL),
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
      throw new Error("not implemented in proposal notify tests");
    },
  };
}

function createMemoryProposalStore(): ProposalStore {
  const rows = new Map<string, ProposalRow>();
  return {
    findByToken: async (token: string) => rows.get(token) ?? null,
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
      rows.set(row.token, row);
      return row;
    },
    markAccepted: async (token: string, engagementId: string) => {
      const row = rows.get(token) ?? null;
      if (row !== null) row.accepted_engagement_id = engagementId;
      return row;
    },
    listExpiringUnaccepted: async (beforeIso: string) =>
      [...rows.values()].filter(
        (row) => row.accepted_engagement_id === null && row.expires_at <= beforeIso,
      ),
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
    listSubmittedUnreleased: async () => [],
    listDisputed: async () => [],
    findByIndex: async (engagementId: string, index: number) =>
      rows.find((row) => row.engagement_id === engagementId && row.index === index) ?? null,
    insertMany: async (entries: NewMilestone[]) => {
      const created: MilestoneRow[] = entries.map((entry, position) => ({
        id: `ms-${rows.length + position + 1}`,
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
      rows.push(...created);
      return created;
    },
    markSubmitted: async () => null,
    markReleased: async () => null,
    setDisputed: async () => null,
    markResolved: async () => null,
    setWorldSession: async () => null,
    findByWorldSession: async () => null,
  };
}

const stubAuth: RequestHandler = (req, _res, next) => {
  const wallet = req.header("x-wallet-address");
  if (wallet !== undefined) {
    req.identity = { walletAddress: wallet, privyWalletId: "dev" };
  }
  next();
};

interface ProposalEnvelope {
  token?: string;
  expiresAt?: string;
  termsHash?: string;
  error?: string;
  engagementId?: string;
  ensSubname?: string;
  milestones?: number;
}

async function api(
  port: number,
  method: string,
  path: string,
  wallet: string | null,
  payload?: string,
): Promise<{ status: number; body: ProposalEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: payload,
  });
  // SAFETY: test-only decode of the proposal envelopes produced by this router.
  const body = (await res.json()) as ProposalEnvelope;
  return { status: res.status, body };
}

const DRAFT = {
  templateType: 2,
  title: "Website redesign",
  scope: "Redesign marketing site",
  acceptanceCriteria: "Sign-off within 5 days",
  totalAmount: 5000,
  milestones: [
    { index: 1, name: "Discovery", deliverable: "Wireframes", due: "2026-10-15", amount: 2000, worldRequired: false },
    { index: 2, name: "Visual", deliverable: "Mockups", due: "2026-11-01", amount: 3000, worldRequired: false },
  ],
  fields: { "pact:type": "milestone" },
};

describe("proposals notify", () => {
  let server: Server | null = null;
  let port = 0;
  const sent: EmailMessage[] = [];
  const notify: Notifier = {
    send: async (message: EmailMessage): Promise<void> => {
      sent.push(message);
    },
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createProposalsRouter({
        store: createMemoryProposalStore(),
        businesses: createMemoryBusinessStore(),
        engagements: createMemoryEngagementStore(),
        milestones: createMemoryMilestoneStore(),
        ensRoot: "pact-hack.eth",
        requireAuth: stubAuth,
        notify,
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

  test("create sends one proposal-created email to the proposer", async () => {
    sent.length = 0;
    const { status, body } = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify(DRAFT));
    expect(status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(PROPOSER_EMAIL);
    expect(sent[0]?.subject.includes("Proposal created")).toBe(true);
    expect(body.token ?? "").toMatch(/^[0-9a-f-]{36}$/);
  });

  test("accept sends proposal-accepted emails", async () => {
    sent.length = 0;
    const created = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify(DRAFT));
    expect(created.status).toBe(201);
    const token = created.body.token ?? "";
    sent.length = 0;

    const accepted = await api(port, "POST", `/api/proposals/${token}/accept`, WALLET_B);
    expect(accepted.status).toBe(201);
    expect(sent.length).toBeGreaterThan(0);
    for (const message of sent) {
      expect(message.subject.includes("Proposal accepted")).toBe(true);
    }
    const recipients = sent.map((message) => message.to);
    expect(recipients.includes(PROPOSER_EMAIL)).toBe(true);
    expect(recipients.includes(COUNTERPARTY_EMAIL)).toBe(true);
  });
});
