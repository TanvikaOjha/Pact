import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createApp } from "../app.js";

process.env.SEPOLIA_RPC_URL ??= "https://example.com";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-key";

const DEV_WALLET = "0x5555555555555555555555555555555555555555";

async function postVerify(
  port: number,
  body: Record<string, string>,
  authed: boolean,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (authed) {
    headers.set("x-wallet-address", DEV_WALLET);
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/world/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /api/world/verify (stub mode)", () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll(async () => {
    process.env.ALLOW_DEV_AUTH = "true";
    process.env.DEV_WORLD_STUB = "true";
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

  test("passes stub verification for a complete proof", async () => {
    const { status, body } = await postVerify(port, { proof: "opaque" }, true);
    expect(status).toBe(200);
    expect(body).toEqual({ pass: true, sessionId: "session_dev_stub", nullifier: null });
  });

  test("rejects missing proofs and unauthenticated callers", async () => {
    const missing = await postVerify(port, {}, true);
    expect(missing.status).toBe(400);
    const unauthed = await postVerify(port, { proof: "opaque" }, false);
    expect(unauthed.status).toBe(401);
  });
});
