import type { LinkedAccount, User } from "@privy-io/node";
import { describe, expect, test } from "vitest";

import { resolveIdentity } from "./privyAuth.js";

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
