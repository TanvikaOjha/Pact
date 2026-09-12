import type { LinkedAccount, User } from "@privy-io/node";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { describe, expect, test } from "vitest";

import { createRequireCronOrAuth, isCronAuthorized, resolveIdentity } from "./privyAuth.js";

function baseAccount(address: string): LinkedAccount {
  return {
    type: "wallet",
    address,
    chain_type: "ethereum",
    chain_id: "eip155:11155111",
    connector_type: "injected",
    wallet_client: "unknown",
    verified_at: 0,
    first_verified_at: 0,
    latest_verified_at: 0,
  };
}

function embeddedAccount(address: string, id: string): LinkedAccount {
  return {
    type: "wallet",
    address,
    chain_type: "ethereum",
    chain_id: "eip155:11155111",
    connector_type: "embedded",
    wallet_client: "privy",
    wallet_client_type: "privy",
    wallet_index: 0,
    delegated: false,
    imported: false,
    recovery_method: "privy",
    id,
    verified_at: 0,
    first_verified_at: 0,
    latest_verified_at: 0,
  };
}

function userStub(linkedAccounts: LinkedAccount[]): User {
  return {
    id: "did:privy:test-user",
    created_at: 0,
    has_accepted_terms: true,
    is_guest: false,
    linked_accounts: linkedAccounts,
    mfa_methods: [],
  };
}

describe("resolveIdentity", () => {
  test("prefers the embedded ethereum wallet", () => {
    const user = userStub([
      baseAccount("0x1111111111111111111111111111111111111111"),
      embeddedAccount("0x2222222222222222222222222222222222222222", "embedded-1"),
    ]);
    expect(resolveIdentity(user)).toEqual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      privyWalletId: "embedded-1",
    });
  });

  test("falls back to the user DID when the wallet has no embedded id", () => {
    const user = userStub([baseAccount("0x1111111111111111111111111111111111111111")]);
    expect(resolveIdentity(user)).toEqual({
      walletAddress: "0x1111111111111111111111111111111111111111",
      privyWalletId: "did:privy:test-user",
    });
  });

  test("ignores non-ethereum wallets and returns null when none remain", () => {
    const solana: LinkedAccount = {
      type: "wallet",
      address: "SolanaAddress11111111111111111111111111111",
      chain_type: "solana",
      wallet_client: "unknown",
      verified_at: 0,
      first_verified_at: 0,
      latest_verified_at: 0,
    };
    expect(resolveIdentity(userStub([solana]))).toBeNull();
    expect(resolveIdentity(userStub([]))).toBeNull();
  });

  test("dedupes repeated linked accounts by address", () => {
    const address = "0x3333333333333333333333333333333333333333";
    const user = userStub([
      embeddedAccount(address, "embedded-2"),
      baseAccount(address),
    ]);
    expect(resolveIdentity(user)).toEqual({
      walletAddress: address,
      privyWalletId: "embedded-2",
    });
  });
});

function requestWithAuth(header: string | undefined): Request {
  // SAFETY: tests only read req.header("authorization"); no other Request surface is touched.
  return {
    header: (name: string) => (name === "authorization" ? header : undefined),
  } as Request;
}

describe("isCronAuthorized", () => {
  test("matches the exact bearer secret only", () => {
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), "ops-secret")).toBe(true);
    expect(isCronAuthorized(requestWithAuth("Bearer wrong"), "ops-secret")).toBe(false);
    expect(isCronAuthorized(requestWithAuth(undefined), "ops-secret")).toBe(false);
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), undefined)).toBe(false);
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), "")).toBe(false);
  });
});

describe("createRequireCronOrAuth", () => {
  test("cron secret passes without touching user auth", async () => {
    let fallbackCalls = 0;
    const fallback: RequestHandler = (_req, _res, next) => {
      fallbackCalls += 1;
      next();
    };
    const handler = createRequireCronOrAuth({ cronSecret: "ops-secret", requireAuth: fallback });
    let nextCalls = 0;
    // SAFETY: handler only calls next() on this path; res is untouched.
    const res = {} as Response;
    await new Promise<void>((resolve) => {
      // SAFETY: test next() only counts calls and resolves; no Express internals needed.
      const next = (() => {
        nextCalls += 1;
        resolve();
      }) as NextFunction;
      handler(requestWithAuth("Bearer ops-secret"), res, next);
    });
    expect(nextCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  test("non-cron requests fall through to requireAuth", () => {
    const seen: string[] = [];
    const statuses: number[] = [];
    const fallback: RequestHandler = (req, res, _next) => {
      seen.push(req.header("authorization") ?? "none");
      res.status(401).json({ error: "missing_token" });
    };
    const handler = createRequireCronOrAuth({ cronSecret: "ops-secret", requireAuth: fallback });
    // SAFETY: fallback only uses res.status().json(); no other Response surface is touched.
    const res = {
      status: (code: number) => {
        statuses.push(code);
        return { json: (_body: { error: string }): void => {} };
      },
    } as Response;
    // SAFETY: fallback never calls next() on this path; a no-op satisfies the signature.
    const next = (() => {}) as NextFunction;
    handler(requestWithAuth(undefined), res, next);
    expect(seen).toEqual(["none"]);
    expect(statuses).toEqual([401]);
  });
});
