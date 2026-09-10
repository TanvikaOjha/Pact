import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { BusinessRow, BusinessStore, NewBusiness } from "../repos/businesses.js";
import { createBusinessesRouter } from "./businesses.js";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WALLET_C = "0xcccccccccccccccccccccccccccccccccccccccc";

function createMemoryStore(): BusinessStore {
  const rows: BusinessRow[] = [];
  return {
    findByWallet: async (walletAddress: string) =>
      rows.find((row) => row.wallet_address === walletAddress) ?? null,
    findBySubname: async (ensSubname: string) =>
      rows.find((row) => row.ens_subname === ensSubname) ?? null,
    findByWorldSession: async (worldSessionId: string) =>
      rows.find((row) => row.world_session_id === worldSessionId) ?? null,
    insert: async (business: NewBusiness) => {
      const row: BusinessRow = {
        id: `id-${rows.length + 1}`,
        wallet_address: business.walletAddress,
        privy_wallet_id: business.privyWalletId,
        ens_subname: business.ensSubname,
        world_session_id: business.worldSessionId,
        world_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
  };
}

interface RegisterEnvelope {
  ensSubname?: string;
  walletAddress?: string;
  worldSessionId?: string;
  worldSessionIdBytes32?: string;
  status?: string;
  error?: string;
  suggestions?: string[];
}

async function postRegister(
  port: number,
  wallet: string | null,
  payload: Record<string, string>,
): Promise<{ status: number; body: RegisterEnvelope }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (wallet !== null) headers.set("x-wallet-address", wallet);
  const res = await fetch(`http://127.0.0.1:${port}/api/businesses/register`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  // SAFETY: test-only decode of the register envelope produced by this router.
  const body = (await res.json()) as RegisterEnvelope;
  return { status: res.status, body };
}

describe("POST /api/businesses/register (stub world, memory store)", () => {
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
      createBusinessesRouter({
        store: createMemoryStore(),
        checkChainActive: null,
        world: { devWorldStub: true, rpId: undefined, expectedAction: undefined },
        ensRoot: "pact-hack.eth",
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

  test("registers a new business and returns the on-chain session hash", async () => {
    const { status, body } = await postRegister(port, WALLET_A, { slug: "studio", proof: "x" });
    expect(status).toBe(201);
    expect(body.ensSubname).toBe("studio.pact-hack.eth");
    expect(body.walletAddress).toBe(WALLET_A);
    expect(body.status).toBe("pending_onchain");
    expect(body.worldSessionId ?? "").toMatch(/^session_dev_/);
    expect(body.worldSessionIdBytes32 ?? "").toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("rejects duplicate wallets, taken slugs, bad slugs, and missing identity", async () => {
    const duplicate = await postRegister(port, WALLET_A, { slug: "other", proof: "x" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("already_registered");

    const taken = await postRegister(port, WALLET_B, { slug: "studio", proof: "x" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("slug_taken");
    expect(taken.body.suggestions).toEqual(["studio-2.pact-hack.eth", "studio-3.pact-hack.eth"]);

    const badSlug = await postRegister(port, WALLET_B, { slug: "AB", proof: "x" });
    expect(badSlug.status).toBe(400);

    const anonymous = await postRegister(port, null, { slug: "ghost", proof: "x" });
    expect(anonymous.status).toBe(401);
  });

  test("normalizes slugs to lowercase", async () => {
    const { status, body } = await postRegister(port, WALLET_C, { slug: "Acme-Studio", proof: "x" });
    expect(status).toBe(201);
    expect(body.ensSubname).toBe("acme-studio.pact-hack.eth");
  });
});
