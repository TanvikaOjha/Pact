import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createApp } from "../app.js";

process.env.SEPOLIA_RPC_URL ??= "https://example.com";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-key";

interface MeEnvelope {
  identity: { walletAddress: string; privyWalletId: string } | null;
}

async function meResponse(port: number, headers: Record<string, string>): Promise<MeEnvelope> {
  const res = await fetch(`http://127.0.0.1:${port}/api/me`, { headers });
  // SAFETY: test-only decode of the /api/me envelope produced by meRouter.
  return (await res.json()) as MeEnvelope;
}

describe("GET /api/me", () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll(async () => {
    process.env.ALLOW_DEV_AUTH = "true";
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, () => {
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

  test("returns the dev identity for stub headers", async () => {
    const body = await meResponse(port, {
      "x-wallet-address": "0x4444444444444444444444444444444444444444",
      "x-privy-wallet-id": "dev-wallet-1",
    });
    expect(body).toEqual({
      identity: {
        walletAddress: "0x4444444444444444444444444444444444444444",
        privyWalletId: "dev-wallet-1",
      },
    });
  });

  test("health stays public while /api requires auth", async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const authed = await fetch(`http://127.0.0.1:${port}/api/me`);
    expect(authed.status).toBe(401);
  });
});
