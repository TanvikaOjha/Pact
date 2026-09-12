import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore } from "../repos/businesses.js";
import type { NewProposal, ProposalRow, ProposalStore } from "../repos/proposals.js";
import { createProposalsRouter } from "./proposals.js";

const WALLET = "0xdddddddddddddddddddddddddddddddddddddddd";
const STRANGER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function createMemoryBusinessStore(): BusinessStore {
  const row: BusinessRow = {
    id: "biz-1",
    wallet_address: WALLET,
    privy_wallet_id: "dev",
    ens_subname: "studio.pact-hack.eth",
    world_session_id: "session_dev_1",
    world_verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  return {
    findById: async (id: string) => (id === row.id ? row : null),
    findByWallet: async (walletAddress: string) => (walletAddress === WALLET ? row : null),
    findBySubname: async (ensSubname: string) => (ensSubname === row.ens_subname ? row : null),
    findByWorldSession: async (worldSessionId: string) =>
      worldSessionId === row.world_session_id ? row : null,
    insert: async () => {
      throw new Error("not implemented in proposal tests");
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
      };
      rows.set(row.token, row);
      return row;
    },
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
  templateType?: number;
  terms?: { termsHash?: string; title?: string };
  proposer?: { ensSubname?: string } | null;
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

describe("proposals", () => {
  let server: Server | null = null;
  let port = 0;
  const proposals = createMemoryProposalStore();

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createProposalsRouter({
        store: proposals,
        businesses: createMemoryBusinessStore(),
        requireAuth: stubAuth,
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

  test("creates a proposal with canonical terms hash", async () => {
    const { status, body } = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify(DRAFT));
    expect(status).toBe(201);
    expect(body.token ?? "").toMatch(/^[0-9a-f-]{36}$/);
    expect(body.termsHash ?? "").toMatch(/^0x[0-9a-f]{64}$/);

    const fetched = await api(port, "GET", `/api/proposals/${body.token ?? ""}`, null);
    expect(fetched.status).toBe(200);
    expect(fetched.body.templateType).toBe(2);
    expect(fetched.body.terms?.termsHash).toBe(body.termsHash);
    expect(fetched.body.terms?.title).toBe("Website redesign");
    expect(fetched.body.proposer).toEqual({ ensSubname: "studio.pact-hack.eth" });
  });

  test("rejects mismatched totals, strangers, bad input, and unknown tokens", async () => {
    const mismatch = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify({
      ...DRAFT,
      totalAmount: 9999,
    }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("terms_mismatch");

    const stranger = await api(port, "POST", "/api/proposals", STRANGER, JSON.stringify(DRAFT));
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe("business_required");

    const bad = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify({
      ...DRAFT,
      templateType: 9,
    }));
    expect(bad.status).toBe(400);

    const missing = await api(port, "GET", "/api/proposals/nope", null);
    expect(missing.status).toBe(404);
  });

  test("returns 410 for expired proposals", async () => {
    const created = await api(port, "POST", "/api/proposals", WALLET, JSON.stringify(DRAFT));
    const token = created.body.token ?? "";
    const row = await proposals.findByToken(token);
    if (row !== null) {
      row.expires_at = new Date(Date.now() - 1000).toISOString();
    }
    const fetched = await api(port, "GET", `/api/proposals/${token}`, null);
    expect(fetched.status).toBe(410);
    expect(fetched.body.error).toBe("proposal_expired");
  });
});
